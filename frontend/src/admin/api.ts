/*
  Talks to the Django staff API from the browser.

  Requests go to /api/... on this same site (Next.js passes them to Django),
  so the sign-in cookie is sent automatically. Changes also send Django's
  CSRF token, which protects staff from forged requests.
*/

export class ApiError extends Error {
  status: number;
  data: unknown;
  code?: string;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
    if (data && typeof data === "object" && "code" in data) this.code = String((data as { code: unknown }).code);
  }

  /** Field errors from Django, e.g. { title: "This field is required." } */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === "object" && !Array.isArray(this.data)) {
      for (const [key, value] of Object.entries(this.data as Record<string, unknown>)) {
        if (key === "detail" || key === "code") continue;
        out[key] = Array.isArray(value) ? String(value[0]) : String(value);
      }
    }
    return out;
  }
}

function readCookie(name: string) {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

async function csrfToken() {
  let token = readCookie("csrftoken");
  if (!token) {
    await fetch("/api/auth/csrf", { credentials: "same-origin" });
    token = readCookie("csrftoken");
  }
  return token;
}

function messageFor(status: number, data: unknown) {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    const first = Object.entries(d).find(([k]) => k !== "code");
    if (first) {
      const [field, value] = first;
      const text = Array.isArray(value) ? value[0] : value;
      return field === "non_field_errors" ? String(text) : `${field.replace(/_/g, " ")}: ${text}`;
    }
  }
  if (status === 403) return "Your session has expired or the page is out of date. Reload the page and try again.";
  if (status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (status >= 500) return "Something went wrong on the server. Please try again.";
  return "Something went wrong. Please try again.";
}

type Options = { method?: "GET" | "POST" | "PATCH" | "DELETE"; json?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T = unknown>(path: string, { method = "GET", json, form, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (method !== "GET") headers["X-CSRFToken"] = await csrfToken();
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body, credentials: "same-origin", signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your internet connection and try again.", 0, null);
  }
  if (res.status === 204) return undefined as T;

  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data: unknown = isJson ? await res.json() : null;
  if (!res.ok) {
    const error = new ApiError(messageFor(res.status, data), res.status, data);
    if (typeof window !== "undefined") {
      if (res.status === 401) window.dispatchEvent(new Event("admin:signed-out"));
      if (error.code === "password_change_required") window.dispatchEvent(new Event("admin:password-required"));
    }
    throw error;
  }
  return data as T;
}

/* ---------- Shapes returned by the API ---------- */

export type Me = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  role: string;
  role_label: string;
  permissions: string[];
  manageable_roles: { value: string; label: string }[];
  must_change_password: boolean;
  time_zone: string;
};

export type Paged<T> = { count: number; page: number; pages: number; page_size: number; results: T[] };

export type AuditEntry = {
  id: number;
  created_at: string;
  actor: number | null;
  actor_label: string;
  actor_role: string;
  action: string;
  action_label: string;
  object_type: string;
  object_id: string;
  object_repr: string;
  changes: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string;
  source: string;
  source_label: string;
};

export type AdminEvent = {
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
  is_published: boolean;
  status: "upcoming" | "past";
};

export type AdminService = {
  id: number;
  day: number;
  day_name: string;
  start_time: string;
  title: string;
  description: string;
  order: number;
  is_active: boolean;
};

export type AdminPrayer = {
  id: number;
  name: string;
  contact: string;
  kind: string;
  kind_label: string;
  message: string;
  is_private: boolean;
  status: string;
  status_label: string;
  staff_notes: string;
  created_at: string;
};

export type AdminGift = {
  id: number;
  category: string;
  category_label: string;
  purpose: string;
  amount: string;
  currency: string;
  method: string;
  method_label: string;
  /** Mobile money wallet: ecocash, innbucks, omari or onemoney. */
  provider: string;
  payer_phone: string;
  /** PayPal capture ID or Paynow reference, once paid. */
  provider_reference: string;
  provider_status: string;
  reference: string;
  giver_name: string;
  giver_contact: string;
  anonymous: boolean;
  status: string;
  status_label: string;
  staff_notes: string;
  created_at: string;
  confirmed_at: string | null;
};

export type AdminCategory = {
  id: number;
  key: string;
  label: string;
  description: string;
  reference_code: string;
  asks_purpose: boolean;
  order: number;
  is_active: boolean;
  gift_count: number;
};

export type StaffUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  role_label: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login: string | null;
  date_joined: string;
  can_edit: boolean;
  is_you: boolean;
};

export type Option = { value: string; label: string };
