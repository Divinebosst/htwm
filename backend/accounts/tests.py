from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from church.models import Event, Gift, GivingCategory, PrayerRequest

from .models import StaffProfile
from .roles import ADMIN, CARETAKER, PASTOR, SYSTEM_ADMIN

User = get_user_model()
PASSWORD = "Strong-pass-2026!"


def make_staff(username, role, **extra):
    user = User.objects.create_user(username=username, password=PASSWORD, **extra)
    StaffProfile.objects.create(user=user, role=role)
    return user


class StaffTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.sysadmin = make_staff("sys", SYSTEM_ADMIN)
        self.admin = make_staff("office", ADMIN)
        self.pastor = make_staff("pastor", PASTOR)
        self.caretaker = make_staff("caretaker", CARETAKER)

    def client_for(self, user):
        c = APIClient()
        self.assertTrue(c.login(username=user.username, password=PASSWORD))
        return c


class SignInTests(StaffTestCase):
    def test_login_needs_csrf_token(self):
        c = APIClient(enforce_csrf_checks=True)
        res = c.post("/api/auth/login", {"username": "office", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 403)
        c.get("/api/auth/csrf")
        token = c.cookies["csrftoken"].value
        res = c.post("/api/auth/login", {"username": "office", "password": PASSWORD}, format="json",
                     HTTP_X_CSRFTOKEN=token)
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["role"], ADMIN)
        self.assertIn("gifts.edit", body["permissions"])
        self.assertNotIn("settings.edit_payment", body["permissions"])
        self.assertEqual(c.get("/api/auth/me").json()["username"], "office")

    def test_untrusted_site_address_gets_a_clear_message(self):
        """A website address missing from DJANGO_CSRF_TRUSTED_ORIGINS is explained, then works once added."""
        from django.test import override_settings

        c = APIClient(enforce_csrf_checks=True)
        c.get("/api/auth/csrf")
        token = c.cookies["csrftoken"].value
        login = {"username": "office", "password": PASSWORD}
        res = c.post("/api/auth/login", login, format="json", HTTP_X_CSRFTOKEN=token,
                     HTTP_ORIGIN="https://htwm.vercel.app")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["code"], "csrf_untrusted_origin")
        self.assertIn("https://htwm.vercel.app", res.json()["detail"])
        self.assertIn("DJANGO_CSRF_TRUSTED_ORIGINS", res.json()["detail"])
        with override_settings(CSRF_TRUSTED_ORIGINS=["https://htwm.vercel.app"]):
            res = c.post("/api/auth/login", login, format="json", HTTP_X_CSRFTOKEN=token,
                         HTTP_ORIGIN="https://htwm.vercel.app")
        self.assertEqual(res.status_code, 200, res.content)

    def test_wrong_password_is_rejected_and_logged(self):
        res = APIClient().post("/api/auth/login", {"username": "office", "password": "nope"}, format="json")
        self.assertEqual(res.status_code, 400)
        entry = AuditLog.objects.filter(action="login_failed").get()
        self.assertEqual(entry.actor_label, "office")

    def test_successful_login_and_logout_are_logged(self):
        c = APIClient()
        c.post("/api/auth/login", {"username": "pastor", "password": PASSWORD}, format="json",
               HTTP_X_FORWARDED_FOR="41.60.1.2")
        login = AuditLog.objects.get(action="login")
        self.assertEqual(login.actor, self.pastor)
        self.assertEqual(login.actor_role, "Pastor")
        self.assertEqual(login.ip_address, "41.60.1.2")
        c.post("/api/auth/logout")
        self.assertTrue(AuditLog.objects.filter(action="logout", actor=self.pastor).exists())
        self.assertEqual(c.get("/api/auth/me").status_code, 401)

    def test_account_without_role_cannot_sign_in(self):
        User.objects.create_user(username="member", password=PASSWORD)
        res = APIClient().post("/api/auth/login", {"username": "member", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_deactivated_account_cannot_sign_in(self):
        self.caretaker.is_active = False
        self.caretaker.save()
        res = APIClient().post("/api/auth/login", {"username": "caretaker", "password": PASSWORD}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_not_signed_in_gets_401(self):
        self.assertEqual(APIClient().get("/api/admin/dashboard").status_code, 401)

    def test_createsuperuser_becomes_system_admin(self):
        boss = User.objects.create_superuser("boss", "boss@example.com", PASSWORD)
        self.assertEqual(boss.staff_profile.role, SYSTEM_ADMIN)

    def test_django_admin_lists_open_for_system_admin(self):
        """Every built-in admin list loads for a System Admin."""
        Event.objects.create(title="Crusade", starts_at=timezone.now() + timedelta(days=3), summary="x")
        Gift.objects.create(category=GivingCategory.objects.get(key="tithe"), amount=10, currency="USD",
                            method="bank", reference="TITHE-X")
        c = self.client_for(self.sysadmin)
        for path in ["church/event", "church/gift", "church/prayerrequest", "church/servicetime",
                     "church/givingcategory", "audit/auditlog", "auth/user"]:
            self.assertEqual(c.get(f"/django-admin/{path}/").status_code, 200, path)
        self.assertEqual(self.client_for(self.admin).get("/django-admin/").status_code, 302)  # not for Admins

    def test_role_controls_django_admin_access(self):
        self.assertTrue(User.objects.get(pk=self.sysadmin.pk).is_superuser)
        self.assertFalse(User.objects.get(pk=self.admin.pk).is_staff)


class PermissionMatrixTests(StaffTestCase):
    """Each role against each area: (method, path, payload) -> expected status per role."""

    def setUp(self):
        super().setUp()
        self.gift = Gift.objects.create(category=GivingCategory.objects.get(key="tithe"), amount=10, currency="USD",
                                        method="bank", reference="TITHE-X")
        self.prayer = PrayerRequest.objects.create(message="Pray for me", is_private=False)
        self.event = Event.objects.create(title="Crusade", starts_at=timezone.now() + timedelta(days=3), summary="x")

    def check(self, method, path, expected, data=None):
        users = {SYSTEM_ADMIN: self.sysadmin, ADMIN: self.admin, PASTOR: self.pastor, CARETAKER: self.caretaker}
        for role, want in expected.items():
            c = self.client_for(users[role])
            res = getattr(c, method)(path, data or {}, format="json")
            self.assertEqual(res.status_code, want, f"{role} {method.upper()} {path}: {res.content[:200]}")

    def test_matrix(self):
        all_ok = {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 200, CARETAKER: 200}
        self.check("get", "/api/admin/dashboard", all_ok)
        self.check("get", "/api/admin/events", all_ok)
        self.check("patch", f"/api/admin/events/{self.event.pk}", all_ok, {"location": "Main hall"})
        self.check("get", "/api/admin/services", all_ok)
        self.check("get", "/api/admin/prayer-requests", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 200, CARETAKER: 403})
        self.check("patch", f"/api/admin/prayer-requests/{self.prayer.pk}",
                   {SYSTEM_ADMIN: 200, ADMIN: 403, PASTOR: 200, CARETAKER: 403}, {"status": "prayed"})
        self.check("get", "/api/admin/gifts", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 200, CARETAKER: 403})
        self.check("patch", f"/api/admin/gifts/{self.gift.pk}",
                   {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 403, CARETAKER: 403}, {"staff_notes": "seen"})
        self.check("get", "/api/admin/giving-categories", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 403, CARETAKER: 403})
        self.check("get", "/api/admin/settings", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 403, CARETAKER: 403})
        self.check("patch", "/api/admin/settings", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 403, CARETAKER: 403},
                   {"phone_primary": "0775 856 800"})
        # Payment details: only a System Admin may change them (try the others first)
        self.check("patch", "/api/admin/settings", {ADMIN: 403, PASTOR: 403, CARETAKER: 403},
                   {"bank_account_number": "123456"})
        self.check("patch", "/api/admin/settings", {SYSTEM_ADMIN: 200}, {"bank_account_number": "123456"})
        self.check("get", "/api/admin/users", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 403, CARETAKER: 403})
        self.check("get", "/api/admin/audit", {SYSTEM_ADMIN: 200, ADMIN: 200, PASTOR: 403, CARETAKER: 403})

    def test_denied_access_is_logged(self):
        self.client_for(self.caretaker).get("/api/admin/gifts")
        entry = AuditLog.objects.get(action="access_denied")
        self.assertEqual(entry.actor, self.caretaker)
        self.assertEqual(entry.changes["needed"], "gifts.view")

    def test_private_prayer_requests_only_for_pastors_and_system_admins(self):
        PrayerRequest.objects.create(message="Private matter", is_private=True)
        counts = {}
        for user in (self.sysadmin, self.admin, self.pastor):
            counts[user.username] = self.client_for(user).get("/api/admin/prayer-requests").json()["count"]
        self.assertEqual(counts, {"sys": 2, "office": 1, "pastor": 2})

    def test_dashboard_only_shows_allowed_sections(self):
        data = self.client_for(self.caretaker).get("/api/admin/dashboard").json()
        self.assertIn("events", data)
        for hidden in ("gifts", "prayer", "activity", "staff"):
            self.assertNotIn(hidden, data)
        self.assertIn("gifts", self.client_for(self.pastor).get("/api/admin/dashboard").json())


