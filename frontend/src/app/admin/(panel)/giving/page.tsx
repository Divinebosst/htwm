"use client";

import { useState } from "react";
import { refreshPublicSite } from "@/app/admin/actions";
import { ApiError, api, type AdminCategory } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { Drawer, ErrorNote, Field, Loading, NoAccess, PageHeader, Pill, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";

export default function GivingCategoriesPage() {
  const { can } = useAuth();
  const allowed = can("giving.edit");
  const { data, error, loading, reload } = useApi<AdminCategory[]>(allowed ? "/admin/giving-categories" : null);
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  if (!allowed) return <NoAccess />;

  return (
    <>
      <PageHeader
        title="Giving categories"
        description="The choices in step 1 of the giving page. Switch one off to hide it. Categories are never deleted, so past gift records stay complete."
        actions={<button type="button" className="adm-btn adm-btn-gold" onClick={() => setEditing("new")}>Add category</button>}
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : data ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Category</th><th>Reference starts with</th><th>Link</th><th className="num">Gifts</th><th className="num">Order</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="clickable" tabIndex={0} onClick={() => setEditing(c)}
                  onKeyDown={(k) => k.key === "Enter" && setEditing(c)}>
                  <td><span className="strong">{c.label}</span><span className="sub">{c.description}</span></td>
                  <td className="mono">{c.reference_code}-…</td>
                  <td className="mono">/give?type={c.key}</td>
                  <td className="num">{c.gift_count}</td>
                  <td className="num">{c.order}</td>
                  <td>{c.is_active ? <Pill tone="ok">Shown</Pill> : <Pill tone="warn">Hidden</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && (
        <CategoryEditor key={editing === "new" ? "new" : editing.id} category={editing === "new" ? null : editing}
          nextOrder={(data?.length ?? 0)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}

function CategoryEditor({ category, nextOrder, onClose, onSaved }: {
  category: AdminCategory | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    label: category?.label ?? "",
    description: category?.description ?? "",
    key: category?.key ?? "",
    reference_code: category?.reference_code ?? "",
    asks_purpose: category?.asks_purpose ?? false,
    order: category?.order ?? nextOrder,
    is_active: category?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const fromLabel = (label: string) => ({
    key: category ? form.key : label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30),
    reference_code: category ? form.reference_code : label.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10),
  });

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      if (category) await api(`/admin/giving-categories/${category.id}`, { method: "PATCH", json: form });
      else await api("/admin/giving-categories", { method: "POST", json: form });
      await refreshPublicSite(["giving"]);
      toast("Giving page updated.");
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields);
      setFailure(e);
      setBusy(false);
    }
  }

  return (
    <Drawer open title={category ? "Edit category" : "New category"} onClose={onClose}
      footer={
        <div className="right">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      }>
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      {category && category.gift_count > 0 && (
        <div className="adm-notice"><p>{category.gift_count} gifts use this category. Changing the reference code only affects new gifts.</p></div>
      )}
      <div className="adm-form">
        <Field label="Name" htmlFor="gc-label" error={errors.label} full>
          <input id="gc-label" value={form.label} maxLength={60}
            onChange={(e) => setForm({ ...form, label: e.target.value, ...fromLabel(e.target.value) })} />
        </Field>
        <Field label="Short description" htmlFor="gc-desc" error={errors.description} full>
          <input id="gc-desc" value={form.description} maxLength={120} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Reference code" htmlFor="gc-code" error={errors.reference_code} hint={`Payments show as ${form.reference_code || "CODE"}-MOYO`}>
          <input id="gc-code" className="mono" value={form.reference_code} maxLength={10}
            onChange={(e) => setForm({ ...form, reference_code: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
        </Field>
        <Field label="Link name" htmlFor="gc-key" error={errors.key} hint={`/give?type=${form.key || "…"}`}>
          <input id="gc-key" className="mono" value={form.key} maxLength={30}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
        </Field>
        <Field label="Order" htmlFor="gc-order">
          <input id="gc-order" type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} />
        </Field>
        <div className="field" />
        <label className="adm-switch field">
          <input type="checkbox" checked={form.asks_purpose} onChange={(e) => setForm({ ...form, asks_purpose: e.target.checked })} />
          Ask what the gift is for
        </label>
        <label className="adm-switch field">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Show on the giving page
        </label>
      </div>
    </Drawer>
  );
}
