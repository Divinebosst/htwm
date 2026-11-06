"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, type Me } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { PERMISSION_LABELS, ROLE_SUMMARY } from "@/admin/labels";
import { ErrorNote, Field, PageHeader, useToast } from "@/admin/ui";
import { CheckIcon, LockIcon } from "@/components/icons";

export default function AccountPage() {
  const { me, setMe } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const mustChange = me.must_change_password;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    const missing: Record<string, string> = {};
    if (!form.current_password) missing.current_password = mustChange ? "Enter the temporary password you were given." : "Enter your current password.";
    if (form.new_password.length < 8) missing.new_password = "Use at least 8 characters.";
    if (form.new_password !== form.confirm) missing.confirm = "The two new passwords don't match.";
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      const updated = await api<Me>("/auth/password", {
        method: "POST",
        json: { current_password: form.current_password, new_password: form.new_password },
      });
      setMe(updated);
      setForm({ current_password: "", new_password: "", confirm: "" });
      toast("Password changed.");
      if (mustChange) router.replace("/admin");
    } catch (err) {
      const e2 = err as ApiError;
      setErrors(e2.fields);
      setFailure(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="My account" description={`Signed in as ${me.username}.`} />
      {mustChange && (
        <div className="adm-notice warn">
          <LockIcon />
          <p><strong>Choose your own password to continue.</strong> You signed in with a temporary password. Once you set a new one, the rest of the admin opens up.</p>
        </div>
      )}
      <div className="adm-grid-2">
        <section className="adm-card" aria-labelledby="pw-title">
          <div className="adm-card-head"><h2 id="pw-title">Change password</h2></div>
          {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
          <form className="adm-form" onSubmit={save} noValidate>
            <Field label={mustChange ? "Temporary password" : "Current password"} htmlFor="pw-current" error={errors.current_password} full>
              <input id="pw-current" type="password" autoComplete="current-password" value={form.current_password}
                onChange={(e) => setForm({ ...form, current_password: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="pw-new" error={errors.new_password} full
              hint="At least 8 characters. Avoid common words and anything only made of numbers.">
              <input id="pw-new" type="password" autoComplete="new-password" value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })} />
            </Field>
            <Field label="New password again" htmlFor="pw-confirm" error={errors.confirm} full>
              <input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </Field>
            <div className="field full">
              <button type="submit" className="adm-btn adm-btn-primary" disabled={busy} style={{ width: "fit-content" }}>
                {busy ? "Saving…" : "Change password"}
              </button>
            </div>
          </form>
        </section>

        <section className="adm-card" aria-labelledby="role-title">
          <div className="adm-card-head"><h2 id="role-title">Your role: {me.role_label}</h2></div>
          <p className="adm-card-note" style={{ marginBottom: 12 }}>{ROLE_SUMMARY[me.role]}</p>
          <ul className="adm-list">
            {me.permissions.map((p) => (
              <li key={p} style={{ justifyContent: "flex-start", alignItems: "center" }}>
                <CheckIcon style={{ width: 18, height: 18, color: "var(--adm-ok-fg)", flex: "none" }} />
                {PERMISSION_LABELS[p] ?? p}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
