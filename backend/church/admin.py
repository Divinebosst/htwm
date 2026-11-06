from django.contrib import admin, messages
from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.html import format_html

from .models import Event, Gift, GivingCategory, PrayerRequest, ServiceTime, SiteSettings


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    fieldsets = [
        ("Church and contact", {"fields": ["church_name", "short_name", "phone_primary", "phone_secondary",
                                          "whatsapp_number", "email"]}),
        ("Links", {"fields": ["facebook_url", "youtube_url", "website_url"]}),
        ("Giving: general", {"fields": ["currency", "preset_amounts"]}),
        ("Giving: EcoCash", {"fields": ["ecocash_merchant_name", "ecocash_merchant_code", "ecocash_steps"]}),
        ("Giving: bank transfer", {"fields": ["bank_account_name", "bank_name", "bank_branch",
                                             "bank_account_number", "bank_account_currency", "bank_swift"]}),
        ("Giving: card / PayPal", {"fields": ["online_giving_url"]}),
        ("Giving: from abroad", {"fields": ["abroad_recipient_name", "abroad_recipient_phone", "abroad_country",
                                          "abroad_services"]}),
    ]

    def has_add_permission(self, request):
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ServiceTime)
class ServiceTimeAdmin(admin.ModelAdmin):
    list_display = ["title", "day", "start_time", "order", "is_active"]
    list_editable = ["order", "is_active"]


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["title", "starts_at", "category", "is_featured", "is_published", "when"]
    list_filter = ["category", "is_published", "is_featured"]
    list_editable = ["is_featured", "is_published"]
    search_fields = ["title", "summary", "location"]
    prepopulated_fields = {"slug": ["title"]}
    fieldsets = [
        (None, {"fields": ["title", "slug", "category", "summary", "description"]}),
        ("When and where", {"fields": ["starts_at", "ends_at", "location"]}),
        ("Extras", {"fields": ["image", "registration_url", "is_featured", "is_published"]}),
    ]

    @admin.display(description="")
    def when(self, obj):
        end = obj.ends_at or obj.starts_at
        if end < timezone.now():
            return format_html('<span style="color:#888">Past</span>')
        return format_html('<strong style="color:#0f7b4f">Upcoming</strong>')


@admin.register(GivingCategory)
class GivingCategoryAdmin(admin.ModelAdmin):
    list_display = ["label", "key", "reference_code", "order", "is_active"]
    list_editable = ["order", "is_active"]
    prepopulated_fields = {"key": ["label"]}


@admin.register(Gift)
class GiftAdmin(admin.ModelAdmin):
    list_display = ["created_at", "reference", "giver", "category", "amount_display", "method", "status"]
    list_filter = ["status", "method", "category", "created_at"]
    search_fields = ["reference", "giver_name", "giver_contact", "purpose"]
    readonly_fields = ["category", "purpose", "amount", "currency", "method", "reference", "giver_name",
                       "giver_contact", "anonymous", "created_at", "confirmed_at"]
    fields = ["category", "purpose", "amount", "currency", "method", "reference", "giver_name", "giver_contact",
              "anonymous", "status", "staff_notes", "created_at", "confirmed_at"]
    actions = ["mark_received", "mark_not_found"]

    def has_add_permission(self, request):
        return False

    @admin.display(description="Giver")
    def giver(self, obj):
        return "Anonymous" if obj.anonymous else (obj.giver_name or "—")

    @admin.display(description="Amount", ordering="amount")
    def amount_display(self, obj):
        return f"{obj.currency} {obj.amount:,.2f}"

    @admin.action(description="Mark selected gifts as received")
    def mark_received(self, request, queryset):
        n = queryset.update(status="received", confirmed_at=timezone.now())
        self.message_user(request, f"{n} gift(s) marked as received.", messages.SUCCESS)

    @admin.action(description="Mark selected gifts as not found")
    def mark_not_found(self, request, queryset):
        n = queryset.update(status="not_found", confirmed_at=None)
        self.message_user(request, f"{n} gift(s) marked as not found.", messages.WARNING)

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        try:
            qs = response.context_data["cl"].queryset
        except (AttributeError, KeyError):
            return response
        totals = qs.filter(status="received").values("currency").annotate(total=Sum("amount"), n=Count("id"))
        if totals:
            summary = ", ".join(
                f"{t['currency']} {t['total']:,.2f} ({t['n']} gift{'' if t['n'] == 1 else 's'})" for t in totals
            )
            messages.info(request, f"Received in this list: {summary}")
        return response


@admin.register(PrayerRequest)
class PrayerRequestAdmin(admin.ModelAdmin):
    list_display = ["created_at", "name", "kind", "short_message", "is_private", "status"]
    list_filter = ["status", "kind", "is_private"]
    search_fields = ["name", "contact", "message"]
    readonly_fields = ["name", "contact", "kind", "message", "is_private", "created_at"]
    fields = readonly_fields + ["status", "staff_notes"]
    actions = ["mark_prayed"]

    def has_add_permission(self, request):
        return False

    @admin.display(description="Message")
    def short_message(self, obj):
        return (obj.message[:80] + "…") if len(obj.message) > 80 else obj.message

    @admin.action(description="Mark selected as prayed for")
    def mark_prayed(self, request, queryset):
        n = queryset.update(status="prayed")
        self.message_user(request, f"{n} request(s) marked as prayed for.", messages.SUCCESS)
