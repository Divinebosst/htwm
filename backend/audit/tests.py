from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.roles import ADMIN, PASTOR, SYSTEM_ADMIN
from accounts.tests import PASSWORD, make_staff
from church.models import Event, Gift, GivingCategory, PrayerRequest, SiteSettings

from .models import AuditLog


class AuditTrailTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = make_staff("office", ADMIN)
        self.c = APIClient()
        self.c.login(username="office", password=PASSWORD)

    def test_event_create_update_delete_are_logged_with_who_and_what(self):
        res = self.c.post(
            "/api/admin/events",
            {"title": "Youth Night", "starts_at": (timezone.now() + timedelta(days=5)).isoformat(),
             "summary": "Bring a friend", "category": "youth"},
            format="json", HTTP_X_FORWARDED_FOR="102.1.2.3", HTTP_USER_AGENT="TestBrowser/1.0",
        )
        self.assertEqual(res.status_code, 201, res.content)
        pk = res.json()["id"]
        self.c.patch(f"/api/admin/events/{pk}", {"location": "Main hall", "is_featured": True}, format="json")
        self.c.delete(f"/api/admin/events/{pk}")

        created, updated, deleted = AuditLog.objects.filter(object_type="event").order_by("id")
        self.assertEqual(created.action, "create")
        self.assertEqual(created.actor, self.admin)
        self.assertEqual(created.actor_role, "Admin")
        self.assertEqual(created.source, "staff")
        self.assertEqual(created.ip_address, "102.1.2.3")
        self.assertEqual(created.user_agent, "TestBrowser/1.0")
        self.assertEqual(created.changes["title"], [None, "Youth Night"])
        self.assertEqual(updated.action, "update")
        self.assertEqual(updated.changes, {"location": ["", "Main hall"], "is_featured": [False, True]})
        self.assertEqual(deleted.action, "delete")
        self.assertEqual(deleted.object_repr.split(" (")[0], "Youth Night")

    def test_same_time_in_another_time_zone_is_not_a_change(self):
        event = Event.objects.create(title="Night", starts_at=timezone.now() + timedelta(days=1), summary="x")
        harare = event.starts_at.astimezone(__import__("zoneinfo").ZoneInfo("Africa/Harare"))
        self.c.patch(f"/api/admin/events/{event.pk}", {"starts_at": harare.isoformat(), "location": "Hall"},
                     format="json")
        entry = AuditLog.objects.filter(object_type="event", action="update").get()
        self.assertEqual(list(entry.changes), ["location"])

    def test_saving_without_changes_writes_nothing(self):
        event = Event.objects.create(title="Night", starts_at=timezone.now() + timedelta(days=1), summary="x")
        before = AuditLog.objects.count()
        event.save()
        self.assertEqual(AuditLog.objects.count(), before)

    def test_public_prayer_request_keeps_personal_details_out_of_the_log(self):
        APIClient().post("/api/prayer-requests",
                         {"name": "Rudo", "contact": "0771", "message": "Secret matter", "is_private": True},
                         format="json")
        entry = AuditLog.objects.get(object_type="prayer request")
        self.assertEqual(entry.actor_label, "Public website")
        self.assertEqual(entry.source, "public")
        self.assertEqual(entry.changes["message"], [None, "(hidden)"])
        self.assertEqual(entry.changes["name"], [None, "(hidden)"])
        self.assertNotIn("Rudo", entry.object_repr)
        self.assertNotIn("Secret", str(entry.changes))

    def test_gift_status_change_and_bulk_update(self):
        cat = GivingCategory.objects.get(key="tithe")
        g1 = Gift.objects.create(category=cat, amount=10, currency="USD", method="bank", reference="TITHE-A",
                                 giver_contact="0771 000 000")
        g2 = Gift.objects.create(category=cat, amount=20, currency="USD", method="ecocash", reference="TITHE-B")
        self.assertEqual(AuditLog.objects.filter(object_type="gift", action="create").first().changes
                         .get("giver_contact", [None, None])[1] in (None, "(hidden)"), True)
        res = self.c.post("/api/admin/gifts/bulk", {"ids": [g1.pk, g2.pk], "status": "received"}, format="json")
        self.assertEqual(res.json()["changed"], 2)
        g1.refresh_from_db()
        self.assertIsNotNone(g1.confirmed_at)
        updates = AuditLog.objects.filter(object_type="gift", action="update")
        self.assertEqual(updates.count(), 2)
        self.assertEqual(updates.first().changes["status"][1], "received")

    def test_payment_detail_changes_record_old_and_new_values(self):
        sysadmin = make_staff("sys", SYSTEM_ADMIN)
        c = APIClient()
        c.login(username="sys", password=PASSWORD)
        c.patch("/api/admin/settings", {"bank_account_number": "111"}, format="json")
        c.patch("/api/admin/settings", {"bank_account_number": "222"}, format="json")
        last = AuditLog.objects.filter(object_type="church settings").first()
        self.assertEqual(last.changes["bank_account_number"], ["111", "222"])
        self.assertEqual(last.actor, sysadmin)
        self.assertEqual(SiteSettings.load().bank_account_number, "222")

    def test_log_cannot_be_changed_or_deleted(self):
        entry = AuditLog.objects.create(actor_label="x", action="login")
        entry.object_repr = "tampered"
        with self.assertRaises(PermissionError):
            entry.save()
        with self.assertRaises(PermissionError):
            entry.delete()
        with self.assertRaises(PermissionError):
            AuditLog.objects.all().delete()
        with self.assertRaises(PermissionError):
            AuditLog.objects.update(object_repr="tampered")

    def test_audit_list_filters_and_pages(self):
        for i in range(60):
            AuditLog.objects.create(actor_label="bot", action="login_failed", object_repr=f"try {i}")
        data = self.c.get("/api/admin/audit?action=login_failed&page=2").json()
        self.assertEqual(data["count"], 60)
        self.assertEqual(data["pages"], 2)
        self.assertEqual(len(data["results"]), 10)
        self.assertTrue(any(a["value"] == "login_failed" for a in data["filters"]["actions"]))
        found = self.c.get("/api/admin/audit?q=try 7").json()
        self.assertGreaterEqual(found["count"], 1)

    def test_filter_lists_have_no_repeats(self):
        for _ in range(3):
            AuditLog.objects.create(actor_label="x", action="login", object_type="staff account")
        types = self.c.get("/api/admin/audit").json()["filters"]["object_types"]
        self.assertEqual(len(types), len(set(types)))

    def test_pastor_cannot_read_audit_log(self):
        make_staff("pastor", PASTOR)
        c = APIClient()
        c.login(username="pastor", password=PASSWORD)
        self.assertEqual(c.get("/api/admin/audit").status_code, 403)


