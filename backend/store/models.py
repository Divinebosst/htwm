"""
The church store: items for sale, and orders paid online (PayPal or mobile
money, using the same payment steps as giving).

An order is saved when the buyer starts paying ("Waiting for payment"). It
becomes "Paid" only when PayPal or Paynow confirms the money; that is also when
the items are taken out of stock. Staff then prepare it ("Ready") and hand it
over or deliver it ("Completed").
"""

import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.utils import timezone
from django.utils.text import slugify

from church.models import Gift, split_commas

# Store pages that a product's address must not take over (/store/cart etc.)
RESERVED_SLUGS = {"cart", "checkout", "order", "orders"}
LOW_STOCK = 5


class ProductQuerySet(models.QuerySet):
    def published(self):
        return self.filter(is_published=True)


class Product(models.Model):
    CATEGORIES = [
        ("books", "Books"),
        ("media", "Sermons & music"),
        ("clothing", "Clothing"),
        ("gifts", "Gifts"),
    ]

    name = models.CharField(max_length=140)
    slug = models.SlugField(max_length=160, unique=True, blank=True, help_text="Used in the item's web address.")
    category = models.CharField(max_length=20, choices=CATEGORIES, default="books")
    summary = models.CharField(max_length=200, help_text="One line shown on the store page.")
    description = models.TextField(blank=True, help_text="Full details. Blank lines start a new paragraph.")
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(Decimal("0.50"))])
    image = models.ImageField(upload_to="store/", blank=True)
    option_name = models.CharField(max_length=30, blank=True, default="Size", help_text="e.g. Size or Colour")
    options = models.CharField(
        max_length=200, blank=True, help_text="Choices the buyer must pick from, separated by commas, e.g. S, M, L, XL"
    )
    stock = models.PositiveIntegerField(null=True, blank=True, help_text="How many are left. Empty means no limit.")
    is_published = models.BooleanField(default=True, help_text="Show in the store.")
    is_featured = models.BooleanField(default=False, help_text="Show first in the store.")
    sort_order = models.PositiveSmallIntegerField(default=0, help_text="Lower numbers show first.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ProductQuerySet.as_manager()

    class Meta:
        ordering = ["-is_featured", "sort_order", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:150] or "item"
            if base in RESERVED_SLUGS:
                base = f"{base}-item"
            slug, n = base, 2
            while Product.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base}-{n}"
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)

    @property
    def option_list(self):
        return split_commas(self.options)

    @property
    def stock_state(self):
        if self.stock is None:
            return "in_stock"
        if self.stock == 0:
            return "sold_out"
        return "low" if self.stock <= LOW_STOCK else "in_stock"


class Order(models.Model):
    STATUSES = [
        ("pending", "Waiting for payment"),
        ("paid", "Paid, to prepare"),
        ("ready", "Ready / on its way"),
        ("completed", "Completed"),
        ("failed", "Payment didn't go through"),
        ("cancelled", "Cancelled"),
    ]
    FULFILMENT = [
        ("collect", "Collect at church"),
        ("delivery", "Delivery"),
    ]
    METHODS = [
        ("paypal", "PayPal or card"),
        ("mobile", "Mobile money"),
    ]

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False,
                                 help_text="Private link to this order for the buyer's browser.")
    status = models.CharField(max_length=10, choices=STATUSES, default="pending")
    customer_name = models.CharField(max_length=120)
    contact_phone = models.CharField(max_length=30)
    email = models.EmailField(blank=True)
    fulfilment = models.CharField(max_length=10, choices=FULFILMENT, default="collect")
    address = models.TextField(max_length=300, blank=True)
    notes = models.TextField(max_length=500, blank=True, help_text="From the buyer.")
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    # Payment
    method = models.CharField(max_length=10, choices=METHODS)
    provider = models.CharField(max_length=10, choices=Gift.PROVIDERS, blank=True, help_text="Mobile money wallet.")
    payer_phone = models.CharField(max_length=20, blank=True, help_text="Mobile money number that paid.")
    provider_order_id = models.CharField(max_length=64, blank=True, db_index=True,
                                         help_text="PayPal order ID, or the reference sent to Paynow.")
    provider_reference = models.CharField(max_length=64, blank=True,
                                          help_text="PayPal capture ID or Paynow reference for the payment.")
    provider_status = models.CharField(max_length=40, blank=True, help_text="Last status reported by the provider.")
    poll_url = models.URLField(max_length=300, blank=True)
    otp_url = models.URLField(max_length=300, blank=True)
    stock_taken = models.BooleanField(default=False, help_text="The items have been taken out of stock.")
    staff_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order #{self.pk}"

    @property
    def payment_label(self):
        if self.method == "mobile" and self.provider:
            return f"Mobile money · {self.get_provider_display()}"
        return self.get_method_display()

    # ---- online payment steps (see church/online_payments.py)

    @property
    def payment_amount(self):
        return self.total

    @property
    def payment_reference(self):
        return f"ORDER-{self.pk}"

    @property
    def is_paid(self):
        return self.paid_at is not None

    @property
    def payment_state(self):
        if self.is_paid:
            return "paid"
        return "pending" if self.status == "pending" else "failed"

    def payment_received(self, provider_reference="", provider_status=""):
        """The money is in: mark the order paid and take the items out of stock (once only)."""
        with transaction.atomic():
            fresh = Order.objects.select_for_update().get(pk=self.pk)
            if fresh.paid_at is None:
                fresh.paid_at = timezone.now()
                if fresh.status in ("pending", "failed"):
                    fresh.status = "paid"
                if provider_reference:
                    fresh.provider_reference = provider_reference[:64]
                if provider_status:
                    fresh.provider_status = provider_status[:40]
                short = fresh.take_stock()
                if short:
                    note = "Not enough in stock when paid: " + ", ".join(short)
                    fresh.staff_notes = f"{fresh.staff_notes}\n{note}".strip()
                fresh.save()
        self.refresh_from_db()

    def payment_update(self, state, provider_status=""):
        """state is "pending" or "failed". Saves only when something changed."""
        if self.is_paid or self.status == "cancelled":
            return
        provider_status = provider_status[:40]
        if self.status != state or self.provider_status != provider_status:
            self.status, self.provider_status = state, provider_status
            self.save()

    # ---- stock

    def take_stock(self):
        """Take the items out of stock. Returns the names of items there weren't enough of."""
        short = []
        if self.stock_taken:
            return short
        for item in self.items.select_related("product"):
            product = item.product
            if product is None or product.stock is None:
                continue
            if product.stock < item.quantity:
                short.append(item.name)
            Product.objects.filter(pk=product.pk).update(stock=Greatest(F("stock") - item.quantity, 0))
        self.stock_taken = True
        return short

    def return_stock(self):
        """Put the items back in stock (when a paid order is cancelled)."""
        if not self.stock_taken:
            return
        for item in self.items.select_related("product"):
            if item.product is not None and item.product.stock is not None:
                Product.objects.filter(pk=item.product_id).update(stock=F("stock") + item.quantity)
        self.stock_taken = False


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True, related_name="order_items")
    name = models.CharField(max_length=140, help_text="The item's name when it was ordered.")
    option = models.CharField(max_length=40, blank=True)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveSmallIntegerField()
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        label = f"{self.name} ({self.option})" if self.option else self.name
        return f"{self.quantity} × {label}"
