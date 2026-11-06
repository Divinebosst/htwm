"""
Staff API used by the admin pages on the website (/admin).

Every view states the permission it needs (see accounts/roles.py). Every
change is written to the audit log automatically by audit/signals.py.
"""

from collections import defaultdict
from datetime import datetime, time
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import StaffPermission, StaffSessionAuthentication
from accounts.roles import has_perm
from config.api import paginate

from .models import Event, Gift, GivingCategory, PrayerRequest, ServiceTime, SiteSettings

MAX_IMAGE_BYTES = 5 * 1024 * 1024


class StaffAPIView(APIView):
    authentication_classes = [StaffSessionAuthentication]


def _money(rows):
    """[{'currency': 'USD', 'total': Decimal}] -> {'USD': '85.00'}"""
    return {r["currency"]: f"{(r['total'] or Decimal('0')):.2f}" for r in rows}


# ---------------------------------------------------------------- dashboard


class DashboardView(StaffAPIView):
    permission_classes = [StaffPermission("dashboard.view")]

    def get(self, request):
        user = request.user
        now = timezone.now()
        data = {}

        upcoming = Event.objects.upcoming(now)
        data["events"] = {
            "upcoming_count": upcoming.count(),
            "unpublished_count": Event.objects.filter(is_published=False).count(),
            "next": [
                {"id": e.id, "title": e.title, "starts_at": e.starts_at, "slug": e.slug, "is_published": e.is_published}
                for e in upcoming[:4]
            ],
        }

        if has_perm(user, "prayer.view"):
            prayers = PrayerRequest.objects.all()
            if not has_perm(user, "prayer.view_private"):
                prayers = prayers.filter(is_private=False)
            data["prayer"] = {
                "new_count": prayers.filter(status="new").count(),
                "total_count": prayers.count(),
            }

        if has_perm(user, "gifts.view"):
            month_start = timezone.make_aware(datetime.combine(timezone.localdate().replace(day=1), time.min))
            pending = Gift.objects.filter(status="pending")
            received = Gift.objects.filter(status="received", confirmed_at__gte=month_start)
            data["gifts"] = {
                "pending_count": pending.count(),
                "pending_totals": _money(pending.values("currency").annotate(total=Sum("amount"))),
                "received_this_month": _money(received.values("currency").annotate(total=Sum("amount"))),
                "received_this_month_count": received.count(),
            }

        if has_perm(user, "audit.view"):
            from audit.views import AuditLogSerializer
            from audit.models import AuditLog

            data["activity"] = AuditLogSerializer(AuditLog.objects.all()[:8], many=True).data

        if has_perm(user, "users.view"):
            from django.contrib.auth import get_user_model

            data["staff"] = {
                "active_count": get_user_model().objects.filter(is_active=True)
                .filter(Q(staff_profile__isnull=False) | Q(is_superuser=True)).count()
            }
        return Response(data)


# ---------------------------------------------------------------- events


class EventAdminSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    image_url = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id",
            "slug",
            "title",
            "category",
            "category_label",
            "starts_at",
            "ends_at",
            "location",
            "summary",
            "description",
            "image_url",
            "registration_url",
            "is_featured",
            "is_published",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["slug", "created_at", "updated_at"]

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None

    def get_status(self, obj):
        end = obj.ends_at or obj.starts_at
        return "past" if end < timezone.now() else "upcoming"

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends < starts:
            raise serializers.ValidationError({"ends_at": "The end must be after the start."})
        return attrs


class EventAdminList(StaffAPIView):
    """GET (?when=upcoming|past|all), POST /api/admin/events"""

    permission_classes = [StaffPermission("events.edit")]

    def get(self, request):
        when = request.query_params.get("when", "upcoming")
        qs = Event.objects.all()
        if when == "upcoming":
            qs = qs.upcoming()
        elif when == "past":
            qs = qs.past()
        else:
            qs = qs.order_by("-starts_at")
        return Response(EventAdminSerializer(qs[:300], many=True).data)

    def post(self, request):
        s = EventAdminSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=status.HTTP_201_CREATED)


