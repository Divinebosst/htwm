"""
Explains Django's security (CSRF) refusals in plain words, as JSON the admin
website can show, instead of Django's generic "403 Forbidden" page.
"""

from django.conf import settings
from django.http import JsonResponse
from django.middleware.csrf import REASON_NO_CSRF_COOKIE


def csrf_failure(request, reason=""):
    origin = request.META.get("HTTP_ORIGIN", "")
    if reason.startswith("Origin checking failed"):
        code = "csrf_untrusted_origin"
        detail = (
            f"Staff sign-in isn't allowed from this website address ({origin}) yet. "
            "Add it to DJANGO_CSRF_TRUSTED_ORIGINS on the backend server, then restart the backend."
        )
    elif reason == REASON_NO_CSRF_COOKIE and settings.CSRF_COOKIE_SECURE and not request.is_secure():
        code = "csrf_needs_https"
        detail = "Staff sign-in needs a secure connection. Open the site with https:// and try again."
    else:
        code = "csrf_failed"
        detail = "Your session has expired or the page is out of date. Reload the page and try again."
    return JsonResponse({"detail": detail, "code": code}, status=403)
