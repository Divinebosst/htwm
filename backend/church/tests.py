from datetime import timedelta

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Event, GivingCategory, PrayerRequest, SiteSettings, build_reference


class ReferenceTests(TestCase):
    def test_reference_uses_surname(self):
        self.assertEqual(build_reference("TITHE", "Tendai Moyo"), "TITHE-MOYO")

    def test_anonymous_or_blank_name_has_no_surname(self):
        self.assertEqual(build_reference("TITHE", "Tendai Moyo", anonymous=True), "TITHE")
        self.assertEqual(build_reference("SEED", "   "), "SEED")

    def test_strips_non_letters(self):
        self.assertEqual(build_reference("GIFT", "Mary O'Neil-Smith"), "GIFT-ONEILSMITH")


class ApiTests(TestCase):
    def setUp(self):
        cache.clear()  # reset rate limits between tests
        self.client = APIClient()

    def test_settings_has_giving_details(self):
        data = self.client.get("/api/settings").json()
        self.assertEqual(data["giving"]["currency"], "USD")
        self.assertEqual(data["giving"]["preset_amounts"], [10, 20, 50, 100, 200, 500])
        self.assertEqual(data["whatsapp"], "263775856800")
        self.assertEqual(len(data["giving"]["ecocash"]["steps"]), 4)
        # No payment keys set up in tests, so online giving reports itself as off
        self.assertEqual(data["giving"]["paypal_client_id"], "")
        self.assertFalse(data["giving"]["mobile_money_enabled"])

    def test_giving_categories_come_from_migration(self):
        keys = [c["key"] for c in self.client.get("/api/giving-categories").json()]
        self.assertEqual(keys[:2], ["tithe", "offering"])
        self.assertIn("other", keys)

    def test_events_lists_upcoming_only_by_default(self):
        now = timezone.now()
        Event.objects.create(title="Old", starts_at=now - timedelta(days=10), summary="x")
        Event.objects.create(title="Soon", starts_at=now + timedelta(days=2), summary="x")
        Event.objects.create(title="Later", starts_at=now + timedelta(days=9), summary="x")
        Event.objects.create(title="Hidden", starts_at=now + timedelta(days=3), summary="x", is_published=False)
        Event.objects.create(  # started yesterday, still running
            title="Running", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1), summary="x"
        )

        titles = [e["title"] for e in self.client.get("/api/events").json()]
        self.assertEqual(titles, ["Running", "Soon", "Later"])

        self.assertEqual(len(self.client.get("/api/events?limit=2").json()), 2)
        past = [e["title"] for e in self.client.get("/api/events?when=past").json()]
        self.assertEqual(past, ["Old"])

    def test_event_detail_by_slug(self):
        e = Event.objects.create(title="Youth Night", starts_at=timezone.now() + timedelta(days=4), summary="x")
        self.assertTrue(e.slug.startswith("youth-night-"))
        res = self.client.get(f"/api/events/{e.slug}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], "Youth Night")
        self.assertEqual(self.client.get("/api/events/nope").status_code, 404)

    def test_prayer_request(self):
        res = self.client.post(
            "/api/prayer-requests/",
            {"name": "Rudo", "contact": "0771 000 000", "kind": "prayer", "message": "Healing for my mother"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(PrayerRequest.objects.get().message, "Healing for my mother")

    def test_prayer_request_needs_message_and_blocks_bots(self):
        self.assertEqual(self.client.post("/api/prayer-requests", {"message": "  "}, format="json").status_code, 400)
        res = self.client.post("/api/prayer-requests", {"message": "hi", "website": "spam.example"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(PrayerRequest.objects.count(), 0)

    def test_prayer_requests_are_rate_limited(self):
        statuses = [
            self.client.post("/api/prayer-requests", {"message": f"r{i}"}, format="json").status_code
            for i in range(12)
        ]
        self.assertEqual(statuses.count(201), 10)
        self.assertEqual(statuses[-1], 429)

    def test_settings_is_a_single_row(self):
        SiteSettings(currency="ZAR").save()
        self.assertEqual(SiteSettings.objects.count(), 1)
        self.assertEqual(self.client.get("/api/settings").json()["giving"]["currency"], "ZAR")


class SampleContentTests(TestCase):
    def test_load_and_clear_samples(self):
        call_command("load_sample_content", verbosity=0)
        self.assertEqual(Event.objects.count(), 6)
        self.assertTrue(Event.objects.upcoming().exists())
        call_command("load_sample_content", verbosity=0)  # running twice adds nothing new
        self.assertEqual(Event.objects.count(), 6)
        call_command("load_sample_content", clear=True, verbosity=0)
        self.assertEqual(Event.objects.count(), 0)
