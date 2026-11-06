"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { refreshPublicSite } from "@/app/admin/actions";
import { ApiError, api, type AdminEvent } from "@/admin/api";
import { useAuth } from "@/admin/auth";
import { dateTime, deviceTimeZone, fromLocalInput, toLocalInput } from "@/admin/format";
import { ConfirmButton, Drawer, Empty, ErrorNote, Field, Loading, NoAccess, PageHeader, Pill, useToast } from "@/admin/ui";
import { useApi } from "@/admin/useApi";

const CATEGORIES = [
  { value: "service", label: "Special service" },
  { value: "crusade", label: "Crusade" },
  { value: "conference", label: "Conference" },
  { value: "prayer", label: "Prayer & fasting" },
  { value: "youth", label: "Youth" },
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
  { value: "outreach", label: "Outreach" },
  { value: "other", label: "Other" },
];

type When = "upcoming" | "past" | "all";

export default function EventsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EventsAdmin />
    </Suspense>
  );
}

function EventsAdmin() {
  const { can, me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [when, setWhen] = useState<When>("upcoming");
  const [editing, setEditing] = useState<AdminEvent | "new" | null>(params.get("new") ? "new" : null);
  const { data, error, loading, reload } = useApi<AdminEvent[]>(can("events.edit") ? `/admin/events?when=${when}` : null);
  if (!can("events.edit")) return <NoAccess />;

  const editParam = Number(params.get("edit"));
  const fromLink = editParam && editing === null ? data?.find((e) => e.id === editParam) : undefined;
  const open = editing ?? fromLink ?? null;

  const close = () => {
    setEditing(null);
    if (params.get("edit") || params.get("new")) router.replace("/admin/events");
  };

  return (
    <>
      <PageHeader
        title="Events"
        description="Crusades, conferences and special services shown on the website. Hidden events stay off the website until you publish them."
        actions={<button type="button" className="adm-btn adm-btn-gold" onClick={() => setEditing("new")}>Add event</button>}
      />
      <div className="adm-tabs" role="group" aria-label="Show">
        {(["upcoming", "past", "all"] as When[]).map((w) => (
          <button key={w} type="button" className="adm-tab" aria-pressed={when === w} onClick={() => setWhen(w)}>
            {w === "upcoming" ? "Upcoming" : w === "past" ? "Past" : "All"}
          </button>
        ))}
      </div>
      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.length === 0 ? (
        <Empty title={when === "past" ? "No past events" : "No upcoming events"}>
          {when !== "past" && "Add an event and it will appear on the home page and the events page."}
        </Empty>
      ) : data ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Starts</th>
                <th>Event</th>
                <th>Location</th>
                <th>On the website</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setEditing(e)} tabIndex={0}
                  onKeyDown={(k) => k.key === "Enter" && setEditing(e)}>
                  <td className="nowrap">{dateTime(e.starts_at, me?.time_zone)}</td>
                  <td>
                    <span className="strong">{e.title}</span>
                    <span className="sub">{e.category_label}</span>
                  </td>
                  <td>{e.location || "—"}</td>
                  <td>
                    <span className="adm-pills">
                      {e.is_published ? <Pill tone="ok">Published</Pill> : <Pill tone="warn">Hidden</Pill>}
                      {e.is_featured && <Pill tone="violet">Featured</Pill>}
                      {e.status === "past" && <Pill>Past</Pill>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {open && (
        <EventEditor
          key={open === "new" ? "new" : open.id}
          event={open === "new" ? null : open}
          churchTimeZone={me?.time_zone ?? ""}
          onClose={close}
          onSaved={() => {
            close();
            reload();
          }}
        />
      )}
    </>
  );
}

function EventEditor({
  event,
  churchTimeZone,
  onClose,
  onSaved,
}: {
  event: AdminEvent | null;
  churchTimeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: event?.title ?? "",
    category: event?.category ?? "service",
    starts_at: toLocalInput(event?.starts_at),
    ends_at: toLocalInput(event?.ends_at),
    location: event?.location ?? "Omega Family Church",
    summary: event?.summary ?? "",
    description: event?.description ?? "",
    registration_url: event?.registration_url ?? "",
    is_featured: event?.is_featured ?? false,
    is_published: event?.is_published ?? true,
  });
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const deviceTz = deviceTimeZone();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function save() {
    const missing: Record<string, string> = {};
    if (!form.title.trim()) missing.title = "Give the event a name.";
    if (!form.starts_at) missing.starts_at = "Choose when it starts.";
    if (!form.summary.trim()) missing.summary = "Write one or two sentences for the event card.";
    setErrors(missing);
    if (Object.keys(missing).length) return;

    setBusy(true);
    setFailure(null);
    const payload = { ...form, starts_at: fromLocalInput(form.starts_at), ends_at: fromLocalInput(form.ends_at) };
    try {
      const saved = event
        ? await api<AdminEvent>(`/admin/events/${event.id}`, { method: "PATCH", json: payload })
        : await api<AdminEvent>("/admin/events", { method: "POST", json: payload });
      if (image) {
        const fd = new FormData();
        fd.append("image", image);
        await api(`/admin/events/${saved.id}/image`, { method: "POST", form: fd });
      }
      await refreshPublicSite(["events"]);
      toast(event ? "Event saved. The website is up to date." : "Event added to the website.");
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fields ?? {});
      setFailure(e);
      setBusy(false);
    }
  }

  async function remove() {
    if (!event) return;
    try {
      await api(`/admin/events/${event.id}`, { method: "DELETE" });
      await refreshPublicSite(["events"]);
      toast("Event deleted.");
      onSaved();
    } catch (err) {
      setFailure(err as ApiError);
    }
  }

  async function removeImage() {
    if (!event) return;
    try {
      await api(`/admin/events/${event.id}/image`, { method: "DELETE" });
      setImageUrl(null);
      await refreshPublicSite(["events"]);
      toast("Picture removed.");
    } catch (err) {
      setFailure(err as ApiError);
    }
  }

  return (
    <Drawer
      open
      title={event ? "Edit event" : "New event"}
      onClose={onClose}
      footer={
        <>
          {event && <ConfirmButton label="Delete" confirmLabel="Yes, delete this event" danger onConfirm={remove} />}
          <div className="right">
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="adm-btn adm-btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : event ? "Save changes" : "Add event"}
            </button>
          </div>
        </>
      }
    >
      {failure && !Object.keys(errors).length && <ErrorNote error={failure} />}
      <div className="adm-form">
        <Field label="Event name" htmlFor="ev-title" error={errors.title} full>
          <input id="ev-title" value={form.title} onChange={set("title")} maxLength={140} />
        </Field>
        <Field label="Type" htmlFor="ev-category">
          <select id="ev-category" value={form.category} onChange={set("category")}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Location" htmlFor="ev-location">
          <input id="ev-location" value={form.location} onChange={set("location")} maxLength={160} />
        </Field>
        <Field label="Starts" htmlFor="ev-start" error={errors.starts_at}
          hint={deviceTz !== churchTimeZone ? `Your device time (${deviceTz}). The website shows ${churchTimeZone} time.` : undefined}>
          <input id="ev-start" type="datetime-local" value={form.starts_at} onChange={set("starts_at")} />
        </Field>
        <Field label="Ends (optional)" htmlFor="ev-end" error={errors.ends_at}>
          <input id="ev-end" type="datetime-local" value={form.ends_at} onChange={set("ends_at")} min={form.starts_at} />
        </Field>
        <Field label="Short summary" htmlFor="ev-summary" error={errors.summary} hint={`${form.summary.length}/240 · shown on the event card`} full>
          <textarea id="ev-summary" value={form.summary} onChange={set("summary")} maxLength={240} style={{ minHeight: 80 }} />
        </Field>
        <Field label="Full details" htmlFor="ev-description" hint="Leave a blank line between paragraphs." full>
          <textarea id="ev-description" value={form.description} onChange={set("description")} />
        </Field>
        <Field label="Registration link (optional)" htmlFor="ev-reg" error={errors.registration_url} full>
          <input id="ev-reg" type="url" placeholder="https://…" value={form.registration_url} onChange={set("registration_url")} />
        </Field>
        <label className="adm-switch field">
          <input type="checkbox" checked={form.is_published} onChange={set("is_published")} /> Show on the website
        </label>
        <label className="adm-switch field">
          <input type="checkbox" checked={form.is_featured} onChange={set("is_featured")} /> Feature on the home page
        </label>
        <Field label="Picture (optional)" htmlFor="ev-image" error={errors.image} hint="JPG, PNG or WebP, up to 5 MB." full>
          {imageUrl && (
            // Uploaded picture served by Django
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Current event picture" style={{ maxHeight: 160, borderRadius: 10, width: "auto" }} />
          )}
          <input id="ev-image" type="file" accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          {imageUrl && event && (
            <span><button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={removeImage}>Remove picture</button></span>
          )}
        </Field>
      </div>
    </Drawer>
  );
}
