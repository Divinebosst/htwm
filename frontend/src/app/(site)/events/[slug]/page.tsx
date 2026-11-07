import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DateTile, EventMeta } from "@/components/Events";
import Rays from "@/components/Rays";
import { ArrowIcon, CalendarIcon, ShareIcon } from "@/components/icons";
import { getEvent, getSettings, getUpcomingEvents } from "@/lib/api";
import { googleCalendarUrl, longDate, telHref } from "@/lib/format";
import { mediaPath, pageMetadata, siteUrl } from "@/lib/site";

// Prerender the upcoming events at build time. Events added later are
// rendered on their first visit and then cached.
export async function generateStaticParams() {
  const events = await getUpcomingEvents();
  return events.length ? events.map((e) => ({ slug: e.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) return { title: "Event not found" };
  return pageMetadata({
    title: event.title,
    description: event.summary,
    path: `/events/${event.slug}`,
    image: mediaPath(event.image_url),
  });
}

export default function EventPage({ params }: PageProps<"/events/[slug]">) {
  return (
    <Suspense fallback={<EventLoading />}>
      <EventDetail params={params} />
    </Suspense>
  );
}

async function EventDetail({ params }: Pick<PageProps<"/events/[slug]">, "params">) {
  const { slug } = await params;
  const [event, settings] = await Promise.all([getEvent(slug), getSettings()]);
  if (!event) notFound();

  const tz = settings.time_zone;
  const phone = settings.phones[0];
  const paragraphs = event.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const shareText = `${event.title}\n${longDate(event.starts_at, tz)}${event.location ? ` · ${event.location}` : ""}\n\n${event.summary}\n\n${siteUrl()}/events/${event.slug}`;

  return (
    <>
      <section className="page-hero event-hero" aria-labelledby="event-title">
        <Rays variant="page" />
        <div className="wrap">
          <Link className="back-link" href="/events">
            <ArrowIcon /> All events
          </Link>
          <p className="eyebrow">{event.category_label}</p>
          <h1 id="event-title">{event.title}</h1>
          <EventMeta event={event} tz={tz} />
          <div className="event-actions">
            {event.registration_url && (
              <a className="btn btn-gold" href={event.registration_url} target="_blank" rel="noopener">
                Register
              </a>
            )}
            <a className="btn btn-primary" href={googleCalendarUrl(event)} target="_blank" rel="noopener">
              <CalendarIcon /> Add to calendar
            </a>
            <a className="btn btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener">
              <ShareIcon /> Share on WhatsApp
            </a>
          </div>
        </div>
      </section>

      <div className="wrap event-body">
        <div className="prose">
          {event.image_url && (
            // Uploaded through the Django admin, so its size isn't known ahead of time
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaPath(event.image_url) ?? ""} alt="" />
          )}
          <p className="lead">{event.summary}</p>
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <aside className="event-aside">
          <div className="card">
            <div className="save-date">
              <DateTile iso={event.starts_at} tz={tz} />
              <div>
                <h3>Save the date</h3>
                <p>{longDate(event.starts_at, tz)}</p>
              </div>
            </div>
          </div>
          {phone && (
            <div className="card">
              <h3>Need directions?</h3>
              <p>
                Call or WhatsApp <a href={telHref(phone)}>{phone}</a> and we will help you find us.
              </p>
            </div>
          )}
          <Link className="link-arrow" href="/events">
            See all events <ArrowIcon />
          </Link>
        </aside>
      </div>
    </>
  );
}

function EventLoading() {
  return (
    <section className="page-hero" aria-busy="true">
      <div className="wrap">
        <div className="skeleton" style={{ height: 28, width: 160 }} />
        <div className="skeleton" style={{ height: 72, maxWidth: 560 }} />
        <div className="skeleton" style={{ height: 24, maxWidth: 380 }} />
      </div>
    </section>
  );
}