class EventAdminDetail(StaffAPIView):
    """GET, PATCH, DELETE /api/admin/events/<id>"""

    permission_classes = [StaffPermission("events.edit")]

    def get_object(self, pk):
        return Event.objects.filter(pk=pk).first()

    def get(self, request, pk):
        event = self.get_object(pk)
        if not event:
            return Response({"detail": "Event not found."}, status=404)
        return Response(EventAdminSerializer(event).data)

    def patch(self, request, pk):
        event = self.get_object(pk)
        if not event:
            return Response({"detail": "Event not found."}, status=404)
        s = EventAdminSerializer(event, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    def delete(self, request, pk):
        event = self.get_object(pk)
        if not event:
            return Response({"detail": "Event not found."}, status=404)
        if event.image:
            event.image.delete(save=False)
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventImage(StaffAPIView):
    """POST (multipart 'image'), DELETE /api/admin/events/<id>/image"""

    permission_classes = [StaffPermission("events.edit")]
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        event = Event.objects.filter(pk=pk).first()
        if not event:
            return Response({"detail": "Event not found."}, status=404)
        field = serializers.ImageField()
        try:
            image = field.run_validation(request.data.get("image"))
        except serializers.ValidationError as exc:
            return Response({"image": exc.detail}, status=400)
        except DjangoValidationError:
            return Response({"image": ["Please choose a picture file (JPG, PNG or WebP)."]}, status=400)
        if image.size > MAX_IMAGE_BYTES:
            return Response({"image": ["Please choose a picture smaller than 5 MB."]}, status=400)
        if event.image:
            event.image.delete(save=False)
        event.image = image
        event.save()
        return Response(EventAdminSerializer(event).data)

    def delete(self, request, pk):
        event = Event.objects.filter(pk=pk).first()
        if not event:
            return Response({"detail": "Event not found."}, status=404)
        if event.image:
            event.image.delete(save=False)
            event.image = None
            event.save()
        return Response(EventAdminSerializer(event).data)


# ---------------------------------------------------------------- service times


class ServiceTimeAdminSerializer(serializers.ModelSerializer):
    day_name = serializers.CharField(source="get_day_display", read_only=True)

    class Meta:
        model = ServiceTime
        fields = ["id", "day", "day_name", "start_time", "title", "description", "order", "is_active"]


class ServiceTimeAdminList(StaffAPIView):
    permission_classes = [StaffPermission("services.edit")]

    def get(self, request):
        return Response(ServiceTimeAdminSerializer(ServiceTime.objects.all(), many=True).data)

    def post(self, request):
        s = ServiceTimeAdminSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=status.HTTP_201_CREATED)


class ServiceTimeAdminDetail(StaffAPIView):
    permission_classes = [StaffPermission("services.edit")]

    def patch(self, request, pk):
        obj = ServiceTime.objects.filter(pk=pk).first()
        if not obj:
            return Response({"detail": "Service time not found."}, status=404)
        s = ServiceTimeAdminSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    def delete(self, request, pk):
        obj = ServiceTime.objects.filter(pk=pk).first()
        if not obj:
            return Response({"detail": "Service time not found."}, status=404)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- prayer requests


class PrayerAdminSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PrayerRequest
        fields = [
            "id",
            "name",
            "contact",
            "kind",
            "kind_label",
            "message",
            "is_private",
            "status",
            "status_label",
            "staff_notes",
            "created_at",
        ]
        read_only_fields = ["name", "contact", "kind", "message", "is_private", "created_at"]


def _prayers_for(user):
    qs = PrayerRequest.objects.all()
    if not has_perm(user, "prayer.view_private"):
        qs = qs.filter(is_private=False)
    return qs


