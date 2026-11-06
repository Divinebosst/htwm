import os

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

from accounts.urls import auth_urlpatterns

admin.site.site_header = "Heal The World Ministries · System admin"
admin.site.site_title = "Church admin"
admin.site.index_title = "Manage the website"

urlpatterns = [
    path("django-admin/", admin.site.urls),  # Django's built-in admin, System Admins only
    path("api/auth/", include(auth_urlpatterns)),
    path("api/admin/", include("config.admin_api_urls")),
    path("api/", include("church.urls")),
]

# Uploaded event pictures. Fine for a small site; a bigger one would use
# a web server or cloud storage for these instead.
if settings.DEBUG or os.environ.get("DJANGO_SERVE_MEDIA", "true").lower() == "true":
    urlpatterns += [re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT})]
