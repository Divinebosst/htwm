"use client";

import Link from "next/link";
import type { AuditEntry } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateOnly, dateTime, money } from "@/admin/format";
import { ErrorNote, Loading, PageHeader, Pill } from "@/admin/ui";
import { useApi } from "@/admin/useApi";
import { actionTone } from "./audit/tones";

type Dashboard = {
  events: {
    upcoming_count: number;
    unpublished_count: number;
    next: { id: number; title: string; starts_at: string; slug: string; is_published: boolean }[];
  };
  prayer?: { new_count: number; total_count: number };
  gifts?: {
    pending_count: number;
    pending_totals: Record<string, string>;
    received_this_month: Record<string, string>;
    received_this_month_count: number;
  };
  activity?: AuditEntry[];
  staff?: { active_count: number };
};

function totals(map: Record<string, string>) {
  const entries = Object.entries(map);
  return entries.length ? entries.map(([cur, amt]) => money(amt, cur)).join(" + ") : money(0, "USD");
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const { data, error, loading, reload } = useApi<Dashboard>("/admin/dashboard");
  const tz = me?.time_zone;

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.first_name || me?.username}`}
        description={`You're signed in as ${me?.role_label}. Here's what needs attention.`}
        actions={
          can("events.edit") && (
            <Link className="adm-btn adm-btn-gold" href="/admin/events?new=1">Add an event</Link>
          )
        }
      />
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="adm-stats">
            <Link className="adm-stat" href="/admin/events">
              <span>Upcoming events</span>
              <strong>{data.events.upcoming_count}</strong>
              <small>{data.events.unpublished_count ? `${data.events.unpublished_count} hidden from the website` : "All published"}</small>
            </Link>
            {data.prayer && (
              <Link className={`adm-stat${data.prayer.new_count ? " attention" : ""}`} href="/admin/prayer">
                <span>New prayer requests</span>
                <strong>{data.prayer.new_count}</strong>
                <small>{data.prayer.total_count} in total{can("prayer.view_private") ? "" : " (not counting private ones)"}</small>
              </Link>
            )}
            {data.gifts && (
              <>
                <Link className={`adm-stat${data.gifts.pending_count ? " attention" : ""}`} href="/admin/gifts">
                  <span>Gifts waiting for proof</span>
                  <strong>{data.gifts.pending_count}</strong>
                  <small>{totals(data.gifts.pending_totals)} to check</small>
                </Link>
                <Link className="adm-stat" href="/admin/gifts">
                  <span>Received this month</span>
                  <strong>{totals(data.gifts.received_this_month)}</strong>
                  <small>{data.gifts.received_this_month_count} gifts confirmed</small>
                </Link>
              </>
            )}
            {data.staff && (
              <Link className="adm-stat" href="/admin/users">
                <span>Active staff</span>
                <strong>{data.staff.active_count}</strong>
                <small>People who can sign in</small>
              </Link>
            )}
          </div>

          <div className="adm-grid-2">
            <section className="adm-card" aria-labelledby="next-events">
              <div className="adm-card-head">
                <h2 id="next-events">Coming up</h2>
                <Link href="/admin/events" className="link-arrow" style={{ fontSize: "0.95rem" }}>All events</Link>
              </div>
              {data.events.next.length ? (
                <ul className="adm-list">
                  {data.events.next.map((e) => (
                    <li key={e.id}>
                      <span>
                        <Link href={`/admin/events?edit=${e.id}`}>{e.title}</Link>{" "}
                        {!e.is_published && <Pill tone="warn">Hidden</Pill>}
                      </span>
                      <span className="meta">{dateOnly(e.starts_at, tz)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="adm-card-note">No upcoming events. Add one so it shows on the home page.</p>
              )}
            </section>

            {data.activity && (
              <section className="adm-card" aria-labelledby="activity">
                <div className="adm-card-head">
                  <h2 id="activity">Recent activity</h2>
                  <Link href="/admin/audit" className="link-arrow" style={{ fontSize: "0.95rem" }}>Audit log</Link>
                </div>
                <ul className="adm-list">
                  {data.activity.map((a) => (
                    <li key={a.id}>
                      <span>
                        <Pill tone={actionTone(a.action)}>{a.action_label}</Pill>{" "}
                        <strong>{a.actor_label}</strong>{" "}
                        {a.object_repr !== a.actor_label && (
                          <span className="adm-card-note">{a.object_type}{a.object_repr && ` · ${a.object_repr}`}</span>
                        )}
                      </span>
                      <span className="meta">{dateTime(a.created_at, tz)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}
