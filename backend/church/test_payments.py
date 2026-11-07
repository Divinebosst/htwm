"""Online giving tests. PayPal and Paynow are simulated; no real money or network."""

from decimal import Decimal
from unittest import mock
from urllib.parse import urlencode

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from audit.models import AuditLog

from . import paynow
from .models import Gift

DOCS_KEY = "3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977"  # the example key in Paynow's documentation
PAYNOW = dict(PAYNOW_INTEGRATION_ID="1201", PAYNOW_INTEGRATION_KEY=DOCS_KEY, PAYNOW_AUTH_EMAIL="office@example.com",
              SITE_URL="https://htwm.example")
PAYPAL = dict(PAYPAL_CLIENT_ID="client-id", PAYPAL_CLIENT_SECRET="secret", PAYPAL_MODE="sandbox")
GIFT = {"category": "tithe", "amount": "50", "giver_name": "Tendai Moyo", "giver_contact": "0771 234 567"}


def paynow_reply(fields):
    """A reply signed the way Paynow signs it."""
    pairs = list(fields) + [("hash", paynow.make_hash(v for _, v in fields))]
    return mock.Mock(text=urlencode(pairs))


@override_settings(**PAYNOW)
class PaynowHashTests(TestCase):
    def test_outbound_hash_matches_paynow_docs(self):
        values = ["1201", "TEST REF", "99.99", "A test ticket transaction", "http://www.google.com/search?q=returnurl",
                  "http://www.google.com/search?q=resulturl", "Message"]
        self.assertEqual(
            paynow.make_hash(values),
            "2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689",
        )

    def test_inbound_hash_check_matches_paynow_docs(self):
        message = (
            "status=Ok&browserurl=https%3a%2f%2fstaging.paynow.co.zw%2fPayment%2fConfirmPayment%2f9510"
            "&pollurl=https%3a%2f%2fstaging.paynow.co.zw%2fInterface%2fCheckPayment%2f%3fguid%3dc7ed41da-0159-46da-b428-69549f770413"
            "&paynowreference=9510&hash=750DD0B0DF374678707BB5AF915AF81C228B9058AD57BB7120569EC68BBB9C2EFC1B26C6375D2BC562AC909B3CD6B2AF1D42E1A5E479FFAC8F4FB3FDCE71DF4D"
        )
        pairs, _ = paynow.parse_message(message)
        self.assertTrue(paynow.hash_is_valid(pairs))
        tampered = [(k, "Paid" if k == "status" else v) for k, v in pairs]
        self.assertFalse(paynow.hash_is_valid(tampered))


