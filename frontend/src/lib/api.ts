/*
  Talks to the Django backend.

  Server components call these functions. Each result is cached for about a
  minute ("minutes" profile), so edits made in the Django admin show up on the
  site shortly after saving without hitting the API on every page view.
  If the API can't be reached, the site falls back to safe defaults instead of
  crashing.
*/
import { cacheLife, cacheTag } from "next/cache";

export const API_URL = (process.env.DJANGO_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export type Settings = {
  church_name: string;
  short_name: string;
  time_zone: string;
  phones: string[];
  whatsapp: string;
  email: string;
  social: { facebook: string; youtube: string; website: string };
  giving: GivingSettings;
};

export type GivingSettings = {
  currency: string;
  preset_amounts: number[];
  ecocash: { merchant_name: string; merchant_code: string; steps: string[] };
  bank: {
    account_name: string;
    bank_name: string;
    branch: string;
    account_number: string;
    account_currency: string;
    swift: string;
  };
  online_giving_url: string;
  abroad: { recipient_name: string; recipient_phone: string; country: string; services: string[] };
  /** Empty until PayPal is connected on the server. */
  paypal_client_id: string;
  paypal_mode: "sandbox" | "live";
  /** True once Paynow (EcoCash, InnBucks, O'mari, OneMoney) is connected on the server. */
  mobile_money_enabled: boolean;
};

export type ServiceTime = {
  id: number;
  day: number;
  day_name: string;
  start_time: string; // "HH:MM:SS"
  title: string;
  description: string;
};

export type ChurchEvent = {
  id: number;
  slug: string;
  title: string;
  category: string;
  category_label: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  summary: string;
  description: string;
  image_url: string | null;
  registration_url: string;
  is_featured: boolean;
};

export type GivingCategory = {
  key: string;
  label: string;
  description: string;
  reference_code: string;
  asks_purpose: boolean;
};

export const FALLBACK_SETTINGS: Settings = {
  church_name: "Heal The World Ministries International",
  short_name: "Heal The World Ministries",
  time_zone: "Africa/Harare",
  phones: ["0775 856 800"],
  whatsapp: "263775856800",
  email: "",
  social: {
    facebook: "https://www.facebook.com/apostlemahovoperth",
    youtube: "https://www.youtube.com/results?search_query=Apostle+Chrispen+Mahovo",
    website: "https://www.healtheworldministries.com",
  },
  giving: {
    currency: "USD",
    preset_amounts: [10, 20, 50, 100, 200, 500],
    ecocash: { merchant_name: "", merchant_code: "", steps: [] },
    bank: { account_name: "", bank_name: "", branch: "", account_number: "", account_currency: "", swift: "" },
    online_giving_url: "",
    abroad: { recipient_name: "", recipient_phone: "", country: "", services: [] },
    paypal_client_id: "",
    paypal_mode: "sandbox",
    mobile_money_enabled: false,
  },
};

async function getJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.error(`[api] ${path} returned ${res.status}`);
      return fallback;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[api] could not reach ${API_URL}${path}:`, (err as Error).message);
    return fallback;
  }
}

export async function getSettings(): Promise<Settings> {
  "use cache";
  cacheLife("minutes");
  cacheTag("settings");
  return getJSON("/api/settings", FALLBACK_SETTINGS);
}

export async function getServiceTimes(): Promise<ServiceTime[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("services");
  return getJSON("/api/services", []);
}

export async function getUpcomingEvents(limit = 0): Promise<ChurchEvent[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("events");
  return getJSON(`/api/events${limit ? `?limit=${limit}` : ""}`, []);
}

export async function getPastEvents(limit = 6): Promise<ChurchEvent[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("events");
  return getJSON(`/api/events?when=past&limit=${limit}`, []);
}

export async function getEvent(slug: string): Promise<ChurchEvent | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("events", `event-${slug}`);
  if (!/^[-\w]+$/.test(slug)) return null;
  return getJSON<ChurchEvent | null>(`/api/events/${slug}`, null);
}

export async function getGivingCategories(): Promise<GivingCategory[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("giving");
  return getJSON("/api/giving-categories", []);
}
