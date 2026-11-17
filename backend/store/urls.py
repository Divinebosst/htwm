from django.urls import re_path

from . import api

ORDER_ID = r"(?P<public_id>[0-9a-f-]{32,36})"

# Mounted at /api/store/. Every route works with or without a trailing slash.
urlpatterns = [
    re_path(r"^products/?$", api.ProductList.as_view(), name="store-products"),
    re_path(r"^products/(?P<slug>[-\w]+)/?$", api.ProductDetail.as_view(), name="store-product"),
    re_path(r"^quote/?$", api.Quote.as_view(), name="store-quote"),
    re_path(r"^checkout/paypal/?$", api.PayPalCheckout.as_view(), name="store-paypal"),
    re_path(r"^checkout/paypal/(?P<order_id>[A-Z0-9]{5,40})/capture/?$", api.PayPalCheckoutCapture.as_view(),
            name="store-paypal-capture"),
    re_path(r"^checkout/mobile/?$", api.MobileCheckout.as_view(), name="store-mobile"),
    re_path(rf"^orders/{ORDER_ID}/otp/?$", api.OrderOtp.as_view(), name="store-order-otp"),
    re_path(rf"^orders/{ORDER_ID}/?$", api.OrderStatus.as_view(), name="store-order"),
]
