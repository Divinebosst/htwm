"use client";

import { useState } from "react";
import { telHref, whatsappUrl } from "@/lib/format";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; waLink: string };

const KINDS = [
  { value: "prayer", label: "Prayer request" },
  { value: "testimony", label: "Testimony" },
  { value: "counselling", label: "Request for counselling" },
];

export default function PrayerForm({ whatsapp, phone }: { whatsapp: string; phone: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || "").trim(),
      contact: String(data.get("contact") || "").trim(),
      kind: String(data.get("kind") || "prayer"),
      message: String(data.get("message") || "").trim(),
      is_private: data.get("is_private") === "on",
      website: String(data.get("website") || ""),
    };
    if (!payload.message) {
      setStatus({ kind: "invalid", message: "Please write your request in the box above, then send it." });
      (form.elements.namedItem("message") as HTMLTextAreaElement)?.focus();
      return;
    }

    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/prayer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      setStatus({ kind: "sent" });
    } catch {
      // Keep what they wrote and offer WhatsApp instead
      const label = KINDS.find((k) => k.value === payload.kind)?.label ?? "Prayer request";
      const text = [
        `${label} from the website`,
        `Name: ${payload.name || "Not given"}`,
        `Contact: ${payload.contact || "Not given"}`,
        payload.is_private ? "Please keep this private." : "",
        "",
        payload.message,
      ]
        .filter((l, i) => l !== "" || i === 4)
        .join("\n");
      setStatus({ kind: "failed", waLink: whatsappUrl(whatsapp, text) });
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pr-name">Your name</label>
          <input id="pr-name" name="name" type="text" autoComplete="name" placeholder="e.g. Tendai Moyo" />
        </div>
        <div className="field">
          <label htmlFor="pr-contact">Phone or email</label>
          <input id="pr-contact" name="contact" type="text" autoComplete="tel" placeholder="So we can follow up" />
        </div>
        <div className="field full">
          <label htmlFor="pr-kind">This is a</label>
          <select id="pr-kind" name="kind" defaultValue="prayer">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div className="field full">
          <label htmlFor="pr-message">How can we pray for you?</label>
          <textarea id="pr-message" name="message" required maxLength={5000} placeholder="Share as much or as little as you like." />
        </div>
        {/* Hidden from people; bots fill it in */}
        <div className="sr-only" aria-hidden="true">
          <label htmlFor="pr-website">Leave this empty</label>
          <input id="pr-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <label className="check full field" htmlFor="pr-private">
          <input id="pr-private" name="is_private" type="checkbox" defaultChecked />
          <span>Keep this private. Only the pastors and prayer team will read it.</span>
        </label>

        {status.kind === "sent" && (
          <div className="form-status ok" role="status">
            Thank you. Your request has reached the prayer team and we are standing with you.
          </div>
        )}
        {status.kind === "invalid" && <div className="form-status" role="alert">{status.message}</div>}
        {status.kind === "failed" && (
          <div className="form-status" role="alert">
            Your request could not be sent just now. You can{" "}
            <a href={status.waLink} target="_blank" rel="noopener">send it on WhatsApp instead</a>
            {phone && <> or call <a href={telHref(phone)}>{phone}</a></>}.
          </div>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={status.kind === "sending"}>
            {status.kind === "sending" ? "Sending…" : "Send request"}
          </button>
          <p className="hint">Your request goes straight to the prayer team.</p>
        </div>
      </div>
    </form>
  );
}
