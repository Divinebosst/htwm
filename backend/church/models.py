from decimal import Decimal

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify


def split_lines(text):
    return [line.strip() for line in (text or "").splitlines() if line.strip()]


def split_commas(text):
    return [item.strip() for item in (text or "").split(",") if item.strip()]


class SiteSettings(models.Model):
    """One row only. Contact and payment details shown on the website."""

    church_name = models.CharField(max_length=120, default="Heal The World Ministries International")
    short_name = models.CharField(max_length=80, default="Heal The World Ministries")
    phone_primary = models.CharField(max_length=40, default="0775 856 800")
    phone_secondary = models.CharField(max_length=40, blank=True, default="0770772105160")
    whatsapp_number = models.CharField(
        max_length=20,
        default="263775856800",
        validators=[RegexValidator(r"^\d{8,15}$", "Digits only, with country code, e.g. 263775856800")],
        help_text="Used for proof of payment and prayer requests. Digits only, with country code (263 = Zimbabwe).",
    )
    email = models.EmailField(blank=True)
    facebook_url = models.URLField(blank=True, default="https://www.facebook.com/apostlemahovoperth")
    youtube_url = models.URLField(
        blank=True, default="https://www.youtube.com/results?search_query=Apostle+Chrispen+Mahovo"
    )
    website_url = models.URLField(blank=True, default="https://www.healtheworldministries.com")

    # Giving
    currency = models.CharField(max_length=3, default="USD", help_text="ISO code, e.g. USD, ZAR, AUD, GBP.")
    preset_amounts = models.CharField(
        max_length=120, default="10,20,50,100,200,500", help_text="Quick-pick amounts, separated by commas."
    )
    ecocash_merchant_name = models.CharField(max_length=80, blank=True, default="Heal The World Ministries")
    ecocash_merchant_code = models.CharField(max_length=40, blank=True)
    ecocash_steps = models.TextField(
        blank=True,
        default=(
            "Dial *151# from your EcoCash line.\n"
            "Choose Make Payment, then Pay Merchant.\n"
            "Enter the merchant code and the amount.\n"
            "Enter your PIN and confirm. Keep the confirmation SMS."
        ),
        help_text="One step per line.",
    )
    bank_account_name = models.CharField(max_length=120, blank=True, default="Heal The World Ministries International")
    bank_name = models.CharField(max_length=80, blank=True)
    bank_branch = models.CharField(max_length=80, blank=True)
    bank_account_number = models.CharField(max_length=40, blank=True)
    bank_account_currency = models.CharField(max_length=10, blank=True, default="USD")
    bank_swift = models.CharField("SWIFT code", max_length=20, blank=True)
    online_giving_url = models.URLField(
        blank=True, help_text="PayPal Donate, Paynow, Stripe Payment Link, etc. Leave empty to show 'Coming soon'."
    )
    abroad_recipient_name = models.CharField(
        max_length=120, blank=True, help_text="Full name exactly as on the ID of the person who collects."
    )
    abroad_recipient_phone = models.CharField(max_length=40, blank=True)
    abroad_country = models.CharField(max_length=60, blank=True, default="Zimbabwe")
    abroad_services = models.CharField(max_length=200, blank=True, default="Mukuru, WorldRemit, Western Union")

    class Meta:
        verbose_name = "Church settings"
        verbose_name_plural = "Church settings"

    def __str__(self):
        return "Church settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def preset_amount_list(self):
        values = []
        for item in split_commas(self.preset_amounts):
            try:
                values.append(int(Decimal(item)))
            except Exception:
                continue
        return values


class ServiceTime(models.Model):
    DAYS = [
        (0, "Monday"),
        (1, "Tuesday"),
        (2, "Wednesday"),
        (3, "Thursday"),
        (4, "Friday"),
        (5, "Saturday"),
        (6, "Sunday"),
    ]

    day = models.PositiveSmallIntegerField(choices=DAYS)
    start_time = models.TimeField()
    title = models.CharField(max_length=80)
    description = models.CharField(max_length=200, blank=True)
    order = models.PositiveSmallIntegerField(default=0, help_text="Lower numbers show first.")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "day", "start_time"]

    def __str__(self):
        return f"{self.get_day_display()} {self.start_time:%H:%M} · {self.title}"