@override_settings(**PAYNOW)
class MobileMoneyTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = APIClient()

    def start(self, provider="ecocash", phone="0771111111", reply=None):
        reply = reply or paynow_reply([("status", "Ok"), ("instructions", "Approve on your phone"),
                                       ("pollurl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"),
                                       ("paynowreference", "9510")])
        with mock.patch("church.paynow.requests.post", return_value=reply) as post:
            res = self.c.post("/api/payments/mobile", {**GIFT, "provider": provider, "phone": phone}, format="json")
        return res, post

    def test_ecocash_payment_request_is_signed_and_waits_for_approval(self):
        res, post = self.start()
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body["status"], "pending")
        self.assertEqual(body["next"], "approve")
        gift = Gift.objects.get(public_id=body["id"])
        self.assertEqual((gift.method, gift.provider, gift.payer_phone), ("mobile", "ecocash", "0771111111"))
        self.assertEqual(gift.provider_order_id, f"TITHE-MOYO-{gift.pk}")
        sent = dict(post.call_args.kwargs["data"])
        self.assertEqual(post.call_args.args[0], "https://www.paynow.co.zw/interface/remotetransaction")
        self.assertEqual(sent["amount"], "50.00")
        self.assertEqual(sent["method"], "ecocash")
        self.assertEqual(sent["resulturl"], "https://htwm.example/api/payments/paynow/result")
        self.assertEqual(sent["authemail"], "office@example.com")
        values = [v for k, v in post.call_args.kwargs["data"] if k != "hash"]
        self.assertEqual(sent["hash"], paynow.make_hash(values))

    def test_phone_numbers_are_tidied_and_checked(self):
        res, post = self.start(phone="+263 77 111 1111")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(dict(post.call_args.kwargs["data"])["phone"], "0771111111")
        res, _ = self.start(phone="12345")
        self.assertEqual(res.status_code, 400)
        self.assertIn("phone", res.json())

    def test_innbucks_returns_code_and_app_link(self):
        reply = paynow_reply([("status", "Ok"), ("pollurl", "https://www.paynow.co.zw/x"),
                              ("authorizationcode", "123456789"), ("authorizationexpires", "7-Nov-2026 10:15")])
        res, _ = self.start(provider="innbucks", reply=reply)
        body = res.json()
        self.assertEqual(body["next"], "innbucks_code")
        self.assertEqual(body["authorization_code"], "123456789")
        self.assertEqual(body["deep_link"], "com.innbucks.customer://purchase?paymentToken=123456789")

    def test_omari_otp_completes_payment(self):
        reply = paynow_reply([("status", "Ok"), ("pollurl", "https://www.paynow.co.zw/x"),
                              ("otpreference", "OTP-77"), ("remoteotpurl", "https://www.paynow.co.zw/otp/1")])
        res, _ = self.start(provider="omari", reply=reply)
        body = res.json()
        self.assertEqual((body["next"], body["otp_reference"]), ("omari_otp", "OTP-77"))
        gift = Gift.objects.get(public_id=body["id"])
        paid = paynow_reply([("reference", gift.provider_order_id), ("paynowreference", "555"), ("amount", "50.00"),
                             ("status", "Paid"), ("pollurl", "https://www.paynow.co.zw/x")])
        with mock.patch("church.paynow.requests.post", return_value=paid) as post:
            res = self.c.post(f"/api/payments/mobile/{gift.public_id}/otp", {"otp": "012345"}, format="json")
        self.assertEqual(res.json()["status"], "received")
        sent = post.call_args.kwargs["data"]
        self.assertEqual(sent[:3], [("id", "1201"), ("otp", "012345"), ("status", "Message")])

    def test_paynow_error_fails_the_gift(self):
        res, _ = self.start(phone="0774444444", reply=mock.Mock(text="status=Error&error=Insufficient+balance"))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"], "Insufficient balance")
        self.assertEqual(Gift.objects.get().status, "failed")

    def test_unsigned_reply_is_rejected(self):
        res, _ = self.start(reply=mock.Mock(text="status=Ok&pollurl=x&hash=NOPE"))
        self.assertEqual(res.status_code, 400)
        self.assertIn("verified", res.json()["detail"])

    def test_status_check_marks_paid_and_checks_amount(self):
        res, _ = self.start()
        gift = Gift.objects.get(public_id=res.json()["id"])
        wrong = paynow_reply([("reference", gift.provider_order_id), ("amount", "5.00"), ("status", "Paid")])
        with mock.patch("church.paynow.requests.post", return_value=wrong):
            self.assertEqual(self.c.get(f"/api/payments/{gift.public_id}").json()["status"], "pending")
        paid = paynow_reply([("reference", gift.provider_order_id), ("paynowreference", "9510"), ("amount", "50.00"),
                             ("status", "Paid")])
        with mock.patch("church.paynow.requests.post", return_value=paid):
            body = self.c.get(f"/api/payments/{gift.public_id}").json()
        self.assertEqual(body["status"], "received")
        gift.refresh_from_db()
        self.assertIsNotNone(gift.confirmed_at)
        self.assertEqual(gift.provider_reference, "9510")

    def test_cancelled_on_phone(self):
        res, _ = self.start(phone="0773333333")
        gift = Gift.objects.get(public_id=res.json()["id"])
        cancelled = paynow_reply([("reference", gift.provider_order_id), ("amount", "50.00"), ("status", "Cancelled")])
        with mock.patch("church.paynow.requests.post", return_value=cancelled):
            self.assertEqual(self.c.get(f"/api/payments/{gift.public_id}").json()["status"], "failed")

    def test_paynow_result_callback(self):
        res, _ = self.start()
        gift = Gift.objects.get(public_id=res.json()["id"])
        fields = [("reference", gift.provider_order_id), ("paynowreference", "777"), ("amount", "50.00"),
                  ("status", "Paid"), ("pollurl", "https://www.paynow.co.zw/x")]
        forged = urlencode(fields + [("hash", "0" * 128)])
        res = self.c.post("/api/payments/paynow/result", forged, content_type="application/x-www-form-urlencoded")
        self.assertEqual(res.status_code, 400)
        gift.refresh_from_db()
        self.assertEqual(gift.status, "pending")
        res = self.c.post("/api/payments/paynow/result", paynow_reply(fields).text,
                          content_type="application/x-www-form-urlencoded")
        self.assertEqual(res.status_code, 200)
        gift.refresh_from_db()
        self.assertEqual(gift.status, "received")
        entry = AuditLog.objects.filter(object_type="gift", action="update").first()
        self.assertEqual(entry.actor_label, "Online payments")
        self.assertEqual(entry.changes["status"], ["pending", "received"])
        self.assertNotIn("0771111111", str(AuditLog.objects.filter(object_type="gift").values_list("changes")))

    @override_settings(PAYNOW_INTEGRATION_ID="")
    def test_not_set_up(self):
        res = self.c.post("/api/payments/mobile", {**GIFT, "provider": "ecocash", "phone": "0771111111"}, format="json")
        self.assertEqual(res.status_code, 503)


