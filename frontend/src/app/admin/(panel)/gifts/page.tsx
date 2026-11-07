"use client";

import { useState } from "react";
import { ApiError, api, type AdminGift, type Option, type Paged } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateTime, money } from "@/admin/format";
import { Drawer, Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pager, Pill, type Tone, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";

type GiftList = Paged<AdminGift> & {
  totals: Record<string, Record<string, { total: string; count: number }>>;
  statuses: Option[];
  methods: Option[];
  categories: Option[];
};

const STATUS_TONE: Record<string, Tone> = { pending: "warn", received: "ok", failed: "muted", not_found: "bad" };

function sumLine(byCurrency: Record<string, { total: string; count: number }> | undefined) {
  if (!byCurrency || !Object.keys(byCurrency).length) return { text: money(0, "USD"), count: 0 };
  const parts = Object.entries(byCurrency);
  return {
    text: parts.map(([cur, v]) => money(v.total, cur)).join(" + "),
    count: parts.reduce((n, [, v]) => n + v.count, 0),
  };
}

export default function GiftsPage() {
  const { can, me } = useAuth();
  const allowed = can("gifts.view");
  const canEdit = can("gifts.edit");
  const toast = useToast();
  const [filters, setFilters] = useState({ status: "", method: "", category: "", q: "", date_from: "", date_to: "" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [open, setOpen] = useState<AdminGift | null>(null);
  const [bulkError, setBulkError] = useState<ApiError | null>(null);

  const query = new URLSearchParams({ page: String(page) });
  Object.entries(filters).forEach(([k, v]) => v.trim() && query.set(k, v.trim()));
  const { data, error, loading, reload } = useApi<GiftList>(allowed ? `/admin/gifts?${query}` : null);
  if (!allowed) return <NoAccess />;

  const setFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
    setSelected([]);
  };

  const pending = sumLine(data?.totals.pending);
  const received = sumLine(data?.totals.received);
  const visibleIds = data?.results.map((g) => g.id) ?? [];
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  async function bulk(status: string) {
    setBulkError(null);
    try {
      const res = await api<{ changed: number }>("/admin/gifts/bulk", { method: "POST", json: { ids: selected, status } });
      toast(`${res.changed} ${res.changed === 1 ? "gift" : "gifts"} marked as ${status === "received" ? "received" : "not found"}.`);
      setSelected([]);
      reload();
    } catch (err) {
      setBulkError(err as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        title="Gifts"
        description={
          canEdit
            ? "Gifts made on the giving page. PayPal and mobile money gifts are marked as received automatically when the money arrives."
            : "Gifts made on the giving page. They're marked as received automatically when the money arrives."
        }
      />
      <div className="adm-totals">
        <div className="adm-total"><span>Waiting for payment ({pending.count})</span><strong>{pending.text}</strong></div>
        <div className="adm-total"><span>Received ({received.count})</span><strong>{received.text}</strong></div>
      </div>
      <div className="adm-filters">
        <Field label="Status" htmlFor="gf-status">
          <select id="gf-status" value={filters.status} onChange={setFilter("status")}>
            <option value="">All</option>
            {data?.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Paid by" htmlFor="gf-method">
          <select id="gf-method" value={filters.method} onChange={setFilter("method")}>
            <option value="">Any method</option>
            {data?.methods.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Type" htmlFor="gf-category">
          <select id="gf-category" value={filters.category} onChange={setFilter("category")}>
            <option value="">Any type</option>
            {data?.categories.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="gf-from">
          <input id="gf-from" type="date" value={filters.date_from} onChange={setFilter("date_from")} />
        </Field>
        <Field label="To" htmlFor="gf-to">
          <input id="gf-to" type="date" value={filters.date_to} onChange={setFilter("date_to")} />
        </Field>
        <div className="field grow">
          <label htmlFor="gf-q">Search</label>
          <input id="gf-q" type="search" placeholder="Reference, name or phone" value={filters.q} onChange={setFilter("q")} />
        </div>
      </div>

      {canEdit && selected.length > 0 && (
        <div className="adm-bulk">
          <span>{selected.length} selected</span>
          <button type="button" className="adm-btn adm-btn-primary adm-btn-sm" onClick={() => bulk("received")}>Mark as received</button>
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => bulk("not_found")}>Mark as not found</button>
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}
      {bulkError && <ErrorNote error={bulkError} />}
      {error && <ErrorNote error={error} onRetry={reload} />}

      {loading && !data ? (
        <Loading />
      ) : data && data.results.length === 0 ? (
        <Empty title={filters.status === "pending" ? "Nothing waiting" : "No gifts found"}>
          {filters.status === "pending" ? "No payments are waiting to go through." : "Try a different filter."}
        </Empty>
      ) : data ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  {canEdit && (
                    <th className="check-col">
                      <input type="checkbox" aria-label="Select all on this page" checked={allChecked}
                        onChange={() => setSelected(allChecked ? [] : visibleIds)} />
                    </th>
                  )}
                  <th>Date</th><th>Reference</th><th>Giver</th><th>Type</th><th>Paid by</th><th className="num">Amount</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((g) => (
                  <tr key={g.id} className={`clickable${selected.includes(g.id) ? " selected" : ""}`} tabIndex={0}
                    onClick={() => setOpen(g)} onKeyDown={(k) => k.key === "Enter" && setOpen(g)}>
                    {canEdit && (
                      <td className="check-col" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select gift ${g.reference}`} checked={selected.includes(g.id)}
                          onChange={() => setSelected((s) => (s.includes(g.id) ? s.filter((x) => x !== g.id) : [...s, g.id]))} />
                      </td>
                    )}
                    <td className="nowrap">{dateTime(g.created_at, me?.time_zone)}</td>
                    <td className="mono">{g.reference}</td>
                    <td>{g.anonymous ? <em>Anonymous</em> : g.giver_name || "—"}</td>
                    <td>{g.category_label}{g.purpose && <span className="sub">{g.purpose}</span>}</td>
                    <td>{g.method_label}</td>
                    <td className="num strong">{money(g.amount, g.currency)}</td>
                    <td><Pill tone={STATUS_TONE[g.status] ?? "muted"}>{g.status_label}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} count={data.count} onPage={(p) => { setPage(p); setSelected([]); }} />
        </>
      ) : null}

      {open && (
        <GiftDetail key={open.id} gift={open} statuses={data?.statuses ?? []} canEdit={canEdit}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />
      )}
    </>
  );
}

function GiftDetail({ gift, statuses, canEdit, onClose, onSaved }: {
  gift: AdminGift;
  statuses: Option[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(gift.status);
  const [notes, setNotes] = useState(gift.staff_notes);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/gifts/${gift.id}`, { method: "PATCH", json: { status, staff_notes: notes } });
      toast("Gift updated.");
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <Drawer open title={`Gift ${gift.reference}`} onClose={onClose}
      footer={
        <div className="right">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
          {canEdit && <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>}
        </div>
      }>
      {failure && <ErrorNote error={failure} />}
      <dl className="adm-dl">
        <dt>Amount</dt><dd>{money(gift.amount, gift.currency)}</dd>
        <dt>Type</dt><dd>{gift.category_label}{gift.purpose ? `: ${gift.purpose}` : ""}</dd>
        <dt>Paid by</dt><dd>{gift.method_label}</dd>
        {gift.payer_phone && <><dt>Wallet number</dt><dd>{gift.payer_phone}</dd></>}
        <dt>Reference</dt><dd className="mono">{gift.reference}</dd>
        {gift.provider_reference && (
          <><dt>{gift.method === "paypal" ? "PayPal transaction" : "Paynow reference"}</dt><dd className="mono">{gift.provider_reference}</dd></>
        )}
        {gift.provider_status && <><dt>Payment status</dt><dd>{gift.provider_status}</dd></>}
        <dt>Giver</dt><dd>{gift.anonymous ? "Anonymous" : gift.giver_name || "Not given"}</dd>
        <dt>Contact</dt><dd>{gift.giver_contact || "Not given"}</dd>
        <dt>Recorded</dt><dd>{dateTime(gift.created_at, me?.time_zone)} (website gift #{gift.id})</dd>
        {gift.confirmed_at && <><dt>Confirmed</dt><dd>{dateTime(gift.confirmed_at, me?.time_zone)}</dd></>}
      </dl>
      <div className="adm-form">
        <Field label="Status" htmlFor="gd-status">
          <select id="gd-status" value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" htmlFor="gd-notes" full hint={canEdit ? "Anything the office should know about this gift." : "Only Admins can change gifts."}>
          <textarea id="gd-notes" value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
