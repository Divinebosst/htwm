"""Store tests. PayPal and Paynow are simulated; no real money or network."""

from decimal import Decimal
from io import BytesIO, StringIO
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.roles import ADMIN, CARETAKER, PASTOR, SYSTEM_ADMIN
from accounts.tests import PASSWORD, make_staff
from audit.models import AuditLog
from church.models import SiteSettings
from church.test_payments import PAYNOW, PAYPAL, paynow_reply, paypal_api

from .models import Order, Product

BUYER = {"name": "Tendai Moyo", "contact_phone": "0771 234 567", "email": "tendai@example.com",
         "fulfilment": "collect"}


def make_products():
    book = Product.objects.create(name="Healing Is Your Portion", category="books", summary="A book", price="15.00",
                                  stock=10)
    shirt = Product.objects.create(name="Church T-shirt", category="clothing", summary="Cotton", price="18.00",
                                   options="S, M, L", stock=None)
    mug = Product.objects.create(name="Mug", category="gifts", summary="Ceramic", price="10.00", stock=2)
    hidden = Product.objects.create(name="Old item", category="gifts", summary="Gone", price="1.00", is_published=False)
    return book, shirt, mug, hidden


def cart(*lines):
    return [{"product": p.slug, "option": option, "quantity": q} for p, option, q in lines]


class CatalogueTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = APIClient()
        self.book, self.shirt, self.mug, self.hidden = make_products()

    def test_only_published_items_are_listed(self):
        slugs = [p["slug"] for p in self.c.get("/api/store/products").json()]
        self.assertNotIn(self.hidden.slug, slugs)
        self.assertEqual(len(slugs), 3)
        self.assertEqual(self.c.get(f"/api/store/products/{self.hidden.slug}").status_code, 404)
        detail = self.c.get(f"/api/store/products/{self.shirt.slug}").json()
        self.assertEqual((detail["price"], detail["options"]), ("18.00", ["S", "M", "L"]))
        self.assertEqual(self.c.get(f"/api/store/products/{self.mug.slug}").json()["stock_left"], 2)

    def test_store_page_addresses_are_kept_free(self):
        self.assertEqual(Product.objects.create(name="Cart", summary="x", price="1.00").slug, "cart-item")

    def test_quote_uses_store_prices_and_stock(self):
        res = self.c.post("/api/store/quote", {"items": cart((self.shirt, "M", 1), (self.shirt, "M", 2),
                                                             (self.book, "", 1), (self.mug, "", 3),
                                                             (self.shirt, "", 1), (self.hidden, "", 1))},
                          format="json").json()
        lines = {(line["product"], line["option"]): line for line in res["lines"]}
        self.assertEqual(lines[(self.shirt.slug, "M")]["quantity"], 3)  # same item twice becomes one line
        self.assertEqual(lines[(self.shirt.slug, "M")]["line_total"], "54.00")
        self.assertEqual(res["subtotal"], "99.00")  # 54 + 15 + 3 mugs at 10
        messages = {(p["product"], p["message"]) for p in res["problems"]}
        self.assertIn((self.mug.slug, "Only 2 left. Please lower the quantity."), messages)
        self.assertIn((self.shirt.slug, "Choose a size."), messages)
        self.assertIn((self.hidden.slug, "This item is no longer in the store."), messages)


