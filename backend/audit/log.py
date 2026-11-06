"""Write audit entries. Never raises: a logging problem must not break the action itself."""

import ipaddress
import logging

from .context import client_ip, current_request, source_of

logger = logging.getLogger(__name__)


def _valid_ip(value):
    try:
        return str(ipaddress.ip_address(value)) if value else None
    except ValueError:
        return None


def record(action, *, obj=None, object_type="", object_id="", object_repr="", changes=None, actor=None,
           actor_label=None, request=None):
    from accounts.roles import ROLE_LABELS, role_of

    from .models import AuditLog

    try:
        request = request or current_request()
        if actor is None and request is not None:
            user = getattr(request, "user", None)
            if user is not None and user.is_authenticated:
                actor = user

        source = source_of(request)
        if actor is not None:
            label = actor.get_username()
            role = ROLE_LABELS.get(role_of(actor) or "", "")
        else:
            label = actor_label or {"public": "Public website", "system": "System"}.get(source, "Unknown")
            role = ""

        if obj is not None:
            object_id = object_id or str(obj.pk)

        AuditLog.objects.create(
            actor=actor,
            actor_label=label[:150],
            actor_role=role,
            action=action,
            object_type=object_type[:40],
            object_id=str(object_id)[:40],
            object_repr=str(object_repr)[:200],
            changes=changes or {},
            ip_address=_valid_ip(client_ip(request)) if request is not None else None,
            user_agent=(request.META.get("HTTP_USER_AGENT", "") if request is not None else "")[:255],
            source=source,
        )
    except Exception:  # pragma: no cover - logged, never raised
        logger.exception("Could not write audit entry for %s", action)
