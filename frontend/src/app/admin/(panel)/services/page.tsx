"use client";

import { useState } from "react";
import { refreshPublicSite } from "@/app/admin/actions";
import { ApiError, api, type AdminService } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { ConfirmButton, Drawer, Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pill, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { serviceTime } from "@/lib/format";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function ServicesPage() {
  const { can } = useAuth();
  const allowed = can("services.edit");
  const { data, error, loading, reload } = useApi<AdminService[]>(allowed ? "/admin/services" : null);
  const [editing, setEditing] = useState<AdminService | "new" | null>(null);
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Service times"
        description="The weekly schedule on the home page. Switch a service off to hide it without deleting it."
        actions={<button type="button" className="adm-btn adm-btn-gold" onClick={() => setEditing("new")}>Add service time</button>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.length === 0 ? (
        <Empty title="No service times yet">Add your weekly services so visitors know when to come.</Empty>
      ) : data ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Day</th><th>Time</th><th>Service</th><th>Order</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.map((s) => {
                const t = serviceTime(s.start_time);
                return (
                  <tr key={s.id} className="clickable" tabIndex={0} onClick={() => setEditing(s)}
                    onKeyDown={(k) => k.key === "Enter" && setEditing(s)}>
                    <td className="strong">{s.day_name}</td>
                    <td className="nowrap">{t.time} {t.meridiem}</td>
                    <td><span className="strong">{s.title}</span>{s.description && <span className="sub">{s.description}</span>}</td>
                    <td className="num">{s.order}</td>
                    <td>{s.is_active ? <Pill tone="ok">Shown</Pill> : <Pill tone="warn">Hidden</Pill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && (
        <ServiceEditor
          key={editing === "new" ? "new" : editing.id}
          service={editing === "new" ? null : editing}
          nextOrder={(data?.length ?? 0) + 1}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function ServiceEditor({ service, nextOrder, onClose, onSaved }: {
  service: AdminService | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    day: service?.day ?? 6,
    start_time: service?.start_time?.slice(0, 5) ?? "10:00",
    title: service?.title ?? "",
    description: service?.description ?? "",
    order: service?.order ?? nextOrder,
    is_active: service?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.title.trim()) {
      setErrors({ title: "Give the service a name." });
      return;
    }
    setBusy(true);
    try {
      if (service) await api(`/admin/services/${service.id}`, { method: "PATCH", json: form });
      else await api("/admin/services", { method: "POST", json: form });
      await refreshPublicSite(["services"]);
      toast("Service times updated on the website.");
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields);
      setFailure(e);
      setBusy(false);
    }
  }

  async function remove() {
    if (!service) return;
    try {
      await api(`/admin/services/${service.id}`, { method: "DELETE" });
      await refreshPublicSite(["services"]);
      toast("Service time deleted.");
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
    }
  }

  return (
    <Drawer
      open
      title={service ? "Edit service time" : "New service time"}
      onClose={onClose}
      footer={
        <>
          {service && <ConfirmButton label="Delete" confirmLabel="Yes, delete" danger onConfirm={remove} />}
          <div className="right">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      }
    >
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      <div className="adm-form">
        <Field label="Day" htmlFor="sv-day">
          <select id="sv-day" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="Starts at" htmlFor="sv-time" error={errors.start_time}>
          <input id="sv-time" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
        </Field>
        <Field label="Service name" htmlFor="sv-title" error={errors.title} full>
          <input id="sv-title" value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Short description" htmlFor="sv-desc" error={errors.description} full>
          <input id="sv-desc" value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Order on the page" htmlFor="sv-order" hint="Lower numbers show first.">
          <input id="sv-order" type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} />
        </Field>
        <label className="adm-switch field">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Show on the website
        </label>
      </div>
    </Drawer>
  );
}
