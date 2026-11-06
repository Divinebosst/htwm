from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.validators import UnicodeUsernameValidator
from rest_framework import serializers

from .roles import MANAGEABLE_ROLES, ROLE_LABELS, can_manage_role, perms_for_role, role_of, stored_role

User = get_user_model()


def me_payload(user):
    role = role_of(user)
    profile = getattr(user, "staff_profile", None)
    return {
        "id": user.pk,
        "username": user.get_username(),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.get_full_name() or user.get_username(),
        "email": user.email,
        "role": role,
        "role_label": ROLE_LABELS.get(role, ""),
        "permissions": perms_for_role(role) if role else [],
        "manageable_roles": [{"value": r, "label": ROLE_LABELS[r]} for r in MANAGEABLE_ROLES.get(role, [])],
        "must_change_password": bool(profile and profile.must_change_password),
        "time_zone": settings.TIME_ZONE,
    }


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=256, trim_whitespace=False)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False, max_length=256)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("That isn't your current password.")
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "Choose a password different from the current one."})
        password_validation.validate_password(attrs["new_password"], self.context["request"].user)
        return attrs


class StaffUserSerializer(serializers.ModelSerializer):
    """Staff account as shown and edited on the Users page."""

    role = serializers.ChoiceField(choices=list(ROLE_LABELS.items()), source="staff_profile.role")
    role_label = serializers.SerializerMethodField()
    must_change_password = serializers.BooleanField(source="staff_profile.must_change_password", read_only=True)
    can_edit = serializers.SerializerMethodField()
    is_you = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "email",
            "role",
            "role_label",
            "is_active",
            "must_change_password",
            "last_login",
            "date_joined",
            "can_edit",
            "is_you",
        ]
        read_only_fields = ["id", "last_login", "date_joined"]
        extra_kwargs = {"username": {"validators": [UnicodeUsernameValidator()]}}

    def _actor(self):
        return self.context["request"].user

    def get_role_label(self, obj):
        return ROLE_LABELS.get(stored_role(obj) or "", "")

    def get_can_edit(self, obj):
        actor = self._actor()
        return obj.pk != actor.pk and can_manage_role(role_of(actor), stored_role(obj) or "")

    def get_is_you(self, obj):
        return obj.pk == self._actor().pk

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data["role"] = stored_role(obj)  # covers superusers without a profile
        return data

    def validate_username(self, value):
        value = value.strip()
        qs = User.objects.filter(username__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("That username is already taken.")
        return value
