"use client";

import { useState } from "react";
import { ApiError, api, type AdminOrder, type Option, type Paged } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateTime, money } from "@/admin/format";
import { Drawer, Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pager, Pill, type Tone, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { whatsappUrl } from "@/lib/format";

type OrderList = Paged<AdminOrder> & {
  totals: Record<string, Record<string, { total: string; count: number }>>;
  statuses: Option[];
  fulfilment: Option[];
};

const STATUS_TONE: Record<string, Tone> = {
  pending: "muted",
  paid: "warn",
  ready: "info",
  completed: "ok",
  failed: "muted",
  cancelled: "bad",
};

function sumLine(byCurrency: Record<string, { total: string; count: number }> | undefined) {
  if (!byCurrency || !Object.keys(byCurrency).length) return { text: money(0, "USD"), count: 0 };
  const parts = Object.entries(byCurrency);
  return {
    text: parts.map(([cur, v]) => money(v.total, cur)).join(" + "),
    count: parts.reduce((n, [, v]) => n + v.count, 0),
  };
}

export default function OrdersPage() {
  const { can, me } = useAuth();
  const allowed = can("orders.view");
  const canEdit = can("orders.edit");
  const [filters, setFilters] = useState({ status: "open", fulfilment: "", q: "", date_from: "", date_to: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminOrder | null>(null);

  const query = new URLSearchParams({ page: String(page) });
  Object.entries(filters).forEach(([k, v]) => v.trim() && query.set(k, v.trim()));
  const { data, error, loading, reload } = useApi<OrderList>(allowed ? `/admin/store/orders?${query}` : null);
  if (!allowed) return <NoAccess />;

  const setFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const toPrepare = sumLine(data?.totals.paid);
  const ready = sumLine(data?.totals.ready);

  return (
    <>
      <PageHeader
        title="Store orders"
        description="Orders are marked as paid automatically when the money arrives. Prepare them, then mark them ready, and completed once handed over or delivered."
      />
      <div className="adm-totals">
        <div className="adm-total"><span>To prepare ({toPrepare.count})</span><strong>{toPrepare.text}</strong></div>
        <div className="adm-total"><span>Ready or on its way ({ready.count})</span><strong>{ready.text}</strong></div>
      </div>
      <div className="adm-filters">
        <Field label="Show" htmlFor="or-status">
          <select id="or-status" value={filters.status} onChange={setFilter("status")}>
            <option value="open">Needs action (paid or ready)</option>
            <option value="">All orders</option>
            {data?.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Collection or delivery" htmlFor="or-fulfil">
          <select id="or-fulfil" value={filters.fulfilment} onChange={setFilter("fulfilment")}>
            <option value="">Both</option>
            {data?.fulfilment.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="or-from">
          <input id="or-from" type="date" value={filters.date_from} onChange={setFilter("date_from")} />
        </Field>
        <Field label="To" htmlFor="or-to">
          <input id="or-to" type="date" value={filters.date_to} onChange={setFilter("date_to")} />
        </Field>
        <div className="field grow">
          <label htmlFor="or-q">Search</label>
          <input id="or-q" type="search" placeholder="Order number, name or phone" value={filters.q} onChange={setFilter("q")} />
        </div>
      </div>

      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.results.length === 0 ? (
        <Empty title={filters.status === "open" ? "Nothing to prepare" : "No orders found"}>
          {filters.status === "open" ? "Every paid order has been handed over or delivered." : "Try a different filter."}
        </Empty>
      ) : data ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr><th>Order</th><th>Date</th><th>Buyer</th><th>Items</th><th>How</th><th className="num">Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.results.map((o) => (
                  <tr key={o.id} className="clickable" tabIndex={0} onClick={() => setOpen(o)}
                    onKeyDown={(k) => k.key === "Enter" && setOpen(o)}>
                    <td className="strong">#{o.id}</td>
                    <td className="nowrap">{dateTime(o.created_at, me?.time_zone)}</td>
                    <td>{o.customer_name}<span className="sub">{o.contact_phone}</span></td>
                    <td>
                      {o.item_count} {o.item_count === 1 ? "item" : "items"}
                      <span className="sub">{o.items.map((i) => i.name).join(", ")}</span>
                    </td>
                    <td>{o.fulfilment === "delivery" ? "Delivery" : "Collect"}</td>
                    <td className="num strong">{money(o.total, o.currency)}</td>
                    <td><Pill tone={STATUS_TONE[o.status] ?? "muted"}>{o.status_label}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} count={data.count} onPage={setPage} />
        </>
      ) : null}

      {open && (
        <OrderDetail key={open.id} order={open} canEdit={canEdit} statuses={data?.statuses ?? []}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />
      )}
    </>
  );
}

/** 0771 234 567 -> 263771234567 for WhatsApp links; other numbers as typed. */
function internationalNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("0") && digits.length === 10 ? `263${digits.slice(1)}` : digits;
}

function OrderDetail({ order, canEdit, statuses, onClose, onSaved }: {
  order: AdminOrder;
  canEdit: boolean;
  statuses: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(order.status);
  const [notes, setNotes] = useState(order.staff_notes);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const paid = !!order.paid_at;
  // Staff can move a paid order along, or cancel any order. Paid / unpaid is set by the payment itself.
  const allowed = new Set(paid ? ["paid", "ready", "completed", "cancelled", order.status] : ["cancelled", order.status]);
  const choices = statuses.filter((s) => allowed.has(s.value));
  const cur = order.currency;
  const readyText = order.fulfilment === "delivery"
    ? `Hello ${order.customer_name.split(" ")[0]}, your Heal The World Ministries order #${order.id} is on its way to you.`
    : `Hello ${order.customer_name.split(" ")[0]}, your Heal The World Ministries order #${order.id} is ready to collect at the church office. Please bring your order number.`;

  async function save(nextStatus = status) {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/admin/store/orders/${order.id}`, { method: "PATCH", json: { status: nextStatus, staff_notes: notes } });
      toast(nextStatus === "cancelled" && order.status !== "cancelled"
        ? "Order cancelled. Its items are back in stock."
        : "Order updated.");
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
      setBusy(false);
    }
  }

  const next = order.status === "paid" ? { status: "ready", label: order.fulfilment === "delivery" ? "Mark as sent" : "Mark ready to collect" }
    : order.status === "ready" ? { status: "completed", label: order.fulfilment === "delivery" ? "Mark delivered" : "Mark collected" }
      : null;

  return (
    <Drawer open title={`Order #${order.id}`} onClose={onClose}
      footer={
        <div className="right">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
          {canEdit && <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => save()}>Save</button>}
          {canEdit && next && (
            <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={() => save(next.status)}>{next.label}</button>
          )}
        </div>
      }>
      {failure && <ErrorNote error={failure} />}
      <div className="adm-order-status">
        <Pill tone={STATUS_TONE[order.status] ?? "muted"}>{order.status_label}</Pill>
        <span>{order.fulfilment_label}</span>
      </div>
      <table className="adm-table adm-order-items">
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
        <tbody>
          {order.items.map((i, n) => (
            <tr key={n}>
              <td>{i.name}{i.option && <span className="sub">{i.option}</span>}</td>
              <td className="num">{i.quantity}</td>
              <td className="num">{money(i.unit_price, cur)}</td>
              <td className="num">{money(i.line_total, cur)}</td>
            </tr>
          ))}
          {parseFloat(order.delivery_fee) > 0 && (
            <tr><td colSpan={3}>Delivery</td><td className="num">{money(order.delivery_fee, cur)}</td></tr>
          )}
          <tr className="adm-order-total"><td colSpan={3}>Total</td><td className="num">{money(order.total, cur)}</td></tr>
        </tbody>
      </table>
      <dl className="adm-dl">
        <dt>Buyer</dt><dd>{order.customer_name}</dd>
        <dt>Phone</dt>
        <dd>
          <a href={`tel:${order.contact_phone.replace(/[^\d+]/g, "")}`}>{order.contact_phone}</a>
          {" · "}
          <a href={whatsappUrl(internationalNumber(order.contact_phone), readyText)} target="_blank" rel="noopener">WhatsApp</a>
        </dd>
        {order.email && <><dt>Email</dt><dd><a href={`mailto:${order.email}`}>{order.email}</a></dd></>}
        {order.address && <><dt>Deliver to</dt><dd style={{ whiteSpace: "pre-line" }}>{order.address}</dd></>}
        {order.notes && <><dt>Buyer&apos;s note</dt><dd style={{ whiteSpace: "pre-line" }}>{order.notes}</dd></>}
        <dt>Ordered</dt><dd>{dateTime(order.created_at, me?.time_zone)}</dd>
        <dt>Payment</dt>
        <dd>
          {order.payment_label}
          {order.paid_at ? ` · paid ${dateTime(order.paid_at, me?.time_zone)}` : " · not paid"}
          {order.payer_phone && ` · ${order.payer_phone}`}
        </dd>
        {order.provider_reference && (
          <><dt>{order.method === "paypal" ? "PayPal transaction" : "Paynow reference"}</dt><dd className="mono">{order.provider_reference}</dd></>
        )}
      </dl>
      <div className="adm-form">
        <Field label="Status" htmlFor="od-status" hint={paid ? undefined : "This order hasn't been paid, so it can only be cancelled."}>
          <select id="od-status" value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)}>
            {choices.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" htmlFor="od-notes" full hint={canEdit ? "Only staff see these." : "Only Admins can update orders."}>
          <textarea id="od-notes" value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
