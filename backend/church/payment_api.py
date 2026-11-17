"""
Online giving: PayPal (including cards) and mobile money through Paynow.

A gift is recorded when the giver starts paying ("Waiting for payment") and is
marked "Received" only when PayPal or Paynow confirms the money, never on the
browser's word. The payment steps themselves live in online_payments.py and
are shared with store orders.
"""

import re
from decimal import Decimal

from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import online_payments as pay
from . import paynow, paypal
from .models import Gift, GivingCategory, SiteSettings, build_reference

site_url = pay.site_url


def gift_label(gift):
    if gift.category.asks_purpose and gift.purpose:
        return f"Gift: {gift.purpose}"
    return gift.category.label


def payload(gift, **extra):
    return {
        "id": str(gift.public_id),
        "status": gift.status,
        "payment": gift.payment_state,
        "amount": f"{gift.amount:.2f}",
        "currency": gift.currency,
        "reference": gift.reference,
        "label": gift_label(gift),
        "payment_label": gift.payment_label,
        "gift_number": gift.pk,
        **extra,
    }


class GiftDetailsSerializer(serializers.Serializer):
    category = serializers.SlugRelatedField(slug_field="key", queryset=GivingCategory.objects.filter(is_active=True))
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("1.00"),
                                      max_value=Decimal("1000000"))
    giver_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    giver_contact = serializers.CharField(max_length=120, required=False, allow_blank=True)
    anonymous = serializers.BooleanField(required=False, default=False)
    purpose = serializers.CharField(max_length=140, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs.get("anonymous"):
            attrs["giver_name"] = ""
        if not attrs["category"].asks_purpose:
            attrs["purpose"] = ""
        return attrs


def zimbabwe_mobile(value):
    """0771 234 567, +263 77 123 4567 or 263771234567 -> 0771234567"""
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("263") and len(digits) == 12:
        digits = "0" + digits[3:]
    if not re.fullmatch(r"07\d{8}", digits):
        raise serializers.ValidationError("Enter a Zimbabwe mobile number, e.g. 0771 234 567.")
    return digits


class WalletSerializer(serializers.Serializer):
    """The mobile money wallet that pays."""

    provider = serializers.ChoiceField(choices=Gift.PROVIDERS)
    phone = serializers.CharField(max_length=20)

    def validate_phone(self, value):
        return zimbabwe_mobile(value)


class MobileDetailsSerializer(GiftDetailsSerializer, WalletSerializer):
    pass


class OtpSerializer(serializers.Serializer):
    otp = serializers.RegexField(r"^\d{4,10}$", error_messages={"invalid": "Enter the code from your SMS."})


def new_gift(data, method, **extra):
    site = SiteSettings.load()
    return Gift.objects.create(
        category=data["category"],
        purpose=data.get("purpose", ""),
        amount=data["amount"],
        currency=site.currency,
        method=method,
        giver_name=data.get("giver_name", "").strip(),
        giver_contact=data.get("giver_contact", "").strip(),
        anonymous=data.get("anonymous", False),
        reference=build_reference(data["category"].reference_code, data.get("giver_name", ""), data.get("anonymous", False)),
        **extra,
    )


def close_unfinished_payments():
    pay.close_unfinished(Gift.objects.filter(status="pending"))


DECLINED = {"detail": "The card or PayPal account was declined. Please try another one.", "code": "instrument_declined"}


class PaymentView(APIView):
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "gifts"


# ---------------------------------------------------------------- PayPal


class PayPalCreateOrder(PaymentView):
    """POST /api/payments/paypal/orders — called by the PayPal button's createOrder."""

    def post(self, request):
        if not paypal.is_configured():
            return Response({"detail": "PayPal giving isn't set up yet."}, status=503)
        s = GiftDetailsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        gift = new_gift(s.validated_data, "paypal")
        site = SiteSettings.load()
        try:
            order_id = pay.start_paypal(gift, description=f"{gift_label(gift)} – {site.short_name}",
                                        brand_name=site.church_name)
        except paypal.PayPalError as exc:
            return Response({"detail": str(exc)}, status=502)
        return Response({"order_id": order_id, "gift": str(gift.public_id)}, status=201)


class PayPalCapture(PaymentView):
    """POST /api/payments/paypal/orders/<order_id>/capture — called by onApprove."""

    def post(self, request, order_id):
        gift = Gift.objects.select_related("category").filter(method="paypal", provider_order_id=order_id).first()
        if gift is None:
            return Response({"detail": "Payment not found."}, status=404)
        try:
            pay.capture_paypal(gift)
        except paypal.PayPalError as exc:
            if exc.code == "INSTRUMENT_DECLINED":
                return Response(DECLINED, status=422)
            return Response({"detail": str(exc)}, status=502)
        return Response(payload(gift))


# ---------------------------------------------------------------- Mobile money (Paynow)


class MobileStart(PaymentView):
    """POST /api/payments/mobile — sends a payment request to the giver's wallet."""

    def post(self, request):
        if not paynow.is_configured():
            return Response({"detail": "Mobile money giving isn't set up yet."}, status=503)
        s = MobileDetailsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        gift = new_gift(data, "mobile", provider=data["provider"], payer_phone=data["phone"])
        base = site_url(request)
        try:
            extra = pay.start_mobile(gift, info=gift_label(gift), result_url=f"{base}/api/payments/paynow/result",
                                     return_url=f"{base}/give")
        except paynow.PaynowError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(payload(gift, **extra), status=201)


class MobileOtp(PaymentView):
    """POST /api/payments/mobile/<id>/otp — O'mari one-time PIN."""

    def post(self, request, public_id):
        gift = Gift.objects.select_related("category").filter(public_id=public_id, provider="omari").first()
        if gift is None or not gift.otp_url:
            return Response({"detail": "Payment not found."}, status=404)
        if gift.status != "pending":
            return Response(payload(gift))
        s = OtpSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            pay.submit_otp(gift, s.validated_data["otp"])
        except paynow.PaynowError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(payload(gift))


class PaymentStatus(APIView):
    """GET /api/payments/<id> — the giving page asks this every few seconds while it waits."""

    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "payment_status"

    def get(self, request, public_id):
        gift = Gift.objects.select_related("category").filter(public_id=public_id).first()
        if gift is None:
            return Response({"detail": "Payment not found."}, status=404)
        pay.refresh_mobile(gift)
        return Response(payload(gift))


@method_decorator(csrf_exempt, name="dispatch")
class PaynowResult(View):
    """
    POST /api/payments/paynow/result — Paynow tells us when a payment's status
    changes. Used for both gifts and store orders.
    """

    def post(self, request):
        from store.models import Order

        pairs, data = paynow.parse_message(request.body.decode("utf-8", "replace"))
        if not paynow.hash_is_valid(pairs):
            return HttpResponse("Invalid hash", status=status.HTTP_400_BAD_REQUEST)
        reference = data.get("reference", "")
        for model in (Gift, Order):
            obj = model.objects.filter(method="mobile", provider_order_id=reference).first()
            if obj is not None:
                pay.apply_paynow_status(obj, data)
                break
        return HttpResponse("OK")