class PrayerAdminList(StaffAPIView):
    """GET /api/admin/prayer-requests ?status= ?kind= ?q="""

    permission_classes = [StaffPermission("prayer.view", "prayer.edit")]

    def get(self, request):
        p = request.query_params
        qs = _prayers_for(request.user)
        counts = {row["status"]: row["n"] for row in qs.values("status").annotate(n=Count("id"))}
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if p.get("q"):
            qs = qs.filter(Q(name__icontains=p["q"]) | Q(message__icontains=p["q"]) | Q(contact__icontains=p["q"]))
        return paginate(
            request,
            qs,
            PrayerAdminSerializer,
            extra={
                "status_counts": counts,
                "statuses": [{"value": v, "label": l} for v, l in PrayerRequest.STATUSES],
                "kinds": [{"value": v, "label": l} for v, l in PrayerRequest.KINDS],
                "can_see_private": has_perm(request.user, "prayer.view_private"),
            },
        )


class PrayerAdminDetail(StaffAPIView):
    """PATCH /api/admin/prayer-requests/<id> (status, staff_notes)"""

    permission_classes = [StaffPermission("prayer.view", "prayer.edit")]

    def patch(self, request, pk):
        obj = _prayers_for(request.user).filter(pk=pk).first()
        if not obj:
            return Response({"detail": "Request not found."}, status=404)
        s = PrayerAdminSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


# ---------------------------------------------------------------- gifts


