"""
Staff API for the store, under /api/admin/store/.

Store items and the delivery settings need "store.edit"; orders need
"orders.view" to see and "orders.edit" to update. Every change is written to
the audit log by audit/signals.py.
"""

from collections import defaultdict
from datetime import datetime, time

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from accounts.permissions import StaffPermission
from church import online_payments as pay
from church.admin_api import MAX_IMAGE_BYTES, StaffAPIView
from church.models import SiteSettings
from config.api import paginate

from .models import Order, OrderItem, Product

# ---------------------------------------------------------------- store items


class ProductAdminSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    image_url = serializers.SerializerMethodField()
    stock_state = serializers.CharField(read_only=True)
    sold = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Product
        fields = ["id", "slug", "name", "category", "category_label", "summary", "description", "price", "image_url",
                  "option_name", "options", "stock", "stock_state", "is_published", "is_featured", "sort_order",
                  "sold", "created_at", "updated_at"]
        read_only_fields = ["slug", "created_at", "updated_at"]

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None

    def validate_options(self, value):
        # Tidy "s,m , L" into "s, m, L" and drop repeats
        seen = []
        for item in (value or "").split(","):
            item = item.strip()[:40]
            if item and item not in seen:
                seen.append(item)
        return ", ".join(seen)


def products_with_sales():
    paid = Q(order_items__order__paid_at__isnull=False) & ~Q(order_items__order__status="cancelled")
    return Product.objects.annotate(sold=Sum("order_items__quantity", filter=paid, default=0)).order_by(
        "-is_featured", "sort_order", "name")


class ProductAdminList(StaffAPIView):
    """GET, POST /api/admin/store/products"""

    permission_classes = [StaffPermission("store.edit")]

    def get(self, request):
        return Response(ProductAdminSerializer(products_with_sales(), many=True).data)

    def post(self, request):
        s = ProductAdminSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=status.HTTP_201_CREATED)


