from django.conf import settings as django_settings
from rest_framework import serializers

from . import paynow, paypal

from .models import (
    Event,
    GivingCategory,
    PrayerRequest,
    ServiceTime,
    SiteSettings,
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
                "paypal_client_id": django_settings.PAYPAL_CLIENT_ID if paypal.is_configured() else "",
                "paypal_mode": django_settings.PAYPAL_MODE,
                "mobile_money_enabled": paynow.is_configured(),
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
