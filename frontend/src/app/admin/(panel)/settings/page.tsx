"use client";

import { Fragment, useState } from "react";
import { refreshPublicSite } from "@/app/admin/actions";
import { ApiError, api } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { ErrorNote, Field, Loading, NoAccess, PageHeader, Pill, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { LockIcon } from "@/components/icons";

type Values = Record<string, string>;
type SettingsData = {
  values: Values;
  contact_fields: string[];
  payment_fields: string[];
  can_edit_contact: boolean;
  can_edit_payment: boolean;
  online_payments: { paypal: boolean; paypal_mode: string; mobile_money: boolean };
};

const LABELS: Record<string, { label: string; hint?: string; multiline?: boolean }> = {
  church_name: { label: "Church name" },
  short_name: { label: "Short name", hint: "Used in WhatsApp messages." },
  phone_primary: { label: "Main phone number" },
  phone_secondary: { label: "Second phone number" },
  whatsapp_number: { label: "WhatsApp number", hint: "Digits only with country code, e.g. 263775856800." },
  email: { label: "Email address" },
  facebook_url: { label: "Facebook page link" },
  youtube_url: { label: "YouTube link" },
  website_url: { label: "Website address" },
  currency: { label: "Giving currency", hint: "Three-letter code, e.g. USD. Must be a currency your PayPal and Paynow accounts accept." },
  preset_amounts: { label: "Quick-pick amounts", hint: "Separated by commas, e.g. 10,20,50,100" },
};

export default function SettingsPage() {
  const { can } = useAuth();
  const allowed = can("settings.view");
  const { data, error, loading, reload } = useApi<SettingsData>(allowed ? "/admin/settings" : null);
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader title="Church settings" description="Contact details, and how giving works on the website." />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <SettingsSection
            key={`contact-${JSON.stringify(data.values)}`}
            title="Contact and links"
            note="Shown in the header, footer and on WhatsApp buttons."
            fields={data.contact_fields}
            values={data.values}
            canEdit={data.can_edit_contact}
            onSaved={reload}
          />
          <OnlinePayments status={data.online_payments} />
          <SettingsSection
            key={`payment-${JSON.stringify(data.values)}`}
            title="Giving"
            note="The currency and quick-pick amounts on the giving page. Every change is recorded in the audit log."
            fields={data.payment_fields}
            values={data.values}
            canEdit={data.can_edit_payment}
            lockedMessage="Only a System Admin can change the giving currency and amounts."
            onSaved={reload}
          />
        </>
      )}
    </>
  );
}

function OnlinePayments({ status }: { status: SettingsData["online_payments"] }) {
  const rows = [
    {
      name: "PayPal and cards",
      on: status.paypal,
      detail: status.paypal ? (status.paypal_mode === "live" ? "Live: real payments" : "Sandbox: test payments only") : "Not connected",
    },
    { name: "Mobile money (Paynow)", on: status.mobile_money, detail: status.mobile_money ? "EcoCash, InnBucks, O'mari and OneMoney" : "Not connected" },
  ];
  return (
    <section className="adm-card" aria-labelledby="h-online-payments">
      <div className="adm-card-head">
        <h2 id="h-online-payments">Online payments</h2>
        <span className="adm-card-note">
          Gifts are confirmed automatically. The payment accounts are connected on the server by whoever looks after the
          website.
        </span>
      </div>
      <dl className="adm-dl">
        {rows.map((r) => (
          <Fragment key={r.name}>
            <dt>{r.name}</dt>
            <dd><Pill tone={r.on ? "ok" : "warn"}>{r.on ? "Connected" : "Not connected"}</Pill> {r.on && r.detail}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

function SettingsSection({ title, note, fields, values, canEdit, lockedMessage, onSaved }: {
  title: string;
  note: string;
  fields: string[];
  values: Values;
  canEdit: boolean;
  lockedMessage?: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Values>(() => Object.fromEntries(fields.map((f) => [f, values[f] ?? ""])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = fields.filter((f) => (form[f] ?? "") !== (values[f] ?? ""));

  async function save() {
    setBusy(true);
    setFailure(null);
    setErrors({});
    try {
      await api("/admin/settings", { method: "PATCH", json: Object.fromEntries(changed.map((f) => [f, form[f]])) });
      await refreshPublicSite(["settings"]);
      toast(`${title} saved. The website is up to date.`);
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields);
      setFailure(e);
      setBusy(false);
    }
  }

  return (
    <section className={`adm-card${canEdit ? "" : " adm-readonly"}`} aria-labelledby={`h-${title}`}>
      <div className="adm-card-head">
        <h2 id={`h-${title}`}>{title}</h2>
        <span className="adm-card-note">{note}</span>
      </div>
      {!canEdit && lockedMessage && (
        <div className="adm-notice warn" style={{ marginBottom: 16 }}>
          <LockIcon />
          <p>{lockedMessage}</p>
        </div>
      )}
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      <div className="adm-form">
        {fields.map((f) => {
          const meta = LABELS[f] ?? { label: f };
          return (
            <Field key={f} label={meta.label} htmlFor={`st-${f}`} hint={meta.hint} error={errors[f]} full={meta.multiline}>
              {meta.multiline ? (
                <textarea id={`st-${f}`} value={form[f]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
              ) : (
                <input id={`st-${f}`} value={form[f]} disabled={!canEdit} onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  placeholder={canEdit ? "" : "Not set"} />
              )}
            </Field>
          );
        })}
      </div>
      {canEdit && (
        <div className="adm-actions" style={{ marginTop: 18 }}>
          <button type="button" className="adm-btn adm-btn-primary" disabled={busy || changed.length === 0} onClick={save}>
            {busy ? "Saving…" : changed.length ? `Save ${changed.length} ${changed.length === 1 ? "change" : "changes"}` : "No changes"}
          </button>
          {changed.length > 0 && (
            <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setForm(Object.fromEntries(fields.map((f) => [f, values[f] ?? ""])))}>
              Undo changes
            </button>
          )}
        </div>
      )}
    </section>
  );
}
