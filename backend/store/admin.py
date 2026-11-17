from django.contrib import admin

from .models import Order, OrderItem, Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "price", "stock", "is_published", "is_featured", "sort_order"]
    list_editable = ["price", "stock", "is_published", "is_featured", "sort_order"]
    list_filter = ["category", "is_published", "is_featured"]
    search_fields = ["name", "summary"]
    prepopulated_fields = {"slug": ["name"]}


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    can_delete = False
    readonly_fields = ["product", "name", "option", "unit_price", "quantity", "line_total"]

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["__str__", "created_at", "customer_name", "total", "currency", "payment_label", "fulfilment", "status"]
    list_filter = ["status", "fulfilment", "method", "created_at"]
    search_fields = ["customer_name", "contact_phone", "email", "provider_reference"]
    date_hierarchy = "created_at"
    inlines = [OrderItemInline]
    readonly_fields = ["customer_name", "contact_phone", "email", "fulfilment", "address", "notes", "subtotal",
                       "delivery_fee", "total", "currency", "method", "provider", "payer_phone", "provider_order_id",
                       "provider_reference", "provider_status", "stock_taken", "created_at", "paid_at"]
    fields = ["status", "customer_name", "contact_phone", "email", "fulfilment", "address", "notes", "subtotal",
              "delivery_fee", "total", "currency", "method", "provider", "payer_phone", "provider_order_id",
              "provider_reference", "provider_status", "stock_taken", "staff_notes", "created_at", "paid_at"]

    def has_add_permission(self, request):
        return False