@override_settings(**PAYPAL)
class PayPalCheckoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = APIClient()
        self.book, self.shirt, self.mug, _ = make_products()

    def checkout(self, body, amount):
        p1, p2, request = paypal_api(amount=amount)
        with p1, p2:
            created = self.c.post("/api/store/checkout/paypal", body, format="json")
            if created.status_code != 201:
                return created, None, request
            captured = self.c.post(f"/api/store/checkout/paypal/{created.json()['order_id']}/capture")
        return created, captured, request

    def test_paid_order_takes_stock(self):
        body = {**BUYER, "items": cart((self.book, "", 2), (self.shirt, "L", 1))}
        created, captured, request = self.checkout(body, "48.00")
        self.assertEqual(created.status_code, 201, created.content)
        unit = request.order_body["purchase_units"][0]
        order = Order.objects.get()
        self.assertEqual(unit["amount"]["value"], "48.00")
        self.assertEqual(unit["invoice_id"], f"ORDER-{order.pk}")
        result = captured.json()
        self.assertEqual((result["payment"], result["status"], result["number"]), ("paid", "paid", order.pk))
        self.assertEqual([(i["name"], i["option"], i["quantity"]) for i in result["items"]],
                         [("Healing Is Your Portion", "", 2), ("Church T-shirt", "L", 1)])
        self.book.refresh_from_db()
        self.assertEqual(self.book.stock, 8)
        # Paying twice (e.g. callback and capture) never takes stock twice
        order.refresh_from_db()
        order.payment_received("again")
        self.book.refresh_from_db()
        self.assertEqual(self.book.stock, 8)

    def test_delivery_adds_fee_and_needs_address(self):
        body = {**BUYER, "fulfilment": "delivery", "items": cart((self.book, "", 1))}
        res = self.c.post("/api/store/checkout/paypal", body, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("address", res.json())
        created, captured, _ = self.checkout({**body, "address": "12 Samora Machel Ave, Harare"}, "20.00")
        self.assertEqual(created.status_code, 201)
        order = Order.objects.get()
        self.assertEqual((order.subtotal, order.delivery_fee, order.total),
                         (Decimal("15.00"), Decimal("5.00"), Decimal("20.00")))
        self.assertEqual(captured.json()["payment"], "paid")

    def test_changed_cart_is_refused_before_paypal(self):
        p1, p2, _ = paypal_api()
        with p1, p2 as request:
            res = self.c.post("/api/store/checkout/paypal", {**BUYER, "items": cart((self.mug, "", 5))}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "cart_changed")
        request.assert_not_called()
        self.assertEqual(Order.objects.count(), 0)

    def test_short_payment_is_not_accepted(self):
        _, captured, _ = self.checkout({**BUYER, "items": cart((self.book, "", 1))}, "1.00")
        self.assertEqual(captured.json()["payment"], "failed")
        self.book.refresh_from_db()
        self.assertEqual(self.book.stock, 10)


@override_settings(**PAYNOW)
class MobileCheckoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = APIClient()
        self.book, self.shirt, self.mug, _ = make_products()

    def start(self, provider="ecocash"):
        reply = paynow_reply([("status", "Ok"), ("instructions", "Approve on your phone"),
                              ("pollurl", "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"),
                              ("paynowreference", "9510")])
        body = {**BUYER, "items": cart((self.mug, "", 2)), "provider": provider, "phone": "0771 111 111"}
        with mock.patch("church.paynow.requests.post", return_value=reply) as post:
            res = self.c.post("/api/store/checkout/mobile", body, format="json")
        return res, post

    def test_paynow_message_marks_order_paid(self):
        res, post = self.start()
        self.assertEqual(res.status_code, 201, res.content)
        order = Order.objects.get()
        sent = dict(post.call_args.kwargs["data"])
        self.assertEqual((sent["reference"], sent["amount"], sent["phone"], sent["method"]),
                         (f"ORDER-{order.pk}", "20.00", "0771111111", "ecocash"))
        self.assertEqual((res.json()["next"], res.json()["payment"]), ("approve", "pending"))

        fields = [("reference", f"ORDER-{order.pk}"), ("paynowreference", "777"), ("amount", "20.00"),
                  ("status", "Paid"), ("pollurl", "https://www.paynow.co.zw/x")]
        for _ in range(2):  # Paynow may send the same news twice
            r = self.c.post("/api/payments/paynow/result", paynow_reply(fields).text,
                            content_type="application/x-www-form-urlencoded")
            self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual((order.status, order.provider_reference), ("paid", "777"))
        self.mug.refresh_from_db()
        self.assertEqual(self.mug.stock, 0)
        self.assertEqual(self.c.get(f"/api/store/orders/{order.public_id}").json()["status_label"], "Paid, to prepare")
        log = str(AuditLog.objects.filter(object_type="order").values_list("changes", "actor_label"))
        self.assertIn("Online payments", log)
        self.assertNotIn("0771", log)

    def test_waiting_page_checks_with_paynow(self):
        res, _ = self.start()
        order = Order.objects.get()
        cancelled = paynow_reply([("reference", f"ORDER-{order.pk}"), ("amount", "20.00"), ("status", "Cancelled")])
        with mock.patch("church.paynow.requests.post", return_value=cancelled):
            body = self.c.get(f"/api/store/orders/{res.json()['id']}").json()
        self.assertEqual((body["payment"], body["status"]), ("failed", "failed"))

    def test_omari_code(self):
        res, _ = self.start(provider="omari")
        self.assertEqual(res.json()["next"], "omari_otp")


class StoreStaffTests(TestCase):
    def setUp(self):
        cache.clear()
        self.book, self.shirt, self.mug, _ = make_products()
        self.order = Order.objects.create(customer_name="Rudo", contact_phone="0772", subtotal=Decimal("10"),
                                          total=Decimal("10"), currency="USD", method="mobile")
        self.order.items.create(product=self.mug, name="Mug", unit_price=Decimal("10"), quantity=1,
                                line_total=Decimal("10"))

    def client_for(self, role):
        make_staff(role, role)
        c = APIClient()
        c.login(username=role, password=PASSWORD)
        return c

    def test_who_can_do_what(self):
        expected = {SYSTEM_ADMIN: (200, 200, 200), ADMIN: (200, 200, 200), PASTOR: (403, 200, 403),
                    CARETAKER: (403, 403, 403)}
        for role, (items, orders_view, orders_edit) in expected.items():
            c = self.client_for(role)
            self.assertEqual(c.get("/api/admin/store/products").status_code, items, role)
            self.assertEqual(c.get("/api/admin/store/orders").status_code, orders_view, role)
            self.assertEqual(c.patch(f"/api/admin/store/orders/{self.order.pk}", {"staff_notes": "x"},
                                     format="json").status_code, orders_edit, role)

    def test_add_item_with_picture(self):
        c = self.client_for(ADMIN)
        res = c.post("/api/admin/store/products", {"name": "Prayer Journal", "category": "books", "summary": "90 days",
                                                   "price": "9.00", "options": "a, b , a,", "stock": 5}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.json()["slug"], res.json()["options"]), ("prayer-journal", "a, b"))
        buf = BytesIO()
        Image.new("RGB", (40, 40), "navy").save(buf, "JPEG")
        upload = SimpleUploadedFile("journal.jpg", buf.getvalue(), content_type="image/jpeg")
        res = c.post(f"/api/admin/store/products/{res.json()['id']}/image", {"image": upload}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["image_url"].startswith("/media/store/"))
        self.assertTrue(AuditLog.objects.filter(object_type="store item", action="create", object_repr="Prayer Journal",
                                                actor_label="admin").exists())
        Product.objects.get(slug="prayer-journal").image.delete(save=False)

    def test_order_status_rules_and_stock(self):
        c = self.client_for(ADMIN)
        url = f"/api/admin/store/orders/{self.order.pk}"
        self.assertEqual(c.patch(url, {"status": "ready"}, format="json").status_code, 400)  # not paid yet
        self.order.payment_received("777", "Paid")
        self.mug.refresh_from_db()
        self.assertEqual(self.mug.stock, 1)
        self.assertEqual(c.patch(url, {"status": "ready"}, format="json").json()["status_label"], "Ready / on its way")
        self.assertEqual(c.patch(url, {"status": "pending"}, format="json").status_code, 400)
        self.assertEqual(c.patch(url, {"status": "cancelled"}, format="json").status_code, 200)
        self.mug.refresh_from_db()
        self.assertEqual(self.mug.stock, 2)  # cancelled: back in stock
        entry = AuditLog.objects.filter(object_type="order", action="update").first()
        self.assertNotIn("Rudo", str(entry.changes))

    def test_dashboard_shows_orders_to_those_allowed(self):
        self.order.payment_received("777", "Paid")
        self.assertEqual(self.client_for(PASTOR).get("/api/admin/dashboard").json()["orders"]["to_prepare_count"], 1)
        self.assertNotIn("orders", self.client_for(CARETAKER).get("/api/admin/dashboard").json())

    def test_delivery_settings(self):
        c = self.client_for(ADMIN)
        res = c.patch("/api/admin/store/settings", {"store_delivery_fee": "7.50", "store_delivery_enabled": False},
                      format="json")
        self.assertEqual(res.status_code, 200, res.content)
        store = APIClient().get("/api/settings").json()["store"]
        self.assertEqual((store["delivery_fee"], store["delivery_enabled"]), ("7.50", False))
        self.assertEqual(SiteSettings.load().store_delivery_fee, Decimal("7.50"))


class SampleStoreCommandTests(TestCase):
    def test_add_and_clear(self):
        out = StringIO()
        call_command("load_sample_store", "--orders", stdout=out)
        call_command("load_sample_store", stdout=out)  # again: updates, no copies
        self.assertEqual(Product.objects.filter(slug__startswith="sample-").count(), 11)
        self.assertEqual(Order.objects.count(), 4)
        self.assertTrue(all(p.image for p in Product.objects.all()))
        call_command("load_sample_store", "--clear", stdout=out)
        self.assertEqual((Product.objects.count(), Order.objects.count()), (0, 0))