class StaffAccountTests(StaffTestCase):
    def test_admin_can_create_pastor_with_temporary_password(self):
        res = self.client_for(self.admin).post(
            "/api/admin/users", {"username": "newpastor", "first_name": "Rudo", "role": PASTOR}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        temp = res.json()["temporary_password"]
        user = User.objects.get(username="newpastor")
        self.assertTrue(user.check_password(temp))
        self.assertTrue(user.staff_profile.must_change_password)

    def test_admin_cannot_create_or_change_admins(self):
        c = self.client_for(self.admin)
        res = c.post("/api/admin/users", {"username": "x", "role": ADMIN}, format="json")
        self.assertEqual(res.status_code, 403)
        other_admin = make_staff("office2", ADMIN)
        self.assertEqual(c.patch(f"/api/admin/users/{other_admin.pk}", {"first_name": "Z"}, format="json").status_code, 403)
        self.assertEqual(c.patch(f"/api/admin/users/{self.sysadmin.pk}", {"is_active": False}, format="json").status_code, 403)
        self.assertEqual(c.patch(f"/api/admin/users/{self.pastor.pk}", {"role": ADMIN}, format="json").status_code, 403)

    def test_nobody_changes_their_own_role_here(self):
        res = self.client_for(self.sysadmin).patch(f"/api/admin/users/{self.sysadmin.pk}", {"role": CARETAKER},
                                                   format="json")
        self.assertEqual(res.status_code, 403)

    def test_system_admin_can_change_another_system_admin(self):
        other = make_staff("sys2", SYSTEM_ADMIN)
        res = self.client_for(other).patch(f"/api/admin/users/{self.sysadmin.pk}", {"role": ADMIN}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(StaffProfile.objects.get(user=self.sysadmin).role, ADMIN)
        self.assertFalse(User.objects.get(pk=self.sysadmin.pk).is_superuser)
        role_change = AuditLog.objects.get(action="update", object_type="staff role")
        self.assertEqual(role_change.changes["role"], [SYSTEM_ADMIN, ADMIN])
        self.assertEqual(role_change.actor, other)

    def test_last_active_system_admin_check(self):
        from .views import _other_active_system_admins

        self.assertFalse(_other_active_system_admins(exclude=self.sysadmin))
        make_staff("sys2", SYSTEM_ADMIN)
        self.assertTrue(_other_active_system_admins(exclude=self.sysadmin))

    def test_reset_password_forces_change_before_anything_else(self):
        res = self.client_for(self.admin).post(f"/api/admin/users/{self.caretaker.pk}/reset-password")
        self.assertEqual(res.status_code, 200)
        temp = res.json()["temporary_password"]
        self.assertTrue(AuditLog.objects.filter(action="password_reset", object_repr="caretaker").exists())

        c = APIClient()
        self.assertTrue(c.login(username="caretaker", password=temp))
        blocked = c.get("/api/admin/events")
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["code"], "password_change_required")
        self.assertTrue(c.get("/api/auth/me").json()["must_change_password"])

        res = c.post("/api/auth/password", {"current_password": temp, "new_password": "Another-good-pass-9"},
                     format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.json()["must_change_password"])
        self.assertEqual(c.get("/api/admin/events").status_code, 200)  # still signed in
        self.assertTrue(AuditLog.objects.filter(action="password_change", actor=self.caretaker).exists())

    def test_weak_new_password_is_refused(self):
        res = self.client_for(self.pastor).post("/api/auth/password",
                                                {"current_password": PASSWORD, "new_password": "123"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_deactivate_and_reactivate(self):
        c = self.client_for(self.admin)
        self.assertEqual(c.patch(f"/api/admin/users/{self.pastor.pk}", {"is_active": False}, format="json").status_code, 200)
        self.assertFalse(APIClient().login(username="pastor", password=PASSWORD))
        res = c.patch(f"/api/admin/users/{self.pastor.pk}", {"is_active": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(APIClient().login(username="pastor", password=PASSWORD))
