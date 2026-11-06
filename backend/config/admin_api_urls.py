"""Staff-only API under /api/admin/ (used by the website's /admin pages)."""

from django.urls import re_path

from accounts.urls import admin_urlpatterns as account_urls
from audit.views import AuditLogList
from church import admin_api as v

urlpatterns = account_urls + [
    re_path(r"^dashboard/?$", v.DashboardView.as_view(), name="admin-dashboard"),
    re_path(r"^events/?$", v.EventAdminList.as_view(), name="admin-events"),
    re_path(r"^events/(?P<pk>\d+)/?$", v.EventAdminDetail.as_view(), name="admin-event"),
    re_path(r"^events/(?P<pk>\d+)/image/?$", v.EventImage.as_view(), name="admin-event-image"),
    re_path(r"^services/?$", v.ServiceTimeAdminList.as_view(), name="admin-services"),
    re_path(r"^services/(?P<pk>\d+)/?$", v.ServiceTimeAdminDetail.as_view(), name="admin-service"),
    re_path(r"^prayer-requests/?$", v.PrayerAdminList.as_view(), name="admin-prayers"),
    re_path(r"^prayer-requests/(?P<pk>\d+)/?$", v.PrayerAdminDetail.as_view(), name="admin-prayer"),
    re_path(r"^gifts/?$", v.GiftAdminList.as_view(), name="admin-gifts"),
    re_path(r"^gifts/bulk/?$", v.GiftBulkStatus.as_view(), name="admin-gifts-bulk"),
    re_path(r"^gifts/(?P<pk>\d+)/?$", v.GiftAdminDetail.as_view(), name="admin-gift"),
    re_path(r"^giving-categories/?$", v.GivingCategoryAdminList.as_view(), name="admin-categories"),
    re_path(r"^giving-categories/(?P<pk>\d+)/?$", v.GivingCategoryAdminDetail.as_view(), name="admin-category"),
    re_path(r"^settings/?$", v.SettingsAdminView.as_view(), name="admin-settings"),
    re_path(r"^audit/?$", AuditLogList.as_view(), name="admin-audit"),
]
