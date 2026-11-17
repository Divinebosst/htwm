"""
The steps of taking a payment online, shared by gifts and store orders.

Anything paid for online (a Gift or a store Order) provides:

    public_id, method ("paypal" or "mobile"), currency, provider, payer_phone,
    provider_order_id, provider_reference, provider_status, poll_url, otp_url
    payment_amount        how much must arrive
    payment_reference     unique reference sent to PayPal or Paynow
    payment_state         "pending", "paid" or "failed"
    is_paid               True once the money is confirmed
    payment_received(provider_reference, provider_status)
    payment_update(state, provider_status)   state is "pending" or "failed"

Nothing is ever marked as paid on the browser's word: only when PayPal
captures the full amount, or Paynow reports it paid in a signed message.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from audit.context import as_system

from . import paynow, paypal

# PayPal orders expire after 3 hours and mobile money prompts after a few minutes.
UNFINISHED_AFTER = timedelta(hours=24)


def site_url(request):
    return (settings.SITE_URL or request.build_absolute_uri("/")).rstrip("/")


# ---------------------------------------------------------------- PayPal


def start_paypal(obj, *, description, brand_name):
    """Create the PayPal order for the PayPal button. Raises PayPalError."""
    try:
        order_id = paypal.create_order(
            amount=obj.payment_amount,
            currency=obj.currency,
            reference=obj.payment_reference,
            description=description,
            request_id=str(obj.public_id),
            brand_name=brand_name,
        )
    except paypal.PayPalError:
        obj.payment_update("failed", "Order not created")
        raise
    obj.provider_order_id = order_id
    obj.provider_status = "CREATED"
    obj.save()
    return order_id


def capture_paypal(obj):
    """
    Take the money once the payer approves in PayPal. Raises PayPalError;
    code "INSTRUMENT_DECLINED" means the payer can try another card.
    """
    if obj.is_paid:
        return
    try:
        completed, capture_id, amount, currency, capture_status = paypal.capture_order(obj.provider_order_id)
    except paypal.PayPalError as exc:
        if exc.code != "INSTRUMENT_DECLINED":
            obj.payment_update("failed", (exc.code or "Capture failed")[:40])
        raise
    if completed and amount == obj.payment_amount and currency == obj.currency:
        obj.payment_received(capture_id, capture_status)
    elif capture_status == "PENDING":
        obj.provider_reference, obj.provider_status = capture_id[:64], "PENDING"
        obj.save()
    else:
        obj.payment_update("failed", (capture_status or "Not completed")[:40])


# ---------------------------------------------------------------- Mobile money (Paynow)


def start_mobile(obj, *, info, result_url, return_url):
    """
    Send a payment request to the payer's wallet (obj.provider, obj.payer_phone).
    Returns what the page needs next. Raises PaynowError.
    """
    obj.provider_order_id = obj.payment_reference
    try:
        reply = paynow.start_mobile_payment(
            reference=obj.provider_order_id,
            amount=obj.payment_amount,
            info=info,
            phone=obj.payer_phone,
            method=obj.provider,
            result_url=result_url,
            return_url=return_url,
            trace=obj.public_id.hex,
        )
    except paynow.PaynowError as exc:
        obj.payment_update("failed", str(exc)[:40])
        raise

    obj.poll_url = reply.get("pollurl", "")[:300]
    obj.otp_url = reply.get("remoteotpurl", "")[:300]
    obj.provider_status = reply.get("status", "Sent")[:40]
    obj.save()

    extra = {"next": "approve", "instructions": reply.get("instructions", "")}
    if obj.provider == "innbucks":
        code = reply.get("authorizationcode", "")
        extra.update(next="innbucks_code", authorization_code=code,
                     authorization_expires=reply.get("authorizationexpires", ""),
                     deep_link=f"com.innbucks.customer://purchase?paymentToken={code}" if code else "")
    elif obj.provider == "omari":
        extra.update(next="omari_otp", otp_reference=reply.get("otpreference", ""))
    return extra


def submit_otp(obj, otp):
    """O'mari: pass on the code from the SMS. Raises PaynowError."""
    apply_paynow_status(obj, paynow.submit_omari_otp(obj.otp_url, otp))


def refresh_mobile(obj):
    """While waiting, ask Paynow for news (the result message may not have arrived)."""
    if obj.payment_state == "pending" and obj.method == "mobile" and obj.poll_url:
        try:
            apply_paynow_status(obj, paynow.check_status(obj.poll_url))
        except paynow.PaynowError:
            pass  # try again on the next check


def apply_paynow_status(obj, data):
    """Update a mobile money payment from a verified Paynow status message."""
    if obj.is_paid:
        return
    result = paynow.outcome(data.get("status"))
    reported = data.get("amount")
    if result == "received" and reported is not None and Decimal(reported) != obj.payment_amount:
        obj.provider_status = "Amount mismatch"
        obj.save()
        return
    if data.get("pollurl"):
        obj.poll_url = data["pollurl"][:300]
    if result == "received":
        obj.payment_received(data.get("paynowreference", ""), data.get("status", ""))
    else:
        obj.payment_update("failed" if result == "failed" else "pending", (data.get("status") or "")[:40])


# ---------------------------------------------------------------- housekeeping


def close_unfinished(queryset):
    """
    Payments someone started but never finished (PayPal closed, phone prompt
    ignored) stop counting as "waiting" after a day. If Paynow or PayPal later
    confirms one after all, it is still marked as paid.
    """
    cutoff = timezone.now() - UNFINISHED_AFTER
    with as_system():
        for obj in queryset.filter(method__in=["paypal", "mobile"], created_at__lt=cutoff):
            obj.payment_update("failed", "Not completed")
