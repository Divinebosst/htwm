from django.urls import re_path

from . import payment_api, views

event_list = views.EventViewSet.as_view({"get": "list"})
event_detail = views.EventViewSet.as_view({"get": "retrieve"})

# Every route works with or without a trailing slash (/api/events and /api/events/)
urlpatterns = [
    re_path(r"^settings/?$", views.SiteSettingsView.as_view(), name="settings"),
    re_path(r"^services/?$", views.ServiceTimeList.as_view(), name="services"),
    re_path(r"^events/?$", event_list, name="event-list"),
    re_path(r"^events/(?P<slug>[-\w]+)/?$", event_detail, name="event-detail"),
    re_path(r"^giving-categories/?$", views.GivingCategoryList.as_view(), name="giving-categories"),
    re_path(r"^payments/paypal/orders/?$", payment_api.PayPalCreateOrder.as_view(), name="paypal-order"),
    re_path(r"^payments/paypal/orders/(?P<order_id>[A-Z0-9]{5,40})/capture/?$", payment_api.PayPalCapture.as_view(),
            name="paypal-capture"),
    re_path(r"^payments/mobile/?$", payment_api.MobileStart.as_view(), name="mobile-start"),
    re_path(r"^payments/mobile/(?P<public_id>[0-9a-f-]{32,36})/otp/?$", payment_api.MobileOtp.as_view(),
            name="mobile-otp"),
    re_path(r"^payments/paynow/result/?$", payment_api.PaynowResult.as_view(), name="paynow-result"),
    re_path(r"^payments/(?P<public_id>[0-9a-f-]{32,36})/?$", payment_api.PaymentStatus.as_view(), name="payment-status"),
    re_path(r"^prayer-requests/?$", views.PrayerRequestCreate.as_view(), name="prayer-requests"),
]
