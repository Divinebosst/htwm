from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"
    verbose_name = "Staff accounts"

    def ready(self):
        from django.contrib.auth import get_user_model
        from django.db.models.signals import post_save

        from .models import StaffProfile
        from .roles import SYSTEM_ADMIN

        def superuser_gets_system_admin_role(sender, instance, created, raw=False, **kwargs):
            # `manage.py createsuperuser` makes a System Admin
            if created and not raw and instance.is_superuser:
                StaffProfile.objects.get_or_create(user=instance, defaults={"role": SYSTEM_ADMIN})

        post_save.connect(superuser_gets_system_admin_role, sender=get_user_model(),
                          dispatch_uid="accounts.superuser_role")
