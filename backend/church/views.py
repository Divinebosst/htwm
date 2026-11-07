from rest_framework import generics, mixins, viewsets
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Event, GivingCategory, ServiceTime, SiteSettings
from .serializers import (
    EventSerializer,
    GivingCategorySerializer,
    PrayerRequestCreateSerializer,
    ServiceTimeSerializer,
    SiteSettingsSerializer,
)


class SiteSettingsView(APIView):
    """GET /api/settings — contact and giving details."""

    def get(self, request):
        return Response(SiteSettingsSerializer(SiteSettings.load()).data)


class ServiceTimeList(generics.ListAPIView):
    """GET /api/services — weekly service times."""

    serializer_class = ServiceTimeSerializer
    pagination_class = None

    def get_queryset(self):
        return ServiceTime.objects.filter(is_active=True)


class EventViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/events               upcoming events (soonest first)
    GET /api/events?when=past     past events (latest first)
    GET /api/events?limit=3       only the first few
    GET /api/events/<slug>        one event
    """

    serializer_class = EventSerializer
    lookup_field = "slug"
    pagination_class = None

    def get_queryset(self):
        qs = Event.objects.published()
        if self.action != "list":
            return qs
        if self.request.query_params.get("when") == "past":
            qs = qs.past()
        else:
            qs = qs.upcoming()
        try:
            limit = int(self.request.query_params.get("limit", 0))
        except ValueError:
            limit = 0
        return qs[: min(limit, 100)] if limit > 0 else qs[:100]


class GivingCategoryList(generics.ListAPIView):
    """GET /api/giving-categories"""

    serializer_class = GivingCategorySerializer
    pagination_class = None

    def get_queryset(self):
        return GivingCategory.objects.filter(is_active=True)


class PrayerRequestCreate(mixins.CreateModelMixin, generics.GenericAPIView):
    """POST /api/prayer-requests"""

    serializer_class = PrayerRequestCreateSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "prayer"

    def post(self, request, *args, **kwargs):
        return self.create(request, *args, **kwargs)
