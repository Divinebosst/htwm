"use server";

import { cookies } from "next/headers";
import { updateTag } from "next/cache";
import { API_URL } from "@/lib/api";

const TAGS = new Set(["events", "services", "settings", "giving"]);

/**
 * After staff change something, refresh the cached public pages straight away
 * (otherwise they update on their own within about a minute). A single event's
 * own page may show the old version to one more visitor while it rebuilds.
 * Only works for a signed-in staff member: the session is checked with Django first.
 */
export async function refreshPublicSite(tags: string[]) {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { cookie: cookieHeader, accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false };
  for (const tag of tags) if (TAGS.has(tag)) updateTag(tag);
  return { ok: true };
}
