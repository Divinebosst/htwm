import secrets

from django.contrib.auth import authenticate, get_user_model, login, logout, password_validation, update_session_auth_hash
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from audit.log import record

from .models import StaffProfile
from .permissions import IsStaffMember, StaffPermission, StaffSessionAuthentication
from .roles import PERMISSIONS, ROLE_CHOICES, SYSTEM_ADMIN, can_manage_role, perms_for_role, role_of, stored_role
from .serializers import LoginSerializer, PasswordChangeSerializer, StaffUserSerializer, me_payload

User = get_user_model()


class LoginBurstThrottle(SimpleRateThrottle):
    """Limits sign-in attempts per visitor (rates in settings: login_burst, login_hourly)."""

    scope = "login_burst"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginHourlyThrottle(LoginBurstThrottle):
    scope = "login_hourly"


# ---------- Signing in and out ----------


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """GET /api/auth/csrf — sets the CSRF cookie the admin site sends back with changes."""

    authentication_classes = []

    def get(self, request):
        return Response({"ok": True})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """POST /api/auth/login"""

    authentication_classes = []
    throttle_classes = [LoginBurstThrottle, LoginHourlyThrottle]

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = authenticate(request._request, username=s.validated_data["username"].strip(),
                            password=s.validated_data["password"])
        if user is None:
            # authenticate() already logged a failed sign-in
            return Response({"detail": "Wrong username or password."}, status=status.HTTP_400_BAD_REQUEST)
        if role_of(user) is None:
            record("access_denied", actor=user, object_type="staff account", object_repr=user.get_username(),
                   changes={"needed": "a staff role"})
            return Response({"detail": "This account doesn't have access to the church admin."},
                            status=status.HTTP_403_FORBIDDEN)
        login(request._request, user)
        return Response(me_payload(user))


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    """POST /api/auth/logout"""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = []

    def post(self, request):
        logout(request._request)
        return Response({"ok": True})


class MeView(APIView):
    """GET /api/auth/me — who is signed in and what they may do."""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [IsStaffMember]

    def get(self, request):
        return Response(me_payload(request.user))


class RolesView(APIView):
    """GET /api/auth/roles — every role and what it may do (for the Staff page)."""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [IsStaffMember]

    def get(self, request):
        return Response({
            "roles": [{"value": v, "label": l, "permissions": perms_for_role(v)} for v, l in ROLE_CHOICES],
            "permissions": list(PERMISSIONS),  # in the order they are defined in roles.py
        })


class PasswordChangeView(APIView):
    """POST /api/auth/password — change your own password."""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [IsStaffMember]

    def post(self, request):
        s = PasswordChangeSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        user = request.user
        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])
        StaffProfile.objects.filter(user=user).update(must_change_password=False)
        update_session_auth_hash(request._request, user)  # stay signed in
        record("password_change", obj=user, object_type="staff account", object_repr=user.get_username())
        user.refresh_from_db()
        return Response(me_payload(user))


# ---------- Staff accounts ----------


def _temporary_password():
    return secrets.token_urlsafe(9)


def _check_can_manage(actor, target):
    if target.pk == actor.pk:
        raise PermissionDenied("Use the My account page to change your own details.")
    if not can_manage_role(role_of(actor), stored_role(target) or ""):
        raise PermissionDenied("You can't change this account.")


def _other_active_system_admins(exclude):
    return (
        User.objects.filter(is_active=True)
        .exclude(pk=exclude.pk)
        .filter(staff_profile__role=SYSTEM_ADMIN)
        .exists()
        or User.objects.filter(is_active=True, is_superuser=True, staff_profile__isnull=True)
        .exclude(pk=exclude.pk)
        .exists()
    )


class StaffUserList(APIView):
    """GET, POST /api/admin/users"""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [StaffPermission("users.view", "users.edit")]

    def get(self, request):
        users = (
            User.objects.filter(staff_profile__isnull=False)
            | User.objects.filter(is_superuser=True)
        ).select_related("staff_profile").distinct().order_by("-is_active", "first_name", "username")
        return Response(StaffUserSerializer(users, many=True, context={"request": request}).data)

    @transaction.atomic
    def post(self, request):
        s = StaffUserSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        role = s.validated_data["staff_profile"]["role"]
        if not can_manage_role(role_of(request.user), role):
            raise PermissionDenied("You can't create accounts with that role.")
        password = request.data.get("password") or _temporary_password()
        user = User(
            username=s.validated_data["username"],
            first_name=s.validated_data.get("first_name", ""),
            last_name=s.validated_data.get("last_name", ""),
            email=s.validated_data.get("email", ""),
            is_active=True,
        )
        try:
            password_validation.validate_password(password, user)
        except Exception as exc:
            raise ValidationError({"password": list(getattr(exc, "messages", [str(exc)]))})
        user.set_password(password)
        user.save()
        StaffProfile.objects.create(user=user, role=role, must_change_password=True)
        data = StaffUserSerializer(user, context={"request": request}).data
        data["temporary_password"] = password  # shown once, never stored in plain text
        return Response(data, status=status.HTTP_201_CREATED)


class StaffUserDetail(APIView):
    """PATCH /api/admin/users/<id>"""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [StaffPermission("users.view", "users.edit")]

    @transaction.atomic
    def patch(self, request, pk):
        target = User.objects.select_related("staff_profile").filter(pk=pk).first()
        if target is None or stored_role(target) is None:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        _check_can_manage(request.user, target)

        s = StaffUserSerializer(target, data=request.data, partial=True, context={"request": request})
        s.is_valid(raise_exception=True)
        new_role = s.validated_data.get("staff_profile", {}).get("role")
        if new_role and not can_manage_role(role_of(request.user), new_role):
            raise PermissionDenied("You can't give that role.")

        losing_sysadmin = stored_role(target) == SYSTEM_ADMIN and target.is_active and (
            (new_role and new_role != SYSTEM_ADMIN) or s.validated_data.get("is_active") is False
        )
        if losing_sysadmin and not _other_active_system_admins(exclude=target):
            raise ValidationError({"detail": "There must always be at least one active System Admin."})

        for field in ("username", "first_name", "last_name", "email", "is_active"):
            if field in s.validated_data:
                setattr(target, field, s.validated_data[field])
        target.save()
        if new_role:
            profile, _ = StaffProfile.objects.get_or_create(user=target, defaults={"role": new_role})
            if profile.role != new_role:
                profile.role = new_role
                profile.save()
        target.refresh_from_db()
        return Response(StaffUserSerializer(target, context={"request": request}).data)


class StaffUserResetPassword(APIView):
    """POST /api/admin/users/<id>/reset-password — gives a new temporary password."""

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [StaffPermission("users.edit")]

    @transaction.atomic
    def post(self, request, pk):
        target = User.objects.filter(pk=pk).first()
        if target is None or stored_role(target) is None:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        _check_can_manage(request.user, target)
        password = _temporary_password()
        target.set_password(password)
        target.save(update_fields=["password"])
        profile, _ = StaffProfile.objects.get_or_create(user=target, defaults={"role": stored_role(target)})
        profile.must_change_password = True
        profile.save()
        record("password_reset", obj=target, object_type="staff account", object_repr=target.get_username())
        return Response({"temporary_password": password})
