from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .roles import has_perm, role_of


class StaffSessionAuthentication(SessionAuthentication):
    """Signed-in staff use a session cookie (plus CSRF token for changes).

    Returning a header value makes DRF answer 401 (not signed in) instead of
    403 (signed in but not allowed), so the website knows to show the login.
    """

    def authenticate_header(self, request):
        return "Session"


class PasswordChangeRequired(PermissionDenied):
    def __init__(self):
        super().__init__({"detail": "Please choose a new password before continuing.",
                          "code": "password_change_required"})


def StaffPermission(read, write=None):
    """
    Permission class for staff endpoints.

        permission_classes = [StaffPermission("gifts.view", "gifts.edit")]

    `read` is needed for GET; `write` (defaults to `read`) for changes.
    """
    write = write or read

    class _StaffPermission(BasePermission):
        def has_permission(self, request, view):
            user = request.user
            if not user or not user.is_authenticated:
                raise NotAuthenticated()
            if role_of(user) is None:
                _deny(request, "no staff role")
                return False
            profile = getattr(user, "staff_profile", None)
            if profile is not None and profile.must_change_password:
                raise PasswordChangeRequired()
            needed = read if request.method in SAFE_METHODS else write
            if not has_perm(user, needed):
                _deny(request, needed)
                return False
            return True

    _StaffPermission.__name__ = f"StaffPermission[{read}|{write}]"
    return _StaffPermission


class IsStaffMember(BasePermission):
    """Signed in with any staff role (used by /me, password change, logout)."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            raise NotAuthenticated()
        return role_of(request.user) is not None


def _deny(request, needed):
    from audit.log import record

    record(
        "access_denied",
        object_type="admin page",
        object_repr=f"{request.method} {request.path}",
        changes={"needed": needed},
    )
