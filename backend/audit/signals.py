"""
Records every create, change and delete of the church's data, whichever way
it happens (staff admin, Django admin, public website or a command).

Personal details are kept out of the log: for prayer requests only the
status, type and privacy flag are recorded, never the name, contact or message.
"""

import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.db.models.fields.files import FieldFile
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .log import record

HIDDEN = "(hidden)"


def _tracked():
    from accounts.models import StaffProfile
    from church.models import Event, Gift, GivingCategory, PrayerRequest, ServiceTime, SiteSettings

    return {
        Event: {"type": "event", "exclude": {"created_at", "updated_at"}},
        ServiceTime: {"type": "service time"},
        SiteSettings: {"type": "church settings", "repr": lambda o: "Church settings"},
        GivingCategory: {"type": "giving category"},
        Gift: {"type": "gift", "hide": {"giver_contact"}},
        PrayerRequest: {
            "type": "prayer request",
            "hide": {"name", "contact", "message", "staff_notes"},
            "repr": lambda o: f"{o.get_kind_display()} #{o.pk}",
        },
        get_user_model(): {
            "type": "staff account",
            "only": {"username", "first_name", "last_name", "email", "is_active"},
            "repr": lambda o: o.get_username(),
        },
        StaffProfile: {
            "type": "staff role",
            "only": {"role", "must_change_password"},
            "repr": lambda o: o.user.get_username(),
        },
    }


_CONFIG = None


def config_for(model):
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = _tracked()
    return _CONFIG.get(model)


def _fields(model, cfg):
    names = []
    for f in model._meta.concrete_fields:
        if f.primary_key:
            continue
        if "only" in cfg and f.name not in cfg["only"]:
            continue
        if f.name in cfg.get("exclude", set()):
            continue
        names.append(f)
    return names


def _plain(value):
    if isinstance(value, datetime.datetime) and value.tzinfo is not None:
        # Same moment written in different time zones must compare equal
        return value.astimezone(datetime.timezone.utc).isoformat()
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, FieldFile):
        return value.name or None
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _snapshot(instance, cfg):
    return {f.name: _plain(f.value_from_object(instance)) for f in _fields(type(instance), cfg)}


def _repr(instance, cfg):
    fn = cfg.get("repr")
    try:
        return fn(instance) if fn else str(instance)
    except Exception:
        return f"#{instance.pk}"


def _show(cfg, name, value):
    return HIDDEN if name in cfg.get("hide", set()) and value not in (None, "") else value


@receiver(pre_save)
def remember_old_values(sender, instance, raw=False, **kwargs):
    cfg = config_for(sender)
    if cfg is None or raw or instance.pk is None:
        return
    old = sender._default_manager.filter(pk=instance.pk).first()
    instance._audit_before = _snapshot(old, cfg) if old is not None else None


@receiver(post_save)
def log_save(sender, instance, created, raw=False, **kwargs):
    cfg = config_for(sender)
    if cfg is None or raw:
        return
    after = _snapshot(instance, cfg)
    before = None if created else getattr(instance, "_audit_before", None)
    if before is None:
        changes = {k: [None, _show(cfg, k, v)] for k, v in after.items() if v not in (None, "", False)}
        action = "create"
    else:
        changes = {
            k: [_show(cfg, k, before.get(k)), _show(cfg, k, v)] for k, v in after.items() if before.get(k) != v
        }
        if not changes:
            return  # nothing we track changed (e.g. a user's last login time)
        action = "update"
    record(action, obj=instance, object_type=cfg["type"], object_repr=_repr(instance, cfg), changes=changes)


@receiver(post_delete)
def log_delete(sender, instance, **kwargs):
    cfg = config_for(sender)
    if cfg is None:
        return
    before = _snapshot(instance, cfg)
    changes = {k: [_show(cfg, k, v), None] for k, v in before.items() if v not in (None, "", False)}
    record("delete", obj=instance, object_type=cfg["type"], object_repr=_repr(instance, cfg), changes=changes)


@receiver(user_logged_in)
def log_login(sender, request, user, **kwargs):
    record("login", actor=user, obj=user, object_type="staff account", object_repr=user.get_username(),
           request=request)


@receiver(user_logged_out)
def log_logout(sender, request, user, **kwargs):
    if user is not None:
        record("logout", actor=user, obj=user, object_type="staff account", object_repr=user.get_username(),
               request=request)


@receiver(user_login_failed)
def log_login_failed(sender, credentials, request=None, **kwargs):
    username = str(credentials.get("username", ""))[:150]
    record("login_failed", actor_label=username or "(no username)", object_type="staff account",
           object_repr=username, request=request)
