"""
Online giving: PayPal (including cards) and mobile money through Paynow.

A gift is recorded when the giver starts paying ("Waiting for payment") and is
marked "Received" only when PayPal or Paynow confirms the money, never on the
browser's word.
"""

import re
from datetime import timedelta
from decimal import Decimal

from django.conf import settings as django_settings
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.context import as_system

from . import paynow, paypal
from .models import Gift, GivingCategory, SiteSettings, build_reference


def site_url(request):
    return (django_settings.SITE_URL or request.build_absolute_uri("/")).rstrip("/")


def payment_reference(gift):
    """Unique per payment, e.g. TITHE-MOYO-12."""
    return f"{gift.reference}-{gift.pk}"


def gift_label(gift):
    if gift.category.asks_purpose and gift.purpose:
        return f"Gift: {gift.purpose}"
    return gift.category.label


def payload(gift, **extra):
    return {
        "id": str(gift.public_id),
        "status": gift.status,
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


class MobileDetailsSerializer(GiftDetailsSerializer):
    provider = serializers.ChoiceField(choices=Gift.PROVIDERS)
    phone = serializers.CharField(max_length=20)

    def validate_phone(self, value):
        return zimbabwe_mobile(value)


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


def mark_received(gift, provider_reference="", provider_status=""):
    gift.status = "received"
    gift.confirmed_at = timezone.now()
    if provider_reference:
        gift.provider_reference = provider_reference[:64]
    if provider_status:
        gift.provider_status = provider_status[:40]
    gift.save()


def apply_paynow_status(gift, data):
    """Update a mobile money gift from a verified Paynow status message."""
    if gift.status == "received":
        return
    result = paynow.outcome(data.get("status"))
    reported = data.get("amount")
    if result == "received" and reported is not None and Decimal(reported) != gift.amount:
        gift.provider_status = "Amount mismatch"
        gift.save()
        return
    if data.get("pollurl"):
        gift.poll_url = data["pollurl"][:300]
    if result == "received":
        mark_received(gift, data.get("paynowreference", ""), data.get("status", ""))
    else:
        new_status = "failed" if result == "failed" else "pending"
        reported_status = (data.get("status") or "")[:40]
        if gift.status != new_status or gift.provider_status != reported_status:
            gift.status = new_status
            gift.provider_status = reported_status
            gift.save()


# PayPal orders expire after 3 hours and mobile money prompts after a few minutes.
UNFINISHED_AFTER = timedelta(hours=24)


def close_unfinished_payments():
    """
    Payments someone started but never finished (PayPal closed, phone prompt
    ignored) stop counting as "waiting" after a day. If Paynow or PayPal later
    confirms one after all, it is still marked as received.
    """
    cutoff = timezone.now() - UNFINISHED_AFTER
    stale = Gift.objects.filter(status="pending", method__in=["paypal", "mobile"], created_at__lt=cutoff)
    with as_system():
        for gift in stale:
            gift.status, gift.provider_status = "failed", "Not completed"
            gift.save(update_fields=["status", "provider_status"])


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
            order_id = paypal.create_order(
                amount=gift.amount,
                currency=gift.currency,
                reference=payment_reference(gift),
                description=f"{gift_label(gift)} – {site.short_name}",
                request_id=str(gift.public_id),
                brand_name=site.church_name,
            )
        except paypal.PayPalError as exc:
            gift.status, gift.provider_status = "failed", "Order not created"
            gift.save()
            return Response({"detail": str(exc)}, status=502)
        gift.provider_order_id = order_id
        gift.provider_status = "CREATED"
        gift.save()
        return Response({"order_id": order_id, "gift": str(gift.public_id)}, status=201)


class PayPalCapture(PaymentView):
    """POST /api/payments/paypal/orders/<order_id>/capture — called by onApprove."""

    def post(self, request, order_id):
        gift = Gift.objects.select_related("category").filter(method="paypal", provider_order_id=order_id).first()
        if gift is None:
            return Response({"detail": "Payment not found."}, status=404)
        if gift.status == "received":
            return Response(payload(gift))
        try:
            completed, capture_id, amount, currency, capture_status = paypal.capture_order(order_id)
        except paypal.PayPalError as exc:
            if exc.code == "INSTRUMENT_DECLINED":
                return Response({"detail": "The card or PayPal account was declined. Please try another one.",
                                 "code": "instrument_declined"}, status=422)
            gift.status, gift.provider_status = "failed", (exc.code or "Capture failed")[:40]
            gift.save()
            return Response({"detail": str(exc)}, status=502)
        if completed and amount == gift.amount and currency == gift.currency:
            mark_received(gift, capture_id, capture_status)
        elif capture_status == "PENDING":
            gift.provider_reference, gift.provider_status = capture_id, "PENDING"
            gift.save()
        else:
            gift.status, gift.provider_status = "failed", (capture_status or "Not completed")[:40]
            gift.save()
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
        gift.provider_order_id = payment_reference(gift)
        base = site_url(request)
        try:
            reply = paynow.start_mobile_payment(
                reference=gift.provider_order_id,
                amount=gift.amount,
                info=gift_label(gift),
                phone=data["phone"],
                method=data["provider"],
                result_url=f"{base}/api/payments/paynow/result",
                return_url=f"{base}/give",
                trace=gift.public_id.hex,
            )
        except paynow.PaynowError as exc:
            gift.status, gift.provider_status = "failed", str(exc)[:40]
            gift.save()
            return Response({"detail": str(exc)}, status=400)

        gift.poll_url = reply.get("pollurl", "")[:300]
        gift.otp_url = reply.get("remoteotpurl", "")[:300]
        gift.provider_status = reply.get("status", "Sent")[:40]
        gift.save()

        extra = {"next": "approve", "instructions": reply.get("instructions", "")}
        if data["provider"] == "innbucks":
            code = reply.get("authorizationcode", "")
            extra.update(next="innbucks_code", authorization_code=code,
                         authorization_expires=reply.get("authorizationexpires", ""),
                         deep_link=f"com.innbucks.customer://purchase?paymentToken={code}" if code else "")
        elif data["provider"] == "omari":
            extra.update(next="omari_otp", otp_reference=reply.get("otpreference", ""))
        return Response(payload(gift, **extra), status=201)


class OtpSerializer(serializers.Serializer):
    otp = serializers.RegexField(r"^\d{4,10}$", error_messages={"invalid": "Enter the code from your SMS."})


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
            reply = paynow.submit_omari_otp(gift.otp_url, s.validated_data["otp"])
        except paynow.PaynowError as exc:
            return Response({"detail": str(exc)}, status=400)
        apply_paynow_status(gift, reply)
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
        if gift.status == "pending" and gift.method == "mobile" and gift.poll_url:
            try:
                apply_paynow_status(gift, paynow.check_status(gift.poll_url))
            except paynow.PaynowError:
                pass  # try again on the next check
        return Response(payload(gift))


@method_decorator(csrf_exempt, name="dispatch")
class PaynowResult(View):
    """POST /api/payments/paynow/result — Paynow tells us when a payment's status changes."""

    def post(self, request):
        pairs, data = paynow.parse_message(request.body.decode("utf-8", "replace"))
        if not paynow.hash_is_valid(pairs):
            return HttpResponse("Invalid hash", status=status.HTTP_400_BAD_REQUEST)
        gift = Gift.objects.select_related("category").filter(
            method="mobile", provider_order_id=data.get("reference", "")
        ).first()
        if gift is not None:
            apply_paynow_status(gift, data)
        return HttpResponse("OK")
