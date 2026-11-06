from django.conf import settings
from django.db import models

from .roles import ROLE_CHOICES, SYSTEM_ADMIN


class StaffProfile(models.Model):
    """Links a Django user to a church staff role."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_profile")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    must_change_password = models.BooleanField(
        default=False, help_text="Ask for a new password at the next sign-in (set after a reset)."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "staff role"

    def __str__(self):
        return f"{self.user.username} ({self.get_role_display()})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # Only System Admins may use Django's built-in admin (/admin on the backend).
        user = self.user
        is_sys = self.role == SYSTEM_ADMIN
        if user.is_staff != is_sys or user.is_superuser != is_sys:
            user.is_staff = is_sys
            user.is_superuser = is_sys
            user.save(update_fields=["is_staff", "is_superuser"])
