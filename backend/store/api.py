"""
Public store API under /api/store/.

Prices, stock and totals are always worked out here from the database; the
cart in the buyer's browser only says which items and how many.
"""

from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from church import online_payments as pay
from church import paynow, paypal
from church.models import SiteSettings
from church.payment_api import DECLINED, OtpSerializer, WalletSerializer

from .models import Order, OrderItem, Product

MAX_LINES = 30
MAX_QUANTITY = 50


def image_url(product):
    return product.image.url if product and product.image else None


class ProductSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display")
    image_url = serializers.SerializerMethodField()
    options = serializers.ListField(source="option_list")
    stock_state = serializers.CharField()
    stock_left = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ["slug", "name", "category", "category_label", "summary", "price", "image_url", "option_name",
                  "options", "stock_state", "stock_left", "is_featured"]

    def get_image_url(self, obj):
        return image_url(obj)

    def get_stock_left(self, obj):
        return obj.stock if obj.stock_state == "low" else None


class ProductDetailSerializer(ProductSerializer):
    class Meta(ProductSerializer.Meta):
        fields = ProductSerializer.Meta.fields + ["description"]


class StoreView(APIView):
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "store"


class ProductList(StoreView):
    """GET /api/store/products"""

    def get(self, request):
        return Response(ProductSerializer(Product.objects.published(), many=True).data)


class ProductDetail(StoreView):
    """GET /api/store/products/<slug>"""

    def get(self, request, slug):
        product = Product.objects.published().filter(slug=slug).first()
        if product is None:
            return Response({"detail": "This item isn't in the store."}, status=404)
        return Response(ProductDetailSerializer(product).data)


# ---------------------------------------------------------------- cart and prices


class CartLineSerializer(serializers.Serializer):
    product = serializers.SlugField(max_length=160)
    option = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_QUANTITY)


class CartSerializer(serializers.Serializer):
    items = CartLineSerializer(many=True, allow_empty=False, max_length=MAX_LINES)


def price_cart(items):
    """
    Work out each line from the database. Returns (lines, problems): a problem
    is an item that is no longer sold, needs an option, or isn't in stock.
    """
    wanted = defaultdict(int)  # (slug, option) -> quantity; the same item twice becomes one line
    for item in items:
        wanted[(item["product"], item.get("option", "").strip())] += item["quantity"]
    products = {p.slug: p for p in Product.objects.published().filter(slug__in={s for s, _ in wanted})}

    lines, problems = [], []
    per_product = defaultdict(int)
    for (slug, option), quantity in wanted.items():
        product = products.get(slug)
        if product is None:
            problems.append({"product": slug, "option": option, "message": "This item is no longer in the store."})
            continue
        choices = product.option_list
        if choices and option not in choices:
            problems.append({"product": slug, "option": option,
                             "message": f"Choose a {(product.option_name or 'option').lower()}."})
            continue
        option = option if choices else ""
        per_product[slug] += quantity
        lines.append({"product": product, "option": option, "quantity": quantity,
                      "unit_price": product.price, "line_total": product.price * quantity})

    for slug, quantity in per_product.items():
        product = products[slug]
        if product.stock is not None and quantity > product.stock:
            message = "Sold out." if product.stock == 0 else f"Only {product.stock} left. Please lower the quantity."
            problems.append({"product": slug, "option": "", "message": message})
    return lines, problems


def line_json(line):
    p = line["product"]
    return {
        "product": p.slug,
        "name": p.name,
        "option": line["option"],
        "option_name": p.option_name,
        "quantity": line["quantity"],
        "unit_price": f"{line['unit_price']:.2f}",
        "line_total": f"{line['line_total']:.2f}",
        "image_url": image_url(p),
        "stock_left": p.stock,
    }


class Quote(StoreView):
    """POST /api/store/quote {items: [{product, option, quantity}]} — current prices and stock for a cart."""

    def post(self, request):
        s = CartSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        lines, problems = price_cart(s.validated_data["items"])
        site = SiteSettings.load()
        subtotal = sum((line["line_total"] for line in lines), Decimal("0"))
        return Response({
            "currency": site.currency,
            "lines": [line_json(line) for line in lines],
            "subtotal": f"{subtotal:.2f}",
            "delivery_enabled": site.store_delivery_enabled,
            "delivery_fee": f"{site.store_delivery_fee:.2f}",
            "problems": problems,
        })


# ---------------------------------------------------------------- checkout


class CheckoutSerializer(CartSerializer):
    name = serializers.CharField(max_length=120)
    contact_phone = serializers.CharField(max_length=30)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    fulfilment = serializers.ChoiceField(choices=Order.FULFILMENT)
    address = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["fulfilment"] == "delivery":
            if not SiteSettings.load().store_delivery_enabled:
                raise serializers.ValidationError({"fulfilment": "Delivery isn't available. Please collect at church."})
            if not attrs["address"].strip():
                raise serializers.ValidationError({"address": "Enter the delivery address."})
        else:
            attrs["address"] = ""
        return attrs


class MobileCheckoutSerializer(CheckoutSerializer, WalletSerializer):
    pass


class CartChanged(Exception):
    def __init__(self, problems):
        self.problems = problems