class GiftAdminSerializer(serializers.ModelSerializer):
    category = serializers.CharField(source="category.key", read_only=True)
    category_label = serializers.CharField(source="category.label", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Gift
        fields = [
            "id",
            "category",
            "category_label",
            "purpose",
            "amount",
            "currency",
            "method",
            "method_label",
            "reference",
            "giver_name",
            "giver_contact",
            "anonymous",
            "status",
            "status_label",
            "staff_notes",
            "created_at",
            "confirmed_at",
        ]
        read_only_fields = [f for f in fields if f not in ("status", "staff_notes")]

    def update(self, instance, validated):
        new_status = validated.get("status", instance.status)
        if new_status != instance.status:
            validated["confirmed_at"] = timezone.now() if new_status == "received" else None
        return super().update(instance, validated)


def _filtered_gifts(request):
    p = request.query_params
    qs = Gift.objects.select_related("category")
    if p.get("status"):
        qs = qs.filter(status=p["status"])
    if p.get("method"):
        qs = qs.filter(method=p["method"])
    if p.get("category"):
        qs = qs.filter(category__key=p["category"])
    if p.get("q"):
        q = p["q"].strip()
        qs = qs.filter(Q(reference__icontains=q) | Q(giver_name__icontains=q) | Q(giver_contact__icontains=q))
    tz = timezone.get_current_timezone()
    for key, op in (("date_from", "gte"), ("date_to", "lte")):
        try:
            d = datetime.strptime(p.get(key, ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        edge = time.min if op == "gte" else time.max
        qs = qs.filter(**{f"created_at__{op}": timezone.make_aware(datetime.combine(d, edge), tz)})
    return qs


class GiftAdminList(StaffAPIView):
    """GET /api/admin/gifts ?status= ?method= ?category= ?q= ?date_from= ?date_to="""

    permission_classes = [StaffPermission("gifts.view", "gifts.edit")]

    def get(self, request):
        qs = _filtered_gifts(request)
        totals = defaultdict(dict)
        for row in qs.values("status", "currency").annotate(total=Sum("amount"), n=Count("id")):
            totals[row["status"]][row["currency"]] = {"total": f"{row['total']:.2f}", "count": row["n"]}
        return paginate(
            request,
            qs,
            GiftAdminSerializer,
            extra={
                "totals": totals,
                "statuses": [{"value": v, "label": l} for v, l in Gift.STATUSES],
                "methods": [{"value": v, "label": l} for v, l in Gift.METHODS],
                "categories": [{"value": c.key, "label": c.label} for c in GivingCategory.objects.all()],
            },
        )


class GiftAdminDetail(StaffAPIView):
    """PATCH /api/admin/gifts/<id> (status, staff_notes)"""

    permission_classes = [StaffPermission("gifts.view", "gifts.edit")]

    def patch(self, request, pk):
        gift = Gift.objects.select_related("category").filter(pk=pk).first()
        if not gift:
            return Response({"detail": "Gift not found."}, status=404)
        s = GiftAdminSerializer(gift, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class GiftBulkStatus(StaffAPIView):
    """POST /api/admin/gifts/bulk {ids: [..], status: "received"}"""

    permission_classes = [StaffPermission("gifts.edit")]

    @transaction.atomic
    def post(self, request):
        ids = request.data.get("ids") or []
        new_status = request.data.get("status")
        if new_status not in dict(Gift.STATUSES) or not isinstance(ids, list) or not ids:
            return Response({"detail": "Choose some gifts and a status."}, status=400)
        changed = 0
        for gift in Gift.objects.filter(pk__in=[i for i in ids if str(i).isdigit()][:500]):
            if gift.status != new_status:
                gift.status = new_status
                gift.confirmed_at = timezone.now() if new_status == "received" else None
                gift.save()  # one audit entry per gift
                changed += 1
        return Response({"changed": changed})


# ---------------------------------------------------------------- giving categories


class GivingCategoryAdminSerializer(serializers.ModelSerializer):
    gift_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = GivingCategory
        fields = ["id", "key", "label", "description", "reference_code", "asks_purpose", "order", "is_active",
                  "gift_count"]


class GivingCategoryAdminList(StaffAPIView):
    permission_classes = [StaffPermission("giving.edit")]

    def get(self, request):
        qs = GivingCategory.objects.annotate(gift_count=Count("gifts"))
        return Response(GivingCategoryAdminSerializer(qs, many=True).data)

    def post(self, request):
        s = GivingCategoryAdminSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=status.HTTP_201_CREATED)


class GivingCategoryAdminDetail(StaffAPIView):
    permission_classes = [StaffPermission("giving.edit")]

    def patch(self, request, pk):
        obj = GivingCategory.objects.filter(pk=pk).first()
        if not obj:
            return Response({"detail": "Category not found."}, status=404)
        s = GivingCategoryAdminSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


# ---------------------------------------------------------------- church settings

CONTACT_FIELDS = [
    "church_name",
    "short_name",
    "phone_primary",
    "phone_secondary",
    "whatsapp_number",
    "email",
    "facebook_url",
    "youtube_url",
    "website_url",
]
PAYMENT_FIELDS = [
    "currency",
    "preset_amounts",
    "ecocash_merchant_name",
    "ecocash_merchant_code",
    "ecocash_steps",
    "bank_account_name",
    "bank_name",
    "bank_branch",
    "bank_account_number",
    "bank_account_currency",
    "bank_swift",
    "online_giving_url",
    "abroad_recipient_name",
    "abroad_recipient_phone",
    "abroad_country",
    "abroad_services",
]


class SettingsAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = CONTACT_FIELDS + PAYMENT_FIELDS


class SettingsAdminView(StaffAPIView):
    """GET, PATCH /api/admin/settings. Payment details need the System Admin role."""

    permission_classes = [StaffPermission("settings.view", "settings.edit_contact")]

    def _payload(self, request, obj):
        return {
            "values": SettingsAdminSerializer(obj).data,
            "contact_fields": CONTACT_FIELDS,
            "payment_fields": PAYMENT_FIELDS,
            "can_edit_contact": has_perm(request.user, "settings.edit_contact"),
            "can_edit_payment": has_perm(request.user, "settings.edit_payment"),
        }

    def get(self, request):
        return Response(self._payload(request, SiteSettings.load()))

    def patch(self, request):
        obj = SiteSettings.load()
        current = SettingsAdminSerializer(obj).data
        touched_payment = [f for f in PAYMENT_FIELDS if f in request.data and request.data[f] != current.get(f)]
        if touched_payment and not has_perm(request.user, "settings.edit_payment"):
            from audit.log import record

            record("access_denied", object_type="church settings", object_repr="Payment details",
                   changes={"needed": "settings.edit_payment", "fields": touched_payment})
            raise PermissionDenied("Only a System Admin can change payment details.")
        s = SettingsAdminSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(self._payload(request, obj))
