from datetime import datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.views import APIView

from accounts.permissions import StaffPermission, StaffSessionAuthentication
from config.api import paginate

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display")
    source_label = serializers.CharField(source="get_source_display")

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "created_at",
            "actor",
            "actor_label",
            "actor_role",
            "action",
            "action_label",
            "object_type",
            "object_id",
            "object_repr",
            "changes",
            "ip_address",
            "user_agent",
            "source",
            "source_label",
        ]


def _local_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


class AuditLogList(APIView):
    """
    GET /api/admin/audit
      ?action=login_failed  ?object_type=event  ?actor=<user id>  ?q=text
      ?date_from=2026-11-01 ?date_to=2026-11-30  ?page=2
    """

    authentication_classes = [StaffSessionAuthentication]
    permission_classes = [StaffPermission("audit.view")]

    def get(self, request):
        p = request.query_params
        qs = AuditLog.objects.all()
        if p.get("action"):
            qs = qs.filter(action=p["action"])
        if p.get("object_type"):
            qs = qs.filter(object_type=p["object_type"])
        if p.get("actor"):
            qs = qs.filter(actor_id=p["actor"]) if p["actor"].isdigit() else qs.filter(actor_label=p["actor"])
        if p.get("q"):
            q = p["q"].strip()
            qs = qs.filter(Q(object_repr__icontains=q) | Q(actor_label__icontains=q) | Q(ip_address__icontains=q))
        tz = timezone.get_current_timezone()
        start = _local_date(p.get("date_from"))
        end = _local_date(p.get("date_to"))
        if start:
            qs = qs.filter(created_at__gte=timezone.make_aware(datetime.combine(start, time.min), tz))
        if end:
            qs = qs.filter(created_at__lt=timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), tz))

        everything = AuditLog.objects.all()
        filters = {
            "actions": [{"value": v, "label": l} for v, l in AuditLog.ACTIONS],
            "object_types": sorted(t for t in everything.values_list("object_type", flat=True).distinct() if t),
            "actors": [
                {"value": str(a["actor"]), "label": a["actor_label"]}
                for a in everything.filter(actor__isnull=False).values("actor", "actor_label").distinct()
                .order_by("actor_label")
            ],
        }
        return paginate(request, qs, AuditLogSerializer, extra={"filters": filters})