def new_order(data, method, **extra):
    lines, problems = price_cart(data["items"])
    if problems:
        raise CartChanged(problems)
    site = SiteSettings.load()
    subtotal = sum((line["line_total"] for line in lines), Decimal("0"))
    fee = site.store_delivery_fee if data["fulfilment"] == "delivery" else Decimal("0")
    with transaction.atomic():
        order = Order.objects.create(
            customer_name=data["name"].strip(),
            contact_phone=data["contact_phone"].strip(),
            email=data.get("email", "").strip(),
            fulfilment=data["fulfilment"],
            address=data.get("address", "").strip(),
            notes=data.get("notes", "").strip(),
            subtotal=subtotal,
            delivery_fee=fee,
            total=subtotal + fee,
            currency=site.currency,
            method=method,
            **extra,
        )
        OrderItem.objects.bulk_create([
            OrderItem(order=order, product=line["product"], name=line["product"].name, option=line["option"],
                      unit_price=line["unit_price"], quantity=line["quantity"], line_total=line["line_total"])
            for line in lines
        ])
    return order


def cart_changed(problems):
    return Response({"detail": "Some items in your cart have changed. Please check your cart.",
                     "code": "cart_changed", "problems": problems}, status=409)


def order_label(order, site):
    return f"Order #{order.pk} – {site.short_name}"


def order_payload(order, **extra):
    site = SiteSettings.load()
    items = list(order.items.select_related("product"))
    note = site.store_delivery_note if order.fulfilment == "delivery" else site.store_collect_note
    return {
        "id": str(order.public_id),
        "number": order.pk,
        "status": order.status,
        "status_label": order.get_status_display(),
        "payment": order.payment_state,
        "amount": f"{order.total:.2f}",
        "currency": order.currency,
        "subtotal": f"{order.subtotal:.2f}",
        "delivery_fee": f"{order.delivery_fee:.2f}",
        "total": f"{order.total:.2f}",
        "payment_label": order.payment_label,
        "customer_name": order.customer_name,
        "fulfilment": order.fulfilment,
        "fulfilment_label": order.get_fulfilment_display(),
        "fulfilment_note": note,
        "address": order.address,
        "items": [
            {"name": i.name, "option": i.option, "option_name": i.product.option_name if i.product else "",
             "quantity": i.quantity, "unit_price": f"{i.unit_price:.2f}",
             "line_total": f"{i.line_total:.2f}", "image_url": image_url(i.product),
             "product": i.product.slug if i.product else None}
            for i in items
        ],
        "created_at": order.created_at,
        "paid_at": order.paid_at,
        **extra,
    }


class CheckoutView(APIView):
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "orders"


class PayPalCheckout(CheckoutView):
    """POST /api/store/checkout/paypal — called by the PayPal button's createOrder."""

    def post(self, request):
        if not paypal.is_configured():
            return Response({"detail": "PayPal payments aren't set up yet."}, status=503)
        s = CheckoutSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            order = new_order(s.validated_data, "paypal")
        except CartChanged as exc:
            return cart_changed(exc.problems)
        site = SiteSettings.load()
        try:
            order_id = pay.start_paypal(order, description=order_label(order, site), brand_name=site.church_name)
        except paypal.PayPalError as exc:
            return Response({"detail": str(exc)}, status=502)
        return Response({"order_id": order_id, "order": str(order.public_id)}, status=201)


class PayPalCheckoutCapture(CheckoutView):
    """POST /api/store/checkout/paypal/<order_id>/capture — called by onApprove."""

    def post(self, request, order_id):
        order = Order.objects.filter(method="paypal", provider_order_id=order_id).first()
        if order is None:
            return Response({"detail": "Order not found."}, status=404)
        try:
            pay.capture_paypal(order)
        except paypal.PayPalError as exc:
            if exc.code == "INSTRUMENT_DECLINED":
                return Response(DECLINED, status=422)
            return Response({"detail": str(exc)}, status=502)
        return Response(order_payload(order))


class MobileCheckout(CheckoutView):
    """POST /api/store/checkout/mobile — sends a payment request to the buyer's wallet."""

    def post(self, request):
        if not paynow.is_configured():
            return Response({"detail": "Mobile money payments aren't set up yet."}, status=503)
        s = MobileCheckoutSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        try:
            order = new_order(data, "mobile", provider=data["provider"], payer_phone=data["phone"])
        except CartChanged as exc:
            return cart_changed(exc.problems)
        site = SiteSettings.load()
        base = pay.site_url(request)
        try:
            extra = pay.start_mobile(order, info=order_label(order, site),
                                     result_url=f"{base}/api/payments/paynow/result",
                                     return_url=f"{base}/store/order?id={order.public_id}")
        except paynow.PaynowError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(order_payload(order, **extra), status=201)


class OrderOtp(CheckoutView):
    """POST /api/store/orders/<id>/otp — O'mari one-time PIN."""

    def post(self, request, public_id):
        order = Order.objects.filter(public_id=public_id, provider="omari").first()
        if order is None or not order.otp_url:
            return Response({"detail": "Order not found."}, status=404)
        if order.payment_state != "pending":
            return Response(order_payload(order))
        s = OtpSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            pay.submit_otp(order, s.validated_data["otp"])
        except paynow.PaynowError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(order_payload(order))


class OrderStatus(APIView):
    """GET /api/store/orders/<id> — the order page (and the checkout while it waits for payment)."""

    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "payment_status"

    def get(self, request, public_id):
        order = Order.objects.filter(public_id=public_id).first()
        if order is None:
            return Response({"detail": "Order not found."}, status=404)
        pay.refresh_mobile(order)
        return Response(order_payload(order))
