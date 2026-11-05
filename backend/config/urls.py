import os

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

admin.site.site_header = "Heal The World Ministries · Church admin"
admin.site.site_title = "Church admin"
admin.site.index_title = "Manage the website"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("church.urls")),
]

# Uploaded event pictures. Fine for a small site; a bigger one would use
# a web server or cloud storage for these instead.
if settings.DEBUG or os.environ.get("DJANGO_SERVE_MEDIA", "true").lower() == "true":
    urlpatterns += [re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT})]
