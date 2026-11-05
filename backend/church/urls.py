from django.urls import re_path

from . import views

event_list = views.EventViewSet.as_view({"get": "list"})
event_detail = views.EventViewSet.as_view({"get": "retrieve"})

# Every route works with or without a trailing slash (/api/events and /api/events/)
urlpatterns = [
    re_path(r"^settings/?$", views.SiteSettingsView.as_view(), name="settings"),
    re_path(r"^services/?$", views.ServiceTimeList.as_view(), name="services"),
    re_path(r"^events/?$", event_list, name="event-list"),
    re_path(r"^events/(?P<slug>[-\w]+)/?$", event_detail, name="event-detail"),
    re_path(r"^giving-categories/?$", views.GivingCategoryList.as_view(), name="giving-categories"),
    re_path(r"^gifts/?$", views.GiftCreate.as_view(), name="gifts"),
    re_path(r"^prayer-requests/?$", views.PrayerRequestCreate.as_view(), name="prayer-requests"),
]
