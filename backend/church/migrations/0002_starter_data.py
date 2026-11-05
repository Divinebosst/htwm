"""Creates the church settings row and the standard giving categories."""

from django.db import migrations

CATEGORIES = [
    # key, label, description, reference code, asks purpose
    ("tithe", "Tithe", "The first tenth of your increase", "TITHE", False),
    ("offering", "Offering", "A freewill gift for the ministry", "OFFERING", False),
    ("thanksgiving", "Thanksgiving", "Thanking God for what He has done", "THANKS", False),
    ("seed", "Seed", "Sown in faith for a specific need", "SEED", False),
    ("building", "Building fund", "Church buildings, land and equipment", "BUILDING", False),
    ("missions", "Missions & outreach", "Crusades, evangelism and community care", "MISSIONS", False),
    ("partnership", "Partnership", "Regular support for the ministry's vision", "PARTNER", False),
    ("other", "Something else", "Tell us what your gift is for", "GIFT", True),
]


def forwards(apps, schema_editor):
    SiteSettings = apps.get_model("church", "SiteSettings")
    GivingCategory = apps.get_model("church", "GivingCategory")
    SiteSettings.objects.get_or_create(pk=1)
    for order, (key, label, description, code, asks) in enumerate(CATEGORIES):
        GivingCategory.objects.get_or_create(
            key=key,
            defaults={
                "label": label,
                "description": description,
                "reference_code": code,
                "asks_purpose": asks,
                "order": order,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("church", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
