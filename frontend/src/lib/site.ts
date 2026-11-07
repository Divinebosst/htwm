/*
  The website's public address and the text used when its pages are shared
  (link previews on WhatsApp, Facebook, X, LinkedIn, Telegram and others).
*/
import type { Metadata } from "next";
import shareCard from "@/assets/share-card.jpg";

export const SITE_NAME = "Heal The World Ministries International";
export const SITE_TAGLINE = "Omega Family Church. Healings, miracles and deliverances. Changing lives, reviving nations.";

/** The 1200x630 picture shown when a link to the site is shared. */
export const SHARE_IMAGE = {
  url: shareCard.src,
  width: shareCard.width,
  height: shareCard.height,
  type: "image/jpeg",
  alt: "Heal The World Ministries International, Omega Family Church: Changing lives. Reviving nations.",
};

/**
 * SITE_URL if set; otherwise the address Vercel gives the site; otherwise
 * localhost. Share images must use the public address or apps can't load them.
 */
export function siteUrl() {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Uploaded pictures are served by this site under /media, whatever address the backend reported. */
export function mediaPath(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url, "http://x");
    return u.pathname.startsWith("/media/") ? u.pathname + u.search : url;
  } catch {
    return url;
  }
}

/** Title, description and link-preview tags for a page. Without `image` the site's share card is used. */
export function pageMetadata({ title, description, path, image }: {
  title: string;
  description: string;
  path: string;
  image?: string | null;
}): Metadata {
  const shareTitle = `${title} | ${SITE_NAME}`;
  const images = [image ? { url: image, alt: title } : SHARE_IMAGE];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { siteName: SITE_NAME, type: "website", locale: "en_GB", title: shareTitle, description, url: path, images },
    twitter: { card: "summary_large_image", title: shareTitle, description, images },
  };
}
