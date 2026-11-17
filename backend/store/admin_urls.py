from django.urls import re_path

from . import admin_api as v

# Mounted at /api/admin/store/
urlpatterns = [
    re_path(r"^products/?$", v.ProductAdminList.as_view(), name="admin-products"),
    re_path(r"^products/(?P<pk>\d+)/?$", v.ProductAdminDetail.as_view(), name="admin-product"),
    re_path(r"^products/(?P<pk>\d+)/image/?$", v.ProductImage.as_view(), name="admin-product-image"),
    re_path(r"^settings/?$", v.StoreSettingsView.as_view(), name="admin-store-settings"),
    re_path(r"^orders/?$", v.OrderAdminList.as_view(), name="admin-orders"),
    re_path(r"^orders/(?P<pk>\d+)/?$", v.OrderAdminDetail.as_view(), name="admin-order"),
]
