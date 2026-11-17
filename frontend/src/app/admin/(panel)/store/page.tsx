"use client";

import { useState } from "react";
import { refreshPublicSite } from "@/app/admin/actions";
import { ApiError, api, type AdminProduct, type StoreSettingsData } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { money } from "@/admin/format";
import { ConfirmButton, Drawer, Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pill, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";

const CATEGORIES = [
  { value: "books", label: "Books" },
  { value: "media", label: "Sermons & music" },
  { value: "clothing", label: "Clothing" },
  { value: "gifts", label: "Gifts" },
];

type Show = "all" | "shown" | "hidden" | "stock";

export default function StoreItemsPage() {
  const { can } = useAuth();
  const allowed = can("store.edit");
  const [show, setShow] = useState<Show>("all");
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const { data, error, loading, reload } = useApi<AdminProduct[]>(allowed ? "/admin/store/products" : null);
  const settings = useApi<StoreSettingsData>(allowed ? "/admin/store/settings" : null);
  if (!allowed) return <NoAccess />;

  const currency = settings.data?.currency ?? "USD";
  const shown = (data ?? []).filter((p) =>
    show === "shown" ? p.is_published
      : show === "hidden" ? !p.is_published
        : show === "stock" ? p.stock_state !== "in_stock"
          : true,
  );

  return (
    <>
      <PageHeader
        title="Store items"
        description="Books, sermons, clothing and gifts for sale on the website. Hidden items stay off the website until you show them."
        actions={<button type="button" className="adm-btn adm-btn-gold" onClick={() => setEditing("new")}>Add item</button>}
      />
      <div className="adm-tabs" role="group" aria-label="Show">
        {([["all", "All"], ["shown", "On the website"], ["hidden", "Hidden"], ["stock", "Low or sold out"]] as [Show, string][]).map(([key, label]) => (
          <button key={key} type="button" className="adm-tab" aria-pressed={show === key} onClick={() => setShow(key)}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && shown.length === 0 ? (
        <Empty title={data.length ? "Nothing here" : "No items yet"}>
          {data.length ? "Try another tab." : "Add the first item and it will appear in the store on the website."}
        </Empty>
      ) : data ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th aria-label="Picture" />
                <th>Item</th>
                <th className="num">Price</th>
                <th className="num">In stock</th>
                <th className="num">Sold</th>
                <th>On the website</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="clickable" tabIndex={0} onClick={() => setEditing(p)}
                  onKeyDown={(k) => k.key === "Enter" && setEditing(p)}>
                  <td className="adm-thumb-cell">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="adm-thumb" src={p.image_url} alt="" />
                    ) : <span className="adm-thumb adm-thumb-empty" />}
                  </td>
                  <td>
                    <span className="strong">{p.name}</span>
                    <span className="sub">{p.category_label}{p.options ? ` · ${p.option_name || "Options"}: ${p.options}` : ""}</span>
                  </td>
                  <td className="num strong">{money(p.price, currency)}</td>
                  <td className="num">
                    {p.stock === null ? <span className="sub">No limit</span>
                      : p.stock === 0 ? <Pill tone="bad">Sold out</Pill>
                        : p.stock_state === "low" ? <Pill tone="warn">{p.stock} left</Pill>
                          : p.stock}
                  </td>
                  <td className="num">{p.sold}</td>
                  <td>
                    <span className="adm-pills">
                      {p.is_published ? <Pill tone="ok">Shown</Pill> : <Pill tone="warn">Hidden</Pill>}
                      {p.is_featured && <Pill tone="violet">Featured</Pill>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {settings.error && <ErrorNote error={settings.error} onRetry={settings.reload} />}
      {settings.data && <DeliverySettings data={settings.data} reload={settings.reload} />}

      {editing && (
        <ProductEditor
          key={editing === "new" ? "new" : editing.id}
          product={editing === "new" ? null : editing}
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

function ProductEditor({ product, onClose, onSaved }: {
  product: AdminProduct | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: product?.name ?? "",
    category: product?.category ?? "books",
    price: product?.price ?? "",
    stock: product?.stock === null || product?.stock === undefined ? "" : String(product.stock),
    summary: product?.summary ?? "",
    description: product?.description ?? "",
    option_name: product?.option_name ?? "Size",
    options: product?.options ?? "",
    sort_order: String(product?.sort_order ?? 0),
    is_published: product?.is_published ?? true,
    is_featured: product?.is_featured ?? false,
  });
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function save() {
    const missing: Record<string, string> = {};
    if (!form.name.trim()) missing.name = "Give the item a name.";
    if (!(parseFloat(form.price) >= 0.5)) missing.price = "Enter a price of at least 0.50.";
    if (form.stock && !/^\d+$/.test(form.stock.trim())) missing.stock = "Enter a whole number, or leave it empty for no limit.";
    if (!form.summary.trim()) missing.summary = "Write one line for the store page.";
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    setFailure(null);
    const payload = {
      ...form,
      price: parseFloat(form.price).toFixed(2),
      stock: form.stock.trim() === "" ? null : Number(form.stock),
      sort_order: Number(form.sort_order) || 0,
    };
    try {
      const saved = product
        ? await api<AdminProduct>(`/admin/store/products/${product.id}`, { method: "PATCH", json: payload })
        : await api<AdminProduct>("/admin/store/products", { method: "POST", json: payload });
      if (image) {
        const fd = new FormData();
        fd.append("image", image);
        await api(`/admin/store/products/${saved.id}/image`, { method: "POST", form: fd });
      }
      await refreshPublicSite(["store"]);
      toast(product ? "Item saved. The store is up to date." : "Item added to the store.");
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields ?? {});
      setFailure(e);
      setBusy(false);
    }
  }

  async function remove() {
    if (!product) return;
    try {
      await api(`/admin/store/products/${product.id}`, { method: "DELETE" });
      await refreshPublicSite(["store"]);
      toast("Item deleted. Past orders keep its name and price.");
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
    }
  }

  async function removeImage() {
    if (!product) return;
    try {
      await api(`/admin/store/products/${product.id}/image`, { method: "DELETE" });
      setImageUrl(null);
      await refreshPublicSite(["store"]);
      toast("Picture removed.");
    } catch (err) {
      setFailure(err as ApiError);
    }
  }

  return (
    <Drawer
      open
      title={product ? "Edit item" : "New item"}
      onClose={onClose}
      footer={
        <>
          {product && <ConfirmButton label="Delete" confirmLabel="Yes, delete this item" danger onConfirm={remove} />}
          <div className="right">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="adm-btn adm-btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : product ? "Save changes" : "Add item"}
            </button>
          </div>
        </>
      }
    >
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      <div className="adm-form">
        <Field label="Name" htmlFor="pr-name" error={errors.name} full>
          <input id="pr-name" value={form.name} onChange={set("name")} maxLength={140} />
        </Field>
        <Field label="Type" htmlFor="pr-category">
          <select id="pr-category" value={form.category} onChange={set("category")}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Price" htmlFor="pr-price" error={errors.price}>
          <input id="pr-price" inputMode="decimal" placeholder="0.00" value={form.price} onChange={set("price")} />
        </Field>
        <Field label="How many in stock" htmlFor="pr-stock" error={errors.stock}
          hint="Goes down by itself when orders are paid. Leave empty for no limit.">
          <input id="pr-stock" inputMode="numeric" placeholder="No limit" value={form.stock} onChange={set("stock")} />
        </Field>
        <Field label="Order in the store" htmlFor="pr-order" hint="Lower numbers show first.">
          <input id="pr-order" type="number" min={0} value={form.sort_order} onChange={set("sort_order")} />
        </Field>
        <Field label="One-line summary" htmlFor="pr-summary" error={errors.summary}
          hint={`${form.summary.length}/200 · shown on the store page`} full>
          <textarea id="pr-summary" value={form.summary} onChange={set("summary")} maxLength={200} style={{ minHeight: 70 }} />
        </Field>
        <Field label="Full description" htmlFor="pr-description" hint="Leave a blank line between paragraphs." full>
          <textarea id="pr-description" value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Buyers choose a…" htmlFor="pr-option-name" error={errors.option_name} hint="e.g. Size or Colour">
          <input id="pr-option-name" value={form.option_name} onChange={set("option_name")} maxLength={30} />
        </Field>
        <Field label="Choices" htmlFor="pr-options" error={errors.options}
          hint="Separated by commas, e.g. S, M, L, XL. Leave empty if there's nothing to choose.">
          <input id="pr-options" value={form.options} onChange={set("options")} maxLength={200} />
        </Field>
        <label className="adm-switch field">
          <input type="checkbox" checked={form.is_published} onChange={set("is_published")} /> Show in the store
        </label>
        <label className="adm-switch field">
          <input type="checkbox" checked={form.is_featured} onChange={set("is_featured")} /> Show first (featured)
        </label>
        <Field label="Picture" htmlFor="pr-image" error={errors.image} hint="A square picture looks best. JPG, PNG or WebP, up to 5 MB." full>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Current picture" style={{ maxHeight: 160, borderRadius: 10, width: "auto" }} />
          )}
          <input id="pr-image" type="file" accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          {imageUrl && product && (
            <span><button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={removeImage}>Remove picture</button></span>
          )}
        </Field>
      </div>
    </Drawer>
  );
}

function DeliverySettings({ data, reload }: { data: StoreSettingsData; reload: () => void }) {
  const toast = useToast();
  return <DeliveryForm key={JSON.stringify(data)} data={data} onSaved={() => { toast("Delivery settings saved."); reload(); }} />;
}

function DeliveryForm({ data, onSaved }: { data: StoreSettingsData; onSaved: () => void }) {
  const [form, setForm] = useState(data);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(form) !== JSON.stringify(data);

  async function save() {
    setBusy(true);
    setFailure(null);
    setErrors({});
    try {
      await api("/admin/store/settings", { method: "PATCH", json: form });
      await refreshPublicSite(["settings", "store"]);
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields);
      setFailure(e);
      setBusy(false);
    }
  }

  return (
    <section className="adm-card" aria-labelledby="h-delivery" style={{ marginTop: 24 }}>
      <div className="adm-card-head">
        <h2 id="h-delivery">Collection and delivery</h2>
        <span className="adm-card-note">Shown on item pages and at checkout. Collection at church is always free.</span>
      </div>
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      <div className="adm-form">
        <label className="adm-switch field full">
          <input type="checkbox" checked={form.store_delivery_enabled}
            onChange={(e) => setForm({ ...form, store_delivery_enabled: e.target.checked })} /> Offer delivery
        </label>
        <Field label={`Delivery fee (${data.currency})`} htmlFor="dl-fee" error={errors.store_delivery_fee}>
          <input id="dl-fee" inputMode="decimal" value={form.store_delivery_fee} disabled={!form.store_delivery_enabled}
            onChange={(e) => setForm({ ...form, store_delivery_fee: e.target.value })} />
        </Field>
        <Field label="About delivery" htmlFor="dl-note" error={errors.store_delivery_note} hint="e.g. where you deliver and how long it takes">
          <input id="dl-note" value={form.store_delivery_note} maxLength={200} disabled={!form.store_delivery_enabled}
            onChange={(e) => setForm({ ...form, store_delivery_note: e.target.value })} />
        </Field>
        <Field label="About collection" htmlFor="dl-collect" error={errors.store_collect_note} hint="Where and when buyers collect" full>
          <input id="dl-collect" value={form.store_collect_note} maxLength={200}
            onChange={(e) => setForm({ ...form, store_collect_note: e.target.value })} />
        </Field>
      </div>
      <div className="adm-actions" style={{ marginTop: 18 }}>
        <button type="button" className="adm-btn adm-btn-primary" disabled={busy || !changed} onClick={save}>
          {busy ? "Saving…" : changed ? "Save" : "No changes"}
        </button>
      </div>
    </section>
  );
}
