"""Existing superusers become System Admins."""

from django.db import migrations


def forwards(apps, schema_editor):
    User = apps.get_model("auth", "User")
    StaffProfile = apps.get_model("accounts", "StaffProfile")
    for user in User.objects.filter(is_superuser=True):
        StaffProfile.objects.get_or_create(user=user, defaults={"role": "system_admin"})


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
