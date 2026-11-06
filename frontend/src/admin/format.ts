/* Dates and money for the admin pages. */

export function dateTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function dateOnly(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(iso));
}

export function money(amount: string | number, currency: string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** ISO date-time -> value for <input type="datetime-local"> in this device's time zone */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value -> ISO date-time */
export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
