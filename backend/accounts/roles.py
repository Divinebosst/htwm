"""
Staff roles and what each one may do.

This file is the single source of truth for permissions. The API checks it
on every request, and the admin website uses the same list (via /api/auth/me)
to decide which pages to show.
"""

SYSTEM_ADMIN = "system_admin"
ADMIN = "admin"
PASTOR = "pastor"
CARETAKER = "caretaker"

ROLE_CHOICES = [
    (SYSTEM_ADMIN, "System Admin"),
    (ADMIN, "Admin"),
    (PASTOR, "Pastor"),
    (CARETAKER, "Caretaker"),
]
ROLE_LABELS = dict(ROLE_CHOICES)
ALL_ROLES = {SYSTEM_ADMIN, ADMIN, PASTOR, CARETAKER}

PERMISSIONS = {
    # Everyone who can sign in
    "dashboard.view": ALL_ROLES,
    "events.edit": ALL_ROLES,
    "services.edit": ALL_ROLES,
    # Prayer requests. Private ones are promised to "pastors and the prayer team" only.
    "prayer.view": {SYSTEM_ADMIN, ADMIN, PASTOR},
    "prayer.view_private": {SYSTEM_ADMIN, PASTOR},
    "prayer.edit": {SYSTEM_ADMIN, PASTOR},
    # Giving
    "gifts.view": {SYSTEM_ADMIN, ADMIN, PASTOR},
    "gifts.edit": {SYSTEM_ADMIN, ADMIN},
    "giving.edit": {SYSTEM_ADMIN, ADMIN},
    # Church settings. Changing where money is sent is limited to System Admins.
    "settings.view": {SYSTEM_ADMIN, ADMIN},
    "settings.edit_contact": {SYSTEM_ADMIN, ADMIN},
    "settings.edit_payment": {SYSTEM_ADMIN},
    # Staff accounts and the audit log
    "users.view": {SYSTEM_ADMIN, ADMIN},
    "users.edit": {SYSTEM_ADMIN, ADMIN},
    "audit.view": {SYSTEM_ADMIN, ADMIN},
}

# Which roles each role may give out or manage
MANAGEABLE_ROLES = {
    SYSTEM_ADMIN: [SYSTEM_ADMIN, ADMIN, PASTOR, CARETAKER],
    ADMIN: [PASTOR, CARETAKER],
}


def stored_role(user):
    """The role saved for this account, even if the account is switched off."""
    profile = getattr(user, "staff_profile", None)
    if profile is not None:
        return profile.role
    if user.is_superuser:
        return SYSTEM_ADMIN
    return None


def role_of(user):
    """The user's staff role, or None if they can't use the admin right now."""
    if not user or not getattr(user, "is_authenticated", False) or not user.is_active:
        return None
    return stored_role(user)


def has_perm(user, perm):
    role = role_of(user)
    return role is not None and role in PERMISSIONS.get(perm, ())


def perms_for_role(role):
    return sorted(name for name, roles in PERMISSIONS.items() if role in roles)


def can_manage_role(actor_role, target_role):
    return target_role in MANAGEABLE_ROLES.get(actor_role, [])
