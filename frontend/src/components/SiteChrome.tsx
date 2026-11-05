/* Top bar and footer. They read phone numbers and links from the backend. */
import Link from "next/link";
import { getSettings } from "@/lib/api";
import { telHref } from "@/lib/format";
import { Brand } from "./SiteHeader";
import { FacebookIcon, PhoneIcon, YoutubeIcon } from "./icons";

export async function TopBar() {
  const s = await getSettings();
  const phone = s.phones[0];
  return (
    <div className="topbar">
      <div className="wrap">
        <p className="topbar-tag">
          Healings<span>·</span>Miracles<span>·</span>Deliverances
        </p>
        <div className="topbar-links">
          {phone && (
            <a href={telHref(phone)}>
              <PhoneIcon />
              {phone}
            </a>
          )}
          {s.social.facebook && (
            <a href={s.social.facebook} target="_blank" rel="noopener">
              <FacebookIcon />
              Facebook
            </a>
          )}
          {s.social.youtube && (
            <a href={s.social.youtube} target="_blank" rel="noopener">
              <YoutubeIcon />
              YouTube
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export async function SiteFooter() {
  const s = await getSettings();
  return (
    <footer className="site-footer" id="contact">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link className="brand" href="/">
              <Brand />
            </Link>
            <p className="footer-tagline">
              Changing lives
              <br />
              Reviving nations
            </p>
          </div>
          <div>
            <h4>Visit</h4>
            <ul>
              <li><Link href="/#about">About us</Link></li>
              <li><Link href="/events">Events</Link></li>
              <li><Link href="/#services">Service times</Link></li>
              <li><Link href="/#watch">Watch online</Link></li>
              <li><Link href="/#prayer">Prayer request</Link></li>
            </ul>
          </div>
          <div>
            <h4>Give</h4>
            <ul>
              <li><Link href="/give?type=tithe">Pay your tithe</Link></li>
              <li><Link href="/give?type=offering">Give an offering</Link></li>
              <li><Link href="/give?type=seed">Sow a seed</Link></li>
              <li><Link href="/give?type=building">Building fund</Link></li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              {s.phones.map((p) => (
                <li key={p}><a href={telHref(p)}>{p}</a></li>
              ))}
              {s.email && <li><a href={`mailto:${s.email}`}>{s.email}</a></li>}
              {s.social.website && (
                <li><a href={s.social.website}>{s.social.website.replace(/^https?:\/\/(www\.)?/, "")}</a></li>
              )}
              {s.social.facebook && <li><a href={s.social.facebook} target="_blank" rel="noopener">Facebook</a></li>}
              {s.social.youtube && <li><a href={s.social.youtube} target="_blank" rel="noopener">YouTube</a></li>}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {CURRENT_YEAR} {s.church_name} · Omega Family Church</p>
          <p>Healings, miracles &amp; deliverances</p>
        </div>
      </div>
    </footer>
  );
}

// Read once when the server starts (avoids a "current time" read during rendering)
const CURRENT_YEAR = new Date().getFullYear();