class ProductAdminDetail(StaffAPIView):
    """GET, PATCH, DELETE /api/admin/store/products/<id>"""

    permission_classes = [StaffPermission("store.edit")]

    def get(self, request, pk):
        product = products_with_sales().filter(pk=pk).first()
        if not product:
            return Response({"detail": "Item not found."}, status=404)
        return Response(ProductAdminSerializer(product).data)

    def patch(self, request, pk):
        product = Product.objects.filter(pk=pk).first()
        if not product:
            return Response({"detail": "Item not found."}, status=404)
        s = ProductAdminSerializer(product, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    def delete(self, request, pk):
        product = Product.objects.filter(pk=pk).first()
        if not product:
            return Response({"detail": "Item not found."}, status=404)
        # Orders keep the item's name and price, so deleting never changes an order
        if product.image:
            product.image.delete(save=False)
        product.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProductImage(StaffAPIView):
    """POST (multipart 'image'), DELETE /api/admin/store/products/<id>/image"""

    permission_classes = [StaffPermission("store.edit")]
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        product = Product.objects.filter(pk=pk).first()
        if not product:
            return Response({"detail": "Item not found."}, status=404)
        try:
            image = serializers.ImageField().run_validation(request.data.get("image"))
        except serializers.ValidationError as exc:
            return Response({"image": exc.detail}, status=400)
        except DjangoValidationError:
            return Response({"image": ["Please choose a picture file (JPG, PNG or WebP)."]}, status=400)
        if image.size > MAX_IMAGE_BYTES:
            return Response({"image": ["Please choose a picture smaller than 5 MB."]}, status=400)
        if product.image:
            product.image.delete(save=False)
        product.image = image
        product.save()
        return Response(ProductAdminSerializer(product).data)

    def delete(self, request, pk):
        product = Product.objects.filter(pk=pk).first()
        if not product:
            return Response({"detail": "Item not found."}, status=404)
        if product.image:
            product.image.delete(save=False)
            product.image = None
            product.save()
        return Response(ProductAdminSerializer(product).data)


# ---------------------------------------------------------------- delivery settings

STORE_FIELDS = ["store_delivery_enabled", "store_delivery_fee", "store_delivery_note", "store_collect_note"]


class StoreSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ["currency"] + STORE_FIELDS
        read_only_fields = ["currency"]


class StoreSettingsView(StaffAPIView):
    """GET, PATCH /api/admin/store/settings — collection and delivery."""

    permission_classes = [StaffPermission("store.edit")]

    def get(self, request):
        return Response(StoreSettingsSerializer(SiteSettings.load()).data)

    def patch(self, request):
        s = StoreSettingsSerializer(SiteSettings.load(), data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


# ---------------------------------------------------------------- orders


class OrderItemAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["name", "option", "quantity", "unit_price", "line_total", "product"]


class OrderAdminSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    fulfilment_label = serializers.CharField(source="get_fulfilment_display", read_only=True)
    payment_label = serializers.CharField(read_only=True)
    items = OrderItemAdminSerializer(many=True, read_only=True)
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = ["id", "status", "status_label", "customer_name", "contact_phone", "email", "fulfilment",
                  "fulfilment_label", "address", "notes", "subtotal", "delivery_fee", "total", "currency", "method",
                  "payment_label", "provider", "payer_phone", "provider_reference", "provider_status", "items",
                  "item_count", "staff_notes", "created_at", "paid_at", "updated_at"]
        read_only_fields = [f for f in fields if f not in ("status", "staff_notes")]

    def get_item_count(self, obj):
        return sum(i.quantity for i in obj.items.all())


# What staff may change an order to. Unpaid orders can only be cancelled.
STAFF_STATUSES = {"paid", "ready", "completed", "cancelled"}


def _filtered_orders(request):
    p = request.query_params
    qs = Order.objects.prefetch_related("items")
    if p.get("status") == "open":
        qs = qs.filter(status__in=["paid", "ready"])
    elif p.get("status"):
        qs = qs.filter(status=p["status"])
    if p.get("fulfilment"):
        qs = qs.filter(fulfilment=p["fulfilment"])
    if p.get("q"):
        q = p["q"].strip().lstrip("#")
        match = Q(customer_name__icontains=q) | Q(contact_phone__icontains=q) | Q(email__icontains=q)
        if q.isdigit():
            match |= Q(pk=int(q))
        qs = qs.filter(match)
    tz = timezone.get_current_timezone()
    for key, op in (("date_from", "gte"), ("date_to", "lte")):
        try:
            d = datetime.strptime(p.get(key, ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        edge = time.min if op == "gte" else time.max
        qs = qs.filter(**{f"created_at__{op}": timezone.make_aware(datetime.combine(d, edge), tz)})
    return qs


def close_unfinished_orders():
    pay.close_unfinished(Order.objects.filter(status="pending"))


class OrderAdminList(StaffAPIView):
    """GET /api/admin/store/orders ?status= (or open) ?fulfilment= ?q= ?date_from= ?date_to="""

    permission_classes = [StaffPermission("orders.view", "orders.edit")]

    def get(self, request):
        close_unfinished_orders()
        qs = _filtered_orders(request)
        totals = defaultdict(dict)
        for row in qs.order_by().values("status", "currency").annotate(total=Sum("total"), n=Count("id")):
            totals[row["status"]][row["currency"]] = {"total": f"{row['total']:.2f}", "count": row["n"]}
        return paginate(
            request,
            qs,
            OrderAdminSerializer,
            extra={
                "totals": totals,
                "statuses": [{"value": v, "label": l} for v, l in Order.STATUSES],
                "fulfilment": [{"value": v, "label": l} for v, l in Order.FULFILMENT],
            },
        )


class OrderAdminDetail(StaffAPIView):
    """GET, PATCH (status, staff_notes) /api/admin/store/orders/<id>"""

    permission_classes = [StaffPermission("orders.view", "orders.edit")]

    def get(self, request, pk):
        order = Order.objects.prefetch_related("items").filter(pk=pk).first()
        if not order:
            return Response({"detail": "Order not found."}, status=404)
        return Response(OrderAdminSerializer(order).data)

    def patch(self, request, pk):
        order = Order.objects.filter(pk=pk).first()
        if not order:
            return Response({"detail": "Order not found."}, status=404)
        new_status = request.data.get("status", order.status)
        if new_status != order.status:
            if new_status not in STAFF_STATUSES:
                return Response({"status": ["Orders become paid or unpaid on their own when the payment goes through."]},
                                status=400)
            if not order.is_paid and new_status != "cancelled":
                return Response({"status": ["This order hasn't been paid, so it can only be cancelled."]}, status=400)
        with transaction.atomic():
            if new_status == "cancelled" and order.status != "cancelled":
                order.return_stock()
            elif order.status == "cancelled" and new_status != "cancelled" and order.is_paid and not order.stock_taken:
                order.take_stock()
            order.status = new_status
            if "staff_notes" in request.data:
                order.staff_notes = str(request.data["staff_notes"])[:5000]
            order.save()
        order = Order.objects.prefetch_related("items").get(pk=order.pk)
        return Response(OrderAdminSerializer(order).data)
