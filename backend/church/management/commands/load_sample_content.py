"""
Loads example service times and upcoming events so the website has
something to show. Replace them in the admin with the church's real ones.

    python manage.py load_sample_content          # add samples
    python manage.py load_sample_content --clear  # remove the samples again
"""

from datetime import date, datetime, time, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from church.models import Event, ServiceTime

SERVICES = [
    (6, time(10, 0), "Sunday Service", "Praise and worship, the Word, and prayer for healing and deliverance."),
    (2, time(17, 30), "Midweek Bible Study", "Teaching, questions and prayer to keep you strong through the week."),
    (4, time(18, 0), "Night of Miracles", "An evening of worship, prophetic ministry and prayer for the sick."),
]


def next_weekday(start: date, weekday: int, min_days: int = 0) -> date:
    d = start + timedelta(days=min_days)
    return d + timedelta(days=(weekday - d.weekday()) % 7)


def at(d: date, hh: int, mm: int = 0):
    return timezone.make_aware(datetime.combine(d, time(hh, mm)))


class Command(BaseCommand):
    help = "Load sample service times and events (replace them in the admin)."

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="Remove sample events and service times.")

    def handle(self, *args, clear=False, **options):
        if clear:
            n_events, _ = Event.objects.filter(slug__startswith="sample-").delete()
            n_services = 0
            for day, start, title, desc in SERVICES:
                n, _ = ServiceTime.objects.filter(day=day, start_time=start, title=title, description=desc).delete()
                n_services += n
            self.stdout.write(self.style.SUCCESS(f"Removed {n_events} sample events and {n_services} service times."))
            return

        today = timezone.localdate()

        if not ServiceTime.objects.exists():
            for order, (day, start, title, desc) in enumerate(SERVICES):
                ServiceTime.objects.create(day=day, start_time=start, title=title, description=desc, order=order)
            self.stdout.write("Added 3 sample service times.")

        crusade_day = next_weekday(today, 4, min_days=14)  # a Friday at least two weeks away
        fast_day = next_weekday(today, 0, min_days=28)  # a Monday about a month away
        women_day = next_weekday(today, 5, min_days=35)
        youth_day = next_weekday(today, 5, min_days=20)
        miracles_day = next_weekday(today, 4, min_days=3)
        nye = date(today.year, 12, 31) if today < date(today.year, 12, 31) else date(today.year + 1, 12, 31)

        events = [
            dict(
                title="Healing & Deliverance Crusade",
                category="crusade",
                starts_at=at(crusade_day, 17),
                ends_at=at(crusade_day + timedelta(days=2), 20),
                location="Omega Family Church",
                summary="Three nights of worship, the Word and prayer for the sick with Apostle Chrispen Mahovo. "
                "Bring the sick, the bound and the broken.",
                description="Join us for three nights of power ministry. Each night begins with praise and worship, "
                "followed by the preaching of the Word and prayer for healing and deliverance.\n\n"
                "Invite your family, friends and neighbours. Everyone is welcome and entry is free.",
                is_featured=True,
            ),
            dict(
                title="Night of Miracles",
                category="service",
                starts_at=at(miracles_day, 18),
                ends_at=at(miracles_day, 21),
                location="Omega Family Church",
                summary="A Friday night of worship, prophetic ministry and prayer for the sick.",
                description="Come expecting. Bring your prayer points and your testimony.",
            ),
            dict(
                title="Youth Revival Night",
                category="youth",
                starts_at=at(youth_day, 16),
                ends_at=at(youth_day, 19),
                location="Omega Family Church",
                summary="Worship, the Word and fellowship for young people. Bring a friend.",
                description="An evening for teenagers and young adults with worship, a message for this generation "
                "and time to pray together.",
            ),
            dict(
                title="21 Days of Prayer & Fasting",
                category="prayer",
                starts_at=at(fast_day, 6),
                ends_at=at(fast_day + timedelta(days=20), 19),
                location="Omega Family Church and online",
                summary="Seek God together as a church family. Prayer meetings every morning and evening.",
                description="Daily prayer meetings at 6:00 AM and 6:00 PM. Prayer points will be shared on our "
                "Facebook page each day.",
            ),
            dict(
                title="Women of Faith Conference",
                category="women",
                starts_at=at(women_day, 9),
                ends_at=at(women_day, 15),
                location="Omega Family Church",
                summary="A day of worship, teaching and prayer for women with Prophetess Yvonne Mahovo.",
                description="Teaching, testimonies and prayer for every woman, whatever season she is in.",
            ),
            dict(
                title="Cross Over Night",
                category="service",
                starts_at=at(nye, 20),
                ends_at=at(nye, 23, 59),
                location="Omega Family Church",
                summary="Cross into the new year in the presence of God with worship, the Word and prophetic declarations.",
                description="An all-night service to thank God for the year and receive the word for the new year.",
            ),
        ]

        added = 0
        for data in events:
            # the "sample-" slug lets --clear find these again
            slug = "sample-" + data["title"].lower().replace("&", "and").replace(" ", "-")
            _, created = Event.objects.update_or_create(slug=slug, defaults=data)
            added += created
        self.stdout.write(self.style.SUCCESS(f"Sample content ready ({added} new events)."))
