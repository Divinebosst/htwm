from decimal import Decimal

from django.conf import settings as django_settings
from rest_framework import serializers

from .models import (
    Event,
    Gift,
    GivingCategory,
    PrayerRequest,
    ServiceTime,
    SiteSettings,
    build_reference,
    split_commas,
    split_lines,
)


class SiteSettingsSerializer(serializers.BaseSerializer):
    """Public church details, grouped the way the website uses them."""

    def to_representation(self, s: SiteSettings):
        return {
            "church_name": s.church_name,
            "short_name": s.short_name,
            "time_zone": django_settings.TIME_ZONE,
            "phones": [p for p in (s.phone_primary, s.phone_secondary) if p],
            "whatsapp": s.whatsapp_number,
            "email": s.email,
            "social": {"facebook": s.facebook_url, "youtube": s.youtube_url, "website": s.website_url},
            "giving": {
                "currency": s.currency,
                "preset_amounts": s.preset_amount_list,
                "ecocash": {
                    "merchant_name": s.ecocash_merchant_name,
                    "merchant_code": s.ecocash_merchant_code,
                    "steps": split_lines(s.ecocash_steps),
                },
                "bank": {
                    "account_name": s.bank_account_name,
                    "bank_name": s.bank_name,
                    "branch": s.bank_branch,
                    "account_number": s.bank_account_number,
                    "account_currency": s.bank_account_currency,
                    "swift": s.bank_swift,
                },
                "online_giving_url": s.online_giving_url,
                "abroad": {
                    "recipient_name": s.abroad_recipient_name,
                    "recipient_phone": s.abroad_recipient_phone,
                    "country": s.abroad_country,
                    "services": split_commas(s.abroad_services),
                },
            },
        }


class ServiceTimeSerializer(serializers.ModelSerializer):
    day_name = serializers.CharField(source="get_day_display")

    class Meta:
        model = ServiceTime
        fields = ["id", "day", "day_name", "start_time", "title", "description"]


class EventSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display")
    image_url = serializers.SerializerMethodField()

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
        ]

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.image.url) if request else obj.image.url


class GivingCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = GivingCategory
        fields = ["key", "label", "description", "reference_code", "asks_purpose"]


class GiftCreateSerializer(serializers.ModelSerializer):
    category = serializers.SlugRelatedField(slug_field="key", queryset=GivingCategory.objects.filter(is_active=True))
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("1.00"), max_value=Decimal("1000000")
    )
    giver_name = serializers.CharField(max_length=120, required=False, allow_blank=True, trim_whitespace=True)
    giver_contact = serializers.CharField(max_length=120, required=False, allow_blank=True, trim_whitespace=True)
    purpose = serializers.CharField(max_length=140, required=False, allow_blank=True, trim_whitespace=True)

    # Read-only fields returned to the website after saving
    category_label = serializers.CharField(source="category.label", read_only=True)
    method_label = serializers.CharField(source="get_method_display", read_only=True)

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
            "giver_name",
            "giver_contact",
            "anonymous",
            "reference",
            "created_at",
        ]
        read_only_fields = ["id", "currency", "reference", "created_at"]

    def validate(self, attrs):
        if attrs.get("anonymous"):
            attrs["giver_name"] = ""
        return attrs

    def create(self, validated):
        site = SiteSettings.load()
        validated["currency"] = site.currency
        validated["reference"] = build_reference(
            validated["category"].reference_code, validated.get("giver_name", ""), validated.get("anonymous", False)
        )
        return super().create(validated)


class PrayerRequestCreateSerializer(serializers.ModelSerializer):
    # Hidden field that people never see. Bots fill it in; we reject those.
    website = serializers.CharField(required=False, allow_blank=True, write_only=True)
    message = serializers.CharField(max_length=5000, trim_whitespace=True)

    class Meta:
        model = PrayerRequest
        fields = ["id", "name", "contact", "kind", "message", "is_private", "website", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_website(self, value):
        if value:
            raise serializers.ValidationError("Leave this field empty.")
        return value

    def create(self, validated):
        validated.pop("website", None)
        return super().create(validated)