class AdminContentTests(TestCase):
    def setUp(self):
        cache.clear()
        make_staff("pastor", PASTOR)
        self.c = APIClient()
        self.c.login(username="pastor", password=PASSWORD)

    def test_event_end_must_follow_start(self):
        now = timezone.now()
        res = self.c.post("/api/admin/events", {"title": "X", "summary": "x", "starts_at": now.isoformat(),
                                                "ends_at": (now - timedelta(hours=1)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("ends_at", res.json())

    def test_event_picture_upload(self):
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        event = Event.objects.create(title="Crusade", starts_at=timezone.now() + timedelta(days=3), summary="x")
        buf = io.BytesIO()
        Image.new("RGB", (40, 30), (2, 43, 141)).save(buf, "PNG")
        upload = SimpleUploadedFile("poster.png", buf.getvalue(), content_type="image/png")
        res = self.c.post(f"/api/admin/events/{event.pk}/image", {"image": upload}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["image_url"].startswith("/media/events/"))
        bad = SimpleUploadedFile("notes.txt", b"hello", content_type="text/plain")
        self.assertEqual(self.c.post(f"/api/admin/events/{event.pk}/image", {"image": bad}, format="multipart")
                         .status_code, 400)
        res = self.c.delete(f"/api/admin/events/{event.pk}/image")
        self.assertIsNone(res.json()["image_url"])
        Event.objects.get(pk=event.pk).delete()

    def test_prayer_status_update(self):
        p = PrayerRequest.objects.create(message="Healing", is_private=True)
        res = self.c.patch(f"/api/admin/prayer-requests/{p.pk}", {"status": "prayed", "message": "changed?"},
                           format="json")
        self.assertEqual(res.status_code, 200)
        p.refresh_from_db()
        self.assertEqual(p.status, "prayed")
        self.assertEqual(p.message, "Healing")  # read-only
