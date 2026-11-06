"use client";

import { Fragment, useState } from "react";
import type { AuditEntry, Option, Paged } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateTime } from "@/admin/format";
import { niceField } from "@/admin/labels";
import { Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pager, Pill } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { LockIcon } from "@/components/icons";
import { actionTone } from "./tones";

type AuditList = Paged<AuditEntry> & {
  filters: { actions: Option[]; object_types: string[]; actors: Option[] };
};

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return <em>empty</em>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function changeSummary(entry: AuditEntry) {
  const keys = Object.keys(entry.changes || {});
  if (!keys.length) return "";
  if (entry.action === "access_denied") return `Needed: ${String((entry.changes as Record<string, unknown>).needed ?? "")}`;
  const names = keys.slice(0, 3).map(niceField).join(", ");
  return keys.length > 3 ? `${names} +${keys.length - 3} more` : names;
}

export default function AuditPage() {
  const { can, me } = useAuth();
  const allowed = can("audit.view");
  const [filters, setFilters] = useState({ action: "", object_type: "", actor: "", q: "", date_from: "", date_to: "" });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const query = new URLSearchParams({ page: String(page) });
  Object.entries(filters).forEach(([k, v]) => v.trim() && query.set(k, v.trim()));
  const { data, error, loading, reload } = useApi<AuditList>(allowed ? `/admin/audit?${query}` : null);
  if (!allowed) return <NoAccess />;

  const setFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
    setExpanded(null);
  };
  const tz = me?.time_zone;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, failed sign-in and change to the church's data: who did it, when, and from where."
        actions={<button type="button" className="adm-btn adm-btn-ghost" onClick={reload}>Refresh</button>}
      />
      <div className="adm-notice">
        <LockIcon />
        <p>Entries can&apos;t be edited or deleted by anyone. Private details such as prayer request messages are never copied into the log.</p>
      </div>
      <div className="adm-filters">
        <Field label="What happened" htmlFor="au-action">
          <select id="au-action" value={filters.action} onChange={setFilter("action")}>
            <option value="">Anything</option>
            {data?.filters.actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="To what" htmlFor="au-type">
          <select id="au-type" value={filters.object_type} onChange={setFilter("object_type")}>
            <option value="">Anything</option>
            {data?.filters.object_types.map((t) => <option key={t} value={t}>{niceField(t)}</option>)}
          </select>
        </Field>
        <Field label="Who" htmlFor="au-actor">
          <select id="au-actor" value={filters.actor} onChange={setFilter("actor")}>
            <option value="">Anyone</option>
            {data?.filters.actors.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="au-from">
          <input id="au-from" type="date" value={filters.date_from} onChange={setFilter("date_from")} />
        </Field>
        <Field label="To" htmlFor="au-to">
          <input id="au-to" type="date" value={filters.date_to} onChange={setFilter("date_to")} />
        </Field>
        <div className="field grow">
          <label htmlFor="au-q">Search</label>
          <input id="au-q" type="search" placeholder="Name, item or IP address" value={filters.q} onChange={setFilter("q")} />
        </div>
      </div>
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.results.length === 0 ? (
        <Empty title="Nothing found">Try a wider date range or fewer filters.</Empty>
      ) : data ? (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr><th>When</th><th>Who</th><th>What happened</th><th>Item</th><th>Details</th><th>IP address</th></tr>
              </thead>
              <tbody>
                {data.results.map((a) => (
                  <Fragment key={a.id}>
                    <tr className={`clickable${expanded === a.id ? " selected" : ""}`} tabIndex={0}
                      aria-expanded={expanded === a.id}
                      onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                      onKeyDown={(k) => k.key === "Enter" && setExpanded(expanded === a.id ? null : a.id)}>
                      <td className="nowrap">{dateTime(a.created_at, tz)}</td>
                      <td>
                        <span className="strong">{a.actor_label}</span>
                        {a.actor_role && <span className="sub">{a.actor_role}</span>}
                      </td>
                      <td><Pill tone={actionTone(a.action)}>{a.action_label}</Pill></td>
                      <td>
                        <span className="strong">{a.object_repr || "—"}</span>
                        {a.object_type && <span className="sub">{niceField(a.object_type)}</span>}
                      </td>
                      <td>{changeSummary(a)}</td>
                      <td className="mono nowrap">{a.ip_address ?? "—"}</td>
                    </tr>
                    {expanded === a.id && (
                      <tr className="adm-detail-row">
                        <td colSpan={6}>
                          <div className="adm-detail">
                            {Object.keys(a.changes || {}).length > 0 && a.action !== "access_denied" ? (
                              <table className="adm-changes">
                                <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                                <tbody>
                                  {Object.entries(a.changes).map(([field, val]) => {
                                    const [before, after] = Array.isArray(val) ? val : [undefined, val];
                                    return (
                                      <tr key={field}>
                                        <td>{niceField(field)}</td>
                                        <td className="old">{show(before)}</td>
                                        <td className="new">{show(after)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : a.action === "access_denied" ? (
                              <p>Tried to open <span className="mono">{a.object_repr}</span> without permission ({String((a.changes as Record<string, unknown>).needed ?? "")}).</p>
                            ) : null}
                            <dl className="adm-dl">
                              <dt>Where</dt><dd>{a.source_label}</dd>
                              <dt>Device</dt><dd>{a.user_agent || "Unknown"}</dd>
                              <dt>Entry</dt><dd>#{a.id}</dd>
                            </dl>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} count={data.count} onPage={(p) => { setPage(p); setExpanded(null); }} />
        </>
      ) : null}
    </>
  );
}
