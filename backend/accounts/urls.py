from django.urls import re_path

from . import views

auth_urlpatterns = [
    re_path(r"^csrf/?$", views.CsrfView.as_view(), name="auth-csrf"),
    re_path(r"^login/?$", views.LoginView.as_view(), name="auth-login"),
    re_path(r"^logout/?$", views.LogoutView.as_view(), name="auth-logout"),
    re_path(r"^me/?$", views.MeView.as_view(), name="auth-me"),
    re_path(r"^roles/?$", views.RolesView.as_view(), name="auth-roles"),
    re_path(r"^password/?$", views.PasswordChangeView.as_view(), name="auth-password"),
]

admin_urlpatterns = [
    re_path(r"^users/?$", views.StaffUserList.as_view(), name="admin-users"),
    re_path(r"^users/(?P<pk>\d+)/?$", views.StaffUserDetail.as_view(), name="admin-user"),
    re_path(r"^users/(?P<pk>\d+)/reset-password/?$", views.StaffUserResetPassword.as_view(),
            name="admin-user-reset"),
]