def paypal_api(capture_status="COMPLETED", amount="50.00", currency="USD", error=None):
    """Fake PayPal: token, create order, capture."""
    def post(url, **kw):
        return mock.Mock(status_code=200, json=lambda: {"access_token": "tok", "expires_in": 3600})

    def request(method, url, **kw):
        if url.endswith("/v2/checkout/orders"):
            request.order_body = kw["json"]
            return mock.Mock(status_code=201, content=b"x", json=lambda: {"id": "5O190127TN364715T", "status": "CREATED"})
        if error:
            return mock.Mock(status_code=422, content=b"x",
                             json=lambda: {"message": "Unprocessable", "details": [{"issue": error}]})
        body = {"status": "COMPLETED" if capture_status == "COMPLETED" else "PENDING", "purchase_units": [{"payments": {
            "captures": [{"id": "3C679366HH908993F", "status": capture_status,
                          "amount": {"value": amount, "currency_code": currency}}]}}]}
        return mock.Mock(status_code=201, content=b"x", json=lambda: body)

    return mock.patch("church.paypal.requests.post", side_effect=post), mock.patch(
        "church.paypal.requests.request", side_effect=request), request


@override_settings(**PAYPAL)
class PayPalTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = APIClient()

    def order_and_capture(self, **fake):
        p1, p2, request = paypal_api(**fake)
        with p1, p2:
            created = self.c.post("/api/payments/paypal/orders", GIFT, format="json")
            captured = self.c.post(f"/api/payments/paypal/orders/{created.json()['order_id']}/capture")
        return created, captured, request

    def test_paid_gift_is_received(self):
        created, captured, request = self.order_and_capture()
        self.assertEqual(created.status_code, 201, created.content)
        unit = request.order_body["purchase_units"][0]
        gift = Gift.objects.get()
        self.assertEqual(unit["amount"], {"currency_code": "USD", "value": "50.00"})
        self.assertEqual(unit["invoice_id"], f"TITHE-MOYO-{gift.pk}")
        self.assertEqual(captured.json()["status"], "received")
        gift.refresh_from_db()
        self.assertEqual((gift.method, gift.status, gift.provider_reference), ("paypal", "received", "3C679366HH908993F"))
        self.assertEqual(gift.amount, Decimal("50.00"))

    def test_wrong_amount_is_not_accepted(self):
        _, captured, _ = self.order_and_capture(amount="5.00")
        self.assertEqual(captured.json()["status"], "failed")

    def test_pending_capture_stays_waiting(self):
        _, captured, _ = self.order_and_capture(capture_status="PENDING")
        self.assertEqual(captured.json()["status"], "pending")

    def test_declined_card_can_retry(self):
        _, captured, _ = self.order_and_capture(error="INSTRUMENT_DECLINED")
        self.assertEqual(captured.status_code, 422)
        self.assertEqual(captured.json()["code"], "instrument_declined")
        self.assertEqual(Gift.objects.get().status, "pending")

    def test_bad_amount_never_reaches_paypal(self):
        p1, p2, _ = paypal_api()
        with p1, p2 as request:
            res = self.c.post("/api/payments/paypal/orders", {**GIFT, "amount": "0.50"}, format="json")
        self.assertEqual(res.status_code, 400)
        request.assert_not_called()
        self.assertEqual(Gift.objects.count(), 0)

    def test_status_link_shows_result(self):
        created, _, _ = self.order_and_capture()
        body = self.c.get(f"/api/payments/{created.json()['gift']}").json()
        self.assertEqual((body["status"], body["label"], body["payment_label"]), ("received", "Tithe", "PayPal or card"))

    @override_settings(PAYPAL_CLIENT_SECRET="")
    def test_not_set_up(self):
        self.assertEqual(self.c.post("/api/payments/paypal/orders", GIFT, format="json").status_code, 503)


class UnfinishedPaymentTests(TestCase):
    def test_abandoned_payments_stop_counting_as_waiting(self):
        from datetime import timedelta

        from django.utils import timezone

        from accounts.roles import ADMIN
        from accounts.tests import PASSWORD, make_staff

        from .models import GivingCategory

        tithe = GivingCategory.objects.get(key="tithe")
        old = Gift.objects.create(category=tithe, amount=Decimal("20"), currency="USD", method="paypal", reference="TITHE")
        Gift.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=2))
        fresh = Gift.objects.create(category=tithe, amount=Decimal("30"), currency="USD", method="mobile", reference="TITHE")

        make_staff("office", ADMIN)
        c = APIClient()
        c.login(username="office", password=PASSWORD)
        self.assertEqual(c.get("/api/admin/dashboard").json()["gifts"]["pending_count"], 1)

        old.refresh_from_db()
        fresh.refresh_from_db()
        self.assertEqual((old.status, old.provider_status), ("failed", "Not completed"))
        self.assertEqual(fresh.status, "pending")
        entry = AuditLog.objects.filter(object_type="gift", object_id=str(old.pk), action="update").first()
        self.assertIsNone(entry.actor)  # done by the system, not the person viewing the dashboard
        self.assertEqual(entry.source, "system")
