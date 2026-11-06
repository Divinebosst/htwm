"""Remembers the current web request so audit entries know who acted and from where."""

from contextvars import ContextVar

from django.conf import settings

_current_request = ContextVar("audit_request", default=None)


def current_request():
    return _current_request.get()


class AuditContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _current_request.set(request)
        try:
            return self.get_response(request)
        finally:
            _current_request.reset(token)


def client_ip(request):
    """The visitor's address. Behind the Next.js site the real address is in X-Forwarded-For."""
    remote = request.META.get("REMOTE_ADDR")
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    proxies = settings.REST_FRAMEWORK.get("NUM_PROXIES")
    if xff and proxies:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-min(proxies, len(parts))]
    return remote


def source_of(request):
    if request is None:
        return "system"
    path = request.path
    if path.startswith("/api/admin/") or path.startswith("/api/auth/"):
        return "staff"
    if path.startswith("/django-admin/"):
        return "django_admin"
    return "public"
