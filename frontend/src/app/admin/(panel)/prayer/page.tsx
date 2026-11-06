"use client";

import { useState } from "react";
import { ApiError, api, type AdminPrayer, type Option, type Paged } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateTime } from "@/admin/format";
import { Drawer, Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pager, Pill, type Tone, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { telHref } from "@/lib/format";

type PrayerList = Paged<AdminPrayer> & {
  status_counts: Record<string, number>;
  statuses: Option[];
  kinds: Option[];
  can_see_private: boolean;
};

const STATUS_TONE: Record<string, Tone> = { new: "info", prayed: "ok", followed_up: "muted" };

export default function PrayerPage() {
  const { can, me } = useAuth();
  const allowed = can("prayer.view");
  const [status, setStatus] = useState("new");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminPrayer | null>(null);

  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set("status", status);
  if (kind) query.set("kind", kind);
  if (q.trim()) query.set("q", q.trim());
  const { data, error, loading, reload } = useApi<PrayerList>(allowed ? `/admin/prayer-requests?${query}` : null);
  if (!allowed) return <NoAccess />;

  const total = data ? Object.values(data.status_counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <PageHeader
        title="Prayer requests"
        description={
          data && !data.can_see_private
            ? "Requests sent from the website. Private requests are only shown to Pastors and System Admins."
            : "Requests and testimonies sent from the website, including private ones."
        }
      />
      <div className="adm-tabs" role="group" aria-label="Status">
        {[...(data?.statuses ?? [{ value: "new", label: "New" }]), { value: "", label: "All" }].map((s) => (
          <button key={s.value || "all"} type="button" className="adm-tab" aria-pressed={status === s.value}
            onClick={() => { setStatus(s.value); setPage(1); }}>
            {s.label}
            {data && <span className="n">{s.value ? data.status_counts[s.value] ?? 0 : total}</span>}
          </button>
        ))}
      </div>
      <div className="adm-filters">
        <Field label="Type" htmlFor="pr-kind">
          <select id="pr-kind" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {data?.kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <div className="field grow">
          <label htmlFor="pr-q">Search</label>
          <input id="pr-q" type="search" placeholder="Name, phone or words in the message" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
      </div>
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.results.length === 0 ? (
        <Empty title={status === "new" ? "No new requests" : "Nothing found"}>
          {status === "new" ? "Every request has been prayed for." : "Try a different filter."}
        </Empty>
      ) : data ? (
        <>
          <div className="adm-requests">
            {data.results.map((p) => (
              <button key={p.id} type="button" className="adm-request" onClick={() => setOpen(p)}>
                <span className="top">
                  <span className="who">{p.name || "No name given"}</span>
                  <span className="adm-pills">
                    <Pill tone="muted">{p.kind_label}</Pill>
                    {p.is_private && <Pill tone="violet">Private</Pill>}
                    <Pill tone={STATUS_TONE[p.status] ?? "muted"}>{p.status_label}</Pill>
                  </span>
                </span>
                <span className="msg">{p.message}</span>
                <span className="when">{dateTime(p.created_at, me?.time_zone)}</span>
              </button>
            ))}
          </div>
          <Pager page={data.page} pages={data.pages} count={data.count} onPage={setPage} />
        </>
      ) : null}

      {open && (
        <PrayerDetail
          key={open.id}
          prayer={open}
          statuses={data?.statuses ?? []}
          canEdit={can("prayer.edit")}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); reload(); }}
        />
      )}
    </>
  );
}

function PrayerDetail({ prayer, statuses, canEdit, onClose, onSaved }: {
  prayer: AdminPrayer;
  statuses: Option[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(prayer.status);
  const [notes, setNotes] = useState(prayer.staff_notes);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/prayer-requests/${prayer.id}`, { method: "PATCH", json: { status, staff_notes: notes } });
      toast("Prayer request updated.");
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
      setBusy(false);
    }
  }

  const phone = /^[+\d\s()-]{7,}$/.test(prayer.contact) ? prayer.contact : "";
  return (
    <Drawer
      open
      title={prayer.kind_label}
      onClose={onClose}
      footer={
        <div className="right">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
          {canEdit && (
            <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      }
    >
      {failure && <ErrorNote error={failure} />}
      <div className="adm-pills">
        {prayer.is_private && <Pill tone="violet">Private: pastors and prayer team only</Pill>}
      </div>
      <dl className="adm-dl">
        <dt>From</dt><dd>{prayer.name || "No name given"}</dd>
        <dt>Contact</dt>
        <dd>{prayer.contact ? (phone ? <a href={telHref(phone)}>{prayer.contact}</a> : prayer.contact) : "Not given"}</dd>
        <dt>Received</dt><dd>{dateTime(prayer.created_at, me?.time_zone)}</dd>
      </dl>
      <div className="adm-message">{prayer.message}</div>
      <div className="adm-form">
        <Field label="Status" htmlFor="pd-status">
          <select id="pd-status" value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Notes for the prayer team" htmlFor="pd-notes" full
          hint={canEdit ? "Only staff can see these notes." : "Only Pastors can update prayer requests."}>
          <textarea id="pd-notes" value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
