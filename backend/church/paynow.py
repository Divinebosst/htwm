"""
Paynow Express Checkout for mobile money (EcoCash, OneMoney, InnBucks, O'mari).

Follows https://developers.paynow.co.zw/docs/paynow/express_checkout_transactions/
Every message to and from Paynow carries a SHA512 hash made from the message
values plus the integration key, so neither side can be impersonated.
"""

import hashlib
from decimal import Decimal
from urllib.parse import parse_qsl

import requests
from django.conf import settings

REMOTE_TRANSACTION_URL = "https://www.paynow.co.zw/interface/remotetransaction"
METHODS = {"ecocash", "onemoney", "innbucks", "omari"}

PAID = {"paid", "awaiting delivery", "delivered"}
WAITING = {"created", "sent", "ok"}
# Anything else (cancelled, failed, disputed, refunded, error...) means the payment didn't go through.


class PaynowError(Exception):
    """Paynow refused the request or replied with something we can't trust."""


def is_configured():
    return bool(settings.PAYNOW_INTEGRATION_ID and settings.PAYNOW_INTEGRATION_KEY and settings.PAYNOW_AUTH_EMAIL)


def make_hash(values):
    """Join the values in order, add the integration key, SHA512, upper-case hex."""
    joined = "".join(str(v) for v in values) + settings.PAYNOW_INTEGRATION_KEY
    return hashlib.sha512(joined.encode("utf-8")).hexdigest().upper()


def hash_is_valid(pairs):
    """`pairs` is the decoded (key, value) list exactly as Paynow sent it."""
    received = next((v for k, v in pairs if k.lower() == "hash"), None)
    if not received:
        return False
    expected = make_hash(v for k, v in pairs if k.lower() != "hash")
    return received.upper() == expected


def parse_message(text):
    """Paynow replies like a form post: key=value&key=value (URL-encoded)."""
    pairs = parse_qsl(text.strip(), keep_blank_values=True)
    return pairs, {k.lower(): v for k, v in pairs}


def _post(url, fields):
    try:
        res = requests.post(url, data=fields, timeout=30)
    except requests.RequestException as exc:
        raise PaynowError("Couldn't reach Paynow. Please try again.") from exc
    pairs, data = parse_message(res.text)
    status = data.get("status", "").lower()
    if status == "error":
        raise PaynowError(data.get("error") or "Paynow couldn't start the payment.")
    if not hash_is_valid(pairs):
        raise PaynowError("Paynow's reply couldn't be verified.")
    return data


def money(amount):
    return f"{Decimal(amount):.2f}"


def start_mobile_payment(*, reference, amount, info, phone, method, result_url, return_url, trace):
    """Ask Paynow to send a payment request to the customer's wallet."""
    if method not in METHODS:
        raise PaynowError("That mobile money wallet isn't supported.")
    fields = [
        ("id", settings.PAYNOW_INTEGRATION_ID),
        ("reference", reference),
        ("amount", money(amount)),
        ("additionalinfo", info),
        ("returnurl", return_url),
        ("resulturl", result_url),
        ("authemail", settings.PAYNOW_AUTH_EMAIL),
        ("phone", phone),
        ("method", method),
        ("merchanttrace", trace),
        ("status", "Message"),
    ]
    fields.append(("hash", make_hash(v for _, v in fields)))
    return _post(REMOTE_TRANSACTION_URL, fields)


def submit_omari_otp(otp_url, otp):
    """O'mari: pass on the one-time PIN the customer received by SMS."""
    fields = [("id", settings.PAYNOW_INTEGRATION_ID), ("otp", otp), ("status", "Message")]
    fields.append(("hash", make_hash(v for _, v in fields)))
    return _post(otp_url, fields)


def check_status(poll_url):
    """Ask Paynow for the latest status of a payment (an empty POST to its poll URL)."""
    return _post(poll_url, {})


def outcome(status):
    """Map Paynow's status to ours: 'received', 'pending' or 'failed'."""
    s = (status or "").strip().lower()
    if s in PAID:
        return "received"
    if s in WAITING:
        return "pending"
    return "failed"
