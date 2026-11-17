"""
Fills the store with example items (with pictures) so you can see how it
works. Replace them in the admin with the church's real items.

    python manage.py load_sample_store            # add the example items
    python manage.py load_sample_store --orders   # ...and a few example orders for the admin
    python manage.py load_sample_store --clear    # remove all the examples again

Running it again updates the examples instead of adding copies.
"""

from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from church.models import SiteSettings
from store.models import Order, OrderItem, Product

IMAGES = Path(__file__).resolve().parents[2] / "sample_images"
SAMPLE_EMAIL = "sample-order@example.com"  # marks example orders so --clear can find them

PRODUCTS = [
    dict(
        slug="sample-healing-is-your-portion",
        name="Healing Is Your Portion",
        category="books",
        price="15.00",
        stock=40,
        is_featured=True,
        sort_order=1,
        image="healing-is-your-portion.jpg",
        summary="Apostle Chrispen Mahovo's teaching on receiving the healing Jesus paid for.",
        description="Healing is not a reward for the good; it is the children's bread. In this book Apostle Chrispen "
        "Mahovo opens the Scriptures on divine healing and shares testimonies from crusades across Zimbabwe.\n\n"
        "Paperback, 180 pages. Each chapter ends with prayer points and confessions.",
    ),
    dict(
        slug="sample-walking-in-the-prophetic",
        name="Walking in the Prophetic",
        category="books",
        price="12.00",
        stock=25,
        sort_order=2,
        image="walking-in-the-prophetic.jpg",
        summary="Prophetess Yvonne Mahovo on hearing God for yourself and your family.",
        description="A practical guide to hearing the voice of God, testing prophecy by the Word, and praying with "
        "authority over your home.\n\nPaperback, 140 pages.",
    ),
    dict(
        slug="sample-prayer-journal",
        name="My Prayer Journal",
        category="books",
        price="9.00",
        stock=60,
        sort_order=3,
        image="prayer-journal.jpg",
        summary="90 days of guided prayer, scripture and thanksgiving.",
        description="Write down your prayer points, the scriptures God gives you and the answers you receive. "
        "Hardback with an elastic band and ribbon marker.",
    ),
    dict(
        slug="sample-night-of-miracles-usb",
        name="Night of Miracles: Sermon Collection (USB)",
        category="media",
        price="8.00",
        stock=None,
        is_featured=True,
        sort_order=1,
        image="sermon-usb.jpg",
        summary="Ten sermons by Apostle Chrispen Mahovo on an 8 GB USB stick, audio and video.",
        description="Recorded live at our Friday Night of Miracles services. Plays in cars, phones, TVs and "
        "computers. MP3 audio and MP4 video.",
    ),
    dict(
        slug="sample-crusade-highlights-dvd",
        name="Crusade Highlights (DVD)",
        category="media",
        price="7.00",
        stock=30,
        sort_order=2,
        image="crusade-dvd.jpg",
        summary="Worship, preaching and testimonies from the Healing & Deliverance Crusade.",
        description="Two hours of highlights from three nights of power ministry. Share it with someone who needs "
        "a touch from God.",
    ),
    dict(
        slug="sample-changing-lives-t-shirt",
        name="Changing Lives T-shirt",
        category="clothing",
        price="18.00",
        stock=50,
        is_featured=True,
        sort_order=1,
        option_name="Size",
        options="S, M, L, XL, XXL",
        image="changing-lives-tshirt.jpg",
        summary="Royal blue cotton T-shirt with the church badge and our vision.",
        description="100% cotton, printed front: \"Changing lives, reviving nations\". Wear it to crusades and "
        "outreaches.\n\nSizes run true to fit.",
    ),
    dict(
        slug="sample-heal-the-world-cap",
        name="Heal The World Cap",
        category="clothing",
        price="12.00",
        stock=30,
        sort_order=2,
        image="omega-cap.jpg",
        summary="Navy cap with the embroidered church badge. One size, adjustable.",
        description="Cotton twill with an adjustable strap at the back.",
    ),
    dict(
        slug="sample-anointing-oil",
        name="Anointing Oil (50 ml)",
        category="gifts",
        price="5.00",
        stock=100,
        is_featured=True,
        sort_order=1,
        image="anointing-oil.jpg",
        summary="Olive oil, prayed over, for anointing the sick and your home. James 5:14.",
        description="\"Is any sick among you? let him call for the elders of the church; and let them pray over him, "
        "anointing him with oil in the name of the Lord.\" James 5:14\n\n50 ml glass bottle.",
    ),
    dict(
        slug="sample-omega-family-church-mug",
        name="Omega Family Church Mug",
        category="gifts",
        price="10.00",
        stock=3,
        sort_order=2,
        image="church-mug.jpg",
        summary="White ceramic mug with the church badge. Only a few left.",
        description="330 ml, dishwasher safe.",
    ),
    dict(
        slug="sample-faith-wristband",
        name="Healings · Miracles · Deliverances Wristband",
        category="gifts",
        price="2.00",
        stock=0,
        sort_order=3,
        image="faith-wristband.jpg",
        summary="Purple silicone wristband. Sold out for now.",
        description="One size fits most adults.",
    ),
    dict(
        slug="sample-2027-church-calendar",
        name="2027 Church Calendar",
        category="gifts",
        price="6.00",
        stock=45,
        sort_order=4,
        image="church-calendar.jpg",
        summary="Wall calendar with the year's crusades, conferences and fasting days.",
        description="A3 wall calendar with a scripture for every month.",
        is_published=True,
    ),
]

