from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin

from .models import StaffProfile

User = get_user_model()


class StaffProfileInline(admin.StackedInline):
    model = StaffProfile
    can_delete = False
    fields = ["role", "must_change_password"]


admin.site.unregister(User)


@admin.register(User)
class StaffUserAdmin(UserAdmin):
    inlines = [StaffProfileInline]
    list_display = ["username", "first_name", "last_name", "email", "staff_role", "is_active", "last_login"]

    @admin.display(description="Role")
    def staff_role(self, obj):
        profile = getattr(obj, "staff_profile", None)
        return profile.get_role_display() if profile else ("System Admin" if obj.is_superuser else "—")
