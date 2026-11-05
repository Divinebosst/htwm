/* Date and money helpers. Dates are always shown in the church's time zone. */

type Parts = { weekday: string; day: string; month: string; year: string; time: string };

function parts(iso: string, timeZone: string): Parts {
  const d = new Date(iso);
  const get = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, ...opts }).format(d);
  return {
    weekday: get({ weekday: "short" }),
    day: get({ day: "numeric" }),
    month: get({ month: "short" }),
    year: get({ year: "numeric" }),
    time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d),
  };
}

/** For the calendar tile: { day: "20", month: "Nov" } */
export function dateTile(iso: string, timeZone: string) {
  const p = parts(iso, timeZone);
  return { day: p.day, month: p.month, weekday: p.weekday };
}

function sameDay(a: Parts, b: Parts) {
  return a.day === b.day && a.month === b.month && a.year === b.year;
}

/**
 * "Fri 13 Nov · 6:00 PM – 9:00 PM"
 * "Fri 20 Nov, 5:00 PM – Sun 22 Nov, 8:00 PM"
 */
export function eventWhen(startIso: string, endIso: string | null, timeZone: string) {
  const s = parts(startIso, timeZone);
  const startDate = `${s.weekday} ${s.day} ${s.month}`;
  if (!endIso) return `${startDate} · ${s.time}`;
  const e = parts(endIso, timeZone);
  if (sameDay(s, e)) return `${startDate} · ${s.time} – ${e.time}`;
  return `${startDate}, ${s.time} – ${e.weekday} ${e.day} ${e.month}, ${e.time}`;
}

/** "Friday 20 November 2026" */
export function longDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** "10:00:00" -> { time: "10:00", meridiem: "AM" } */
export function serviceTime(hms: string) {
  const [h, m] = hms.split(":").map(Number);
  const meridiem = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { time: `${hour12}:${String(m).padStart(2, "0")}`, meridiem };
}

/** Google Calendar "add event" link */
export function googleCalendarUrl(ev: {
  title: string;
  starts_at: string;
  ends_at: string | null;
  summary: string;
  location: string;
}) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${stamp(ev.starts_at)}/${stamp(end)}`,
    details: ev.summary,
    location: ev.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function whatsappUrl(number: string, text: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Same rule as the backend: TITHE + "Tendai Moyo" -> TITHE-MOYO */
export function buildReference(code: string, name: string, anonymous: boolean) {
  if (anonymous || !name.trim()) return code;
  const words = name.trim().split(/\s+/);
  const surname = words[words.length - 1].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12);
  return surname ? `${code}-${surname}` : code;
}
