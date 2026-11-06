from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Read-only view in Django's built-in admin."""

    list_display = ["created_at", "actor_label", "actor_role", "action", "object_type", "object_repr", "ip_address"]
    list_filter = ["action", "object_type", "source"]
    search_fields = ["actor_label", "object_repr", "ip_address"]
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
