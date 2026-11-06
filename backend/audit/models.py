from django.conf import settings
from django.db import models


class AuditLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise PermissionError("Audit log entries can't be changed.")

    def delete(self):
        raise PermissionError("Audit log entries can't be deleted.")


class AuditLog(models.Model):
    """One thing that happened: who, what, when, from where. Append-only."""

    ACTIONS = [
        ("create", "Created"),
        ("update", "Changed"),
        ("delete", "Deleted"),
        ("login", "Signed in"),
        ("login_failed", "Failed sign-in"),
        ("logout", "Signed out"),
        ("password_change", "Changed own password"),
        ("password_reset", "Reset a password"),
        ("access_denied", "Access denied"),
    ]
    SOURCES = [
        ("staff", "Staff admin"),
        ("django_admin", "Django admin"),
        ("public", "Public website"),
        ("system", "System"),
    ]

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_entries"
    )
    actor_label = models.CharField(max_length=150, help_text="Username at the time, or who acted.")
    actor_role = models.CharField(max_length=30, blank=True)
    action = models.CharField(max_length=20, choices=ACTIONS, db_index=True)
    object_type = models.CharField(max_length=40, blank=True, db_index=True)
    object_id = models.CharField(max_length=40, blank=True)
    object_repr = models.CharField(max_length=200, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    source = models.CharField(max_length=20, choices=SOURCES, default="system")

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "audit log entry"
        verbose_name_plural = "audit log"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor_label} {self.get_action_display()} {self.object_repr}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Audit log entries can't be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Audit log entries can't be deleted.")
