"use client";

import { useState } from "react";
import { ApiError, api, type StaffUser } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateTime } from "@/admin/format";
import { PERMISSION_LABELS, ROLE_SUMMARY } from "@/admin/labels";
import { ConfirmButton, Drawer, ErrorNote, Field, Loading, NoAccess, PageHeader, Pill, SecretBox, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { CheckIcon } from "@/components/icons";

type RolesInfo = { roles: { value: string; label: string; permissions: string[] }[]; permissions: string[] };

export default function UsersPage() {
  const { can, me } = useAuth();
  const allowed = can("users.view");
  const canEdit = can("users.edit");
  const { data, error, loading, reload } = useApi<StaffUser[]>(allowed ? "/admin/users" : null);
  const roles = useApi<RolesInfo>(allowed ? "/auth/roles" : null);
  const [editing, setEditing] = useState<StaffUser | "new" | null>(null);
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description={
          me?.role === "system_admin"
            ? "Everyone who can sign in to the church admin. Accounts are switched off, never deleted, so the audit log stays complete."
            : "Everyone who can sign in. You can add and manage Pastor and Caretaker accounts."
        }
        actions={canEdit && <button type="button" className="adm-btn adm-btn-gold" onClick={() => setEditing("new")}>Add staff member</button>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="clickable" tabIndex={0} onClick={() => setEditing(u)}
                  onKeyDown={(k) => k.key === "Enter" && setEditing(u)}>
                  <td>
                    <span className="strong">{[u.first_name, u.last_name].filter(Boolean).join(" ") || u.username}</span>
                    <span className="sub">{u.username}{u.is_you ? " · you" : ""}</span>
                  </td>
                  <td><Pill tone={u.role === "system_admin" ? "warn" : u.role === "admin" ? "info" : u.role === "pastor" ? "violet" : "ok"}>{u.role_label}</Pill></td>
                  <td>
                    <span className="adm-pills">
                      {u.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="muted">Switched off</Pill>}
                      {u.is_active && u.must_change_password && <Pill tone="warn">Must set password</Pill>}
                    </span>
                  </td>
                  <td className="nowrap">{u.last_login ? dateTime(u.last_login, me?.time_zone) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {roles.data && (
        <section className="adm-card" aria-labelledby="roles-title">
          <div className="adm-card-head">
            <h2 id="roles-title">What each role can do</h2>
            <span className="adm-card-note">Checked on the server for every request, not just hidden on screen.</span>
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table adm-matrix">
              <thead>
                <tr>
                  <th>Permission</th>
                  {roles.data.roles.map((r) => <th key={r.value}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {roles.data.permissions.map((p) => (
                  <tr key={p}>
                    <td>{PERMISSION_LABELS[p] ?? p}</td>
                    {roles.data!.roles.map((r) => (
                      <td key={r.value}>
                        {r.permissions.includes(p) ? <CheckIcon aria-label="Yes" /> : <span className="no" aria-label="No">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <UserEditor key={editing === "new" ? "new" : editing.id} user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </>
  );
}

function UserEditor({ user, onClose, onSaved }: { user: StaffUser | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const roleOptions = me?.manageable_roles ?? [];
  const editable = user ? user.can_edit : true;
  const [form, setForm] = useState({
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    username: user?.username ?? "",
    email: user?.email ?? "",
    role: user?.role ?? roleOptions[roleOptions.length - 1]?.value ?? "caretaker",
    is_active: user?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);

  async function save() {
    setBusy(true);
    setFailure(null);
    setErrors({});
    try {
      if (user) {
        await api(`/admin/users/${user.id}`, { method: "PATCH", json: form });
        toast("Account updated.");
        onSaved();
        onClose();
      } else {
        const created = await api<StaffUser & { temporary_password: string }>("/admin/users", { method: "POST", json: form });
        setSecret({ username: created.username, password: created.temporary_password });
        onSaved();
      }
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields);
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!user) return;
    try {
      const res = await api<{ temporary_password: string }>(`/admin/users/${user.id}/reset-password`, { method: "POST" });
      setSecret({ username: user.username, password: res.temporary_password });
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
    }
  }

  if (secret) {
    return (
      <Drawer open title={user ? "Password reset" : "Account created"} onClose={onClose}
        footer={<div className="right"><button type="button" className="adm-btn adm-btn-primary" onClick={onClose}>Done</button></div>}>
        <p>Give these sign-in details to <strong>{secret.username}</strong> in person or by phone. They will choose their own password when they first sign in.</p>
        <SecretBox label="Temporary password (shown only once)" value={secret.password} />
        <dl className="adm-dl">
          <dt>Sign-in page</dt><dd>{typeof window !== "undefined" ? `${window.location.origin}/admin` : "/admin"}</dd>
          <dt>Username</dt><dd>{secret.username}</dd>
        </dl>
      </Drawer>
    );
  }

  const lockedReason = user && !user.can_edit
    ? user.is_you
      ? "This is your account. Change your password on the My account page; another System Admin can change your role."
      : "Only a System Admin can change Admin and System Admin accounts."
    : null;

  return (
    <Drawer open title={user ? "Staff account" : "Add staff member"} onClose={onClose}
      footer={
        <>
          {user && editable && (
            <ConfirmButton label="Reset password" confirmLabel="Yes, give a new temporary password" onConfirm={resetPassword} />
          )}
          <div className="right">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>{editable ? "Cancel" : "Close"}</button>
            {editable && (
              <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : user ? "Save" : "Create account"}
              </button>
            )}
          </div>
        </>
      }>
      {lockedReason && <div className="adm-notice"><p>{lockedReason}</p></div>}
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      <div className={`adm-form${editable ? "" : " adm-readonly"}`}>
        <Field label="First name" htmlFor="us-first" error={errors.first_name}>
          <input id="us-first" value={form.first_name} disabled={!editable} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name" htmlFor="us-last" error={errors.last_name}>
          <input id="us-last" value={form.last_name} disabled={!editable} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Username" htmlFor="us-username" error={errors.username} hint="Used to sign in. Letters, numbers and . _ - only.">
          <input id="us-username" value={form.username} disabled={!editable} autoCapitalize="none"
            onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} />
        </Field>
        <Field label="Email (optional)" htmlFor="us-email" error={errors.email}>
          <input id="us-email" type="email" value={form.email} disabled={!editable} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Role" htmlFor="us-role" error={errors.role} full hint={ROLE_SUMMARY[form.role]}>
          <select id="us-role" value={form.role} disabled={!editable} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {!roleOptions.some((r) => r.value === form.role) && <option value={form.role}>{user?.role_label}</option>}
            {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        {user && (
          <label className="adm-switch field full">
            <input type="checkbox" checked={form.is_active} disabled={!editable} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Can sign in (untick to switch the account off)
          </label>
        )}
      </div>
      {!user && <p className="adm-card-note">A temporary password is created for you to pass on. They must change it when they first sign in.</p>}
      {user && (
        <dl className="adm-dl">
          <dt>Last sign-in</dt><dd>{user.last_login ? dateTime(user.last_login, me?.time_zone) : "Never"}</dd>
          <dt>Added</dt><dd>{dateTime(user.date_joined, me?.time_zone)}</dd>
        </dl>
      )}
    </Drawer>
  );
}