ORDERS = [
    # (name, phone, fulfilment, status, days ago, method, provider, [(slug, option, quantity)])
    ("Tendai Moyo", "0771 234 567", "collect", "paid", 0, "mobile", "ecocash",
     [("sample-healing-is-your-portion", "", 1), ("sample-anointing-oil", "", 2)]),
    ("Rudo Chikore", "0772 345 678", "delivery", "ready", 1, "paypal", "",
     [("sample-changing-lives-t-shirt", "L", 2)]),
    ("Farai Ncube", "0773 456 789", "collect", "completed", 6, "mobile", "onemoney",
     [("sample-night-of-miracles-usb", "", 1), ("sample-prayer-journal", "", 1)]),
    ("Nyasha Phiri", "0774 567 890", "collect", "pending", 0, "mobile", "innbucks",
     [("sample-omega-family-church-mug", "", 1)]),
]


class Command(BaseCommand):
    help = "Add example store items (and, with --orders, example orders). --clear removes them."

    def add_arguments(self, parser):
        parser.add_argument("--orders", action="store_true", help="Also add a few example orders for the admin.")
        parser.add_argument("--clear", action="store_true", help="Remove the example items and orders.")

    def handle(self, *args, orders=False, clear=False, **options):
        if clear:
            n_orders, _ = Order.objects.filter(email=SAMPLE_EMAIL).delete()
            samples = Product.objects.filter(slug__startswith="sample-")
            for product in samples:
                if product.image:
                    product.image.delete(save=False)
            n_products, _ = samples.delete()
            self.stdout.write(self.style.SUCCESS(f"Removed {n_products} example items and the example orders."))
            return

        added = 0
        for data in PRODUCTS:
            data = dict(data)
            image = data.pop("image")
            slug = data.pop("slug")
            data["price"] = Decimal(data["price"])
            product, created = Product.objects.update_or_create(slug=slug, defaults=data)
            added += created
            if not product.image:
                with open(IMAGES / image, "rb") as fh:
                    product.image.save(f"sample-{image}", File(fh), save=True)
        self.stdout.write(self.style.SUCCESS(f"Store ready: {len(PRODUCTS)} example items ({added} new)."))

        if orders:
            self.add_orders()

    @transaction.atomic
    def add_orders(self):
        Order.objects.filter(email=SAMPLE_EMAIL).delete()
        site = SiteSettings.load()
        products = {p.slug: p for p in Product.objects.filter(slug__startswith="sample-")}
        now = timezone.now()
        for name, phone, fulfilment, status, days_ago, method, provider, lines in ORDERS:
            subtotal = sum(products[slug].price * qty for slug, _, qty in lines)
            fee = site.store_delivery_fee if fulfilment == "delivery" else Decimal("0")
            paid = status != "pending"
            order = Order.objects.create(
                customer_name=name,
                contact_phone=phone,
                email=SAMPLE_EMAIL,
                fulfilment=fulfilment,
                address="12 Samora Machel Avenue, Harare" if fulfilment == "delivery" else "",
                subtotal=subtotal,
                delivery_fee=fee,
                total=subtotal + fee,
                currency=site.currency,
                method=method,
                provider=provider,
                payer_phone=phone.replace(" ", "") if method == "mobile" else "",
                provider_reference="SAMPLE" if paid else "",
                provider_status="Paid" if paid else "Sent",
                status=status,
                paid_at=now - timedelta(days=days_ago) if paid else None,
                staff_notes="Example order made by load_sample_store. Remove with --clear.",
            )
            Order.objects.filter(pk=order.pk).update(created_at=now - timedelta(days=days_ago, minutes=5))
            OrderItem.objects.bulk_create([
                OrderItem(order=order, product=products[slug], name=products[slug].name, option=option,
                          unit_price=products[slug].price, quantity=qty, line_total=products[slug].price * qty)
                for slug, option, qty in lines
            ])
        self.stdout.write(self.style.SUCCESS(f"Added {len(ORDERS)} example orders."))
