"""
PayPal Orders v2 (server side) for the PayPal buttons on the giving page.

The browser shows PayPal's own buttons; this server creates each order and
captures the money, so the amount can't be changed in the browser and a gift
only counts once PayPal confirms the capture.
"""

from decimal import Decimal

import requests
from django.conf import settings
from django.core.cache import cache

BASE_URLS = {"sandbox": "https://api-m.sandbox.paypal.com", "live": "https://api-m.paypal.com"}


class PayPalError(Exception):
    def __init__(self, message, code=""):
        super().__init__(message)
        self.code = code


def is_configured():
    return bool(settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET)


def _base():
    return BASE_URLS["live" if settings.PAYPAL_MODE == "live" else "sandbox"]


def _token():
    key = f"paypal-token-{settings.PAYPAL_MODE}-{settings.PAYPAL_CLIENT_ID[:12]}"
    token = cache.get(key)
    if token:
        return token
    try:
        res = requests.post(
            f"{_base()}/v1/oauth2/token",
            data={"grant_type": "client_credentials"},
            auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET),
            timeout=30,
        )
    except requests.RequestException as exc:
        raise PayPalError("Couldn't reach PayPal. Please try again.") from exc
    if res.status_code != 200:
        raise PayPalError("PayPal didn't accept the church's PayPal settings.")
    body = res.json()
    cache.set(key, body["access_token"], max(60, int(body.get("expires_in", 3600)) - 120))
    return body["access_token"]


def _call(method, path, *, json=None, request_id=None):
    headers = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    if request_id:
        headers["PayPal-Request-Id"] = request_id  # makes retries safe
    try:
        res = requests.request(method, f"{_base()}{path}", json=json, headers=headers, timeout=30)
    except requests.RequestException as exc:
        raise PayPalError("Couldn't reach PayPal. Please try again.") from exc
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        issue = ""
        for detail in body.get("details") or []:
            issue = detail.get("issue", "")
            break
        raise PayPalError(body.get("message") or "PayPal refused the request.", code=issue)
    return body


def create_order(*, amount, currency, reference, description, request_id, brand_name):
    body = _call(
        "POST",
        "/v2/checkout/orders",
        request_id=request_id,
        json={
            "intent": "CAPTURE",
            "purchase_units": [{
                "reference_id": request_id,
                "invoice_id": reference,
                "description": description[:127],
                "amount": {"currency_code": currency, "value": f"{Decimal(amount):.2f}"},
            }],
            "application_context": {
                "brand_name": brand_name[:127],
                "shipping_preference": "NO_SHIPPING",
                "user_action": "PAY_NOW",
            },
        },
    )
    return body["id"]


def capture_order(order_id):
    """Capture the money. Returns (completed, capture_id, amount, currency, status)."""
    try:
        body = _call("POST", f"/v2/checkout/orders/{order_id}/capture", json={}, request_id=f"capture-{order_id}")
    except PayPalError as exc:
        if exc.code != "ORDER_ALREADY_CAPTURED":
            raise
        body = _call("GET", f"/v2/checkout/orders/{order_id}")
    return _read_capture(body)


def _read_capture(body):
    try:
        capture = body["purchase_units"][0]["payments"]["captures"][0]
    except (KeyError, IndexError, TypeError):
        return False, "", None, "", body.get("status", "")
    status = capture.get("status", "")
    amount = capture.get("amount", {})
    return (
        body.get("status") == "COMPLETED" and status == "COMPLETED",
        capture.get("id", ""),
        Decimal(amount.get("value", "0")),
        amount.get("currency_code", ""),
        status,
    )