class EventQuerySet(models.QuerySet):
    def published(self):
        return self.filter(is_published=True)

    def upcoming(self, now=None):
        now = now or timezone.now()
        return self.filter(Q(ends_at__gte=now) | Q(ends_at__isnull=True, starts_at__gte=now)).order_by("starts_at")

    def past(self, now=None):
        now = now or timezone.now()
        return self.filter(Q(ends_at__lt=now) | Q(ends_at__isnull=True, starts_at__lt=now)).order_by("-starts_at")


class Event(models.Model):
    CATEGORIES = [
        ("service", "Special service"),
        ("crusade", "Crusade"),
        ("conference", "Conference"),
        ("prayer", "Prayer & fasting"),
        ("youth", "Youth"),
        ("women", "Women"),
        ("men", "Men"),
        ("outreach", "Outreach"),
        ("other", "Other"),
    ]

    title = models.CharField(max_length=140)
    slug = models.SlugField(max_length=160, unique=True, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORIES, default="service")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True, help_text="Leave empty for a single session.")
    location = models.CharField(max_length=160, blank=True, help_text="e.g. Omega Family Church main hall")
    summary = models.CharField(max_length=240, help_text="One or two sentences shown on the event card.")
    description = models.TextField(blank=True, help_text="Full details. Blank lines start a new paragraph.")
    image = models.ImageField(upload_to="events/", blank=True)
    registration_url = models.URLField(blank=True, help_text="Optional link to register or RSVP.")
    is_featured = models.BooleanField(default=False, help_text="Show this event first on the home page.")
    is_published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = EventQuerySet.as_manager()

    class Meta:
        ordering = ["starts_at"]

    def __str__(self):
        return f"{self.title} ({timezone.localtime(self.starts_at):%d %b %Y})"

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(f"{self.title}-{timezone.localtime(self.starts_at):%Y-%m-%d}")[:150] or "event"
            slug, n = base, 2
            while Event.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base}-{n}"
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)


class GivingCategory(models.Model):
    key = models.SlugField(max_length=30, unique=True, help_text="Used in links, e.g. give?type=tithe")
    label = models.CharField(max_length=60)
    description = models.CharField(max_length=120, blank=True)
    reference_code = models.CharField(
        max_length=10,
        validators=[RegexValidator(r"^[A-Z]{2,10}$", "2–10 capital letters, e.g. TITHE")],
        help_text="Start of the payment reference, e.g. TITHE → TITHE-MOYO",
    )
    asks_purpose = models.BooleanField(default=False, help_text="Ask the giver what the gift is for.")
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "label"]
        verbose_name_plural = "giving categories"

    def __str__(self):
        return self.label


def build_reference(code, name="", anonymous=False):
    """TITHE + 'Tendai Moyo' -> TITHE-MOYO. The frontend uses the same rule."""
    if anonymous or not name.strip():
        return code
    surname = "".join(ch for ch in name.split()[-1].upper() if "A" <= ch <= "Z")[:12]
    return f"{code}-{surname}" if surname else code


class Gift(models.Model):
    METHODS = [
        ("ecocash", "EcoCash"),
        ("bank", "Bank transfer"),
        ("card", "Card / PayPal"),
        ("abroad", "From abroad"),
    ]
    STATUSES = [
        ("pending", "Waiting for proof"),
        ("received", "Received"),
        ("not_found", "Not found"),
    ]

    category = models.ForeignKey(GivingCategory, on_delete=models.PROTECT, related_name="gifts")
    purpose = models.CharField(max_length=140, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    currency = models.CharField(max_length=3)
    method = models.CharField(max_length=10, choices=METHODS)
    reference = models.CharField(max_length=40, db_index=True)
    giver_name = models.CharField(max_length=120, blank=True)
    giver_contact = models.CharField(max_length=120, blank=True)
    anonymous = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUSES, default="pending")
    staff_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"#{self.pk} {self.reference} {self.currency} {self.amount}"


class PrayerRequest(models.Model):
    KINDS = [
        ("prayer", "Prayer request"),
        ("testimony", "Testimony"),
        ("counselling", "Request for counselling"),
    ]
    STATUSES = [
        ("new", "New"),
        ("prayed", "Prayed for"),
        ("followed_up", "Followed up"),
    ]

    name = models.CharField(max_length=120, blank=True)
    contact = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=20, choices=KINDS, default="prayer")
    message = models.TextField(max_length=5000)
    is_private = models.BooleanField(default=True, help_text="Only pastors and the prayer team should read it.")
    status = models.CharField(max_length=12, choices=STATUSES, default="new")
    staff_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} from {self.name or 'anonymous'}"
