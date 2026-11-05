import Link from "next/link";
import type { ChurchEvent } from "@/lib/api";
import { dateTile, eventWhen } from "@/lib/format";
import Rays from "./Rays";
import { ArrowIcon, ClockIcon, PinIcon } from "./icons";

export function DateTile({ iso, tz }: { iso: string; tz: string }) {
  const t = dateTile(iso, tz);
  return (
    <span className="date-tile" aria-hidden>
      <span className="m">{t.month}</span>
      <span className="d">{t.day}</span>
      <span className="w">{t.weekday}</span>
    </span>
  );
}

export function EventMeta({ event, tz }: { event: ChurchEvent; tz: string }) {
  return (
    <ul className="event-meta">
      <li>
        <ClockIcon />
        <span>{eventWhen(event.starts_at, event.ends_at, tz)}</span>
      </li>
      {event.location && (
        <li>
          <PinIcon />
          <span>{event.location}</span>
        </li>
      )}
    </ul>
  );
}

export function FeaturedEvent({ event, tz }: { event: ChurchEvent; tz: string }) {
  const t = dateTile(event.starts_at, tz);
  return (
    <Link className="event-feature" href={`/events/${event.slug}`}>
      <Rays variant="band" />
      <span className="chip chip-solid">{event.is_featured ? "Don't miss" : "Next up"} · {event.category_label}</span>
      <span className="big-date" aria-hidden>
        <span className="d">{t.day}</span>
        <span className="m">
          {t.month}
          <small>{t.weekday}</small>
        </span>
      </span>
      <h3>{event.title}</h3>
      <EventMeta event={event} tz={tz} />
      <p>{event.summary}</p>
      <span className="go">
        Event details <ArrowIcon />
      </span>
    </Link>
  );
}

export function EventRow({ event, tz }: { event: ChurchEvent; tz: string }) {
  return (
    <li>
      <Link className="event-row" href={`/events/${event.slug}`}>
        <DateTile iso={event.starts_at} tz={tz} />
        <div>
          <span className="chip">{event.category_label}</span>
          <h3>{event.title}</h3>
          <span className="when">
            {eventWhen(event.starts_at, event.ends_at, tz)}
            {event.location ? ` · ${event.location}` : ""}
          </span>
        </div>
        <ArrowIcon />
      </Link>
    </li>
  );
}

export function EventCard({ event, tz }: { event: ChurchEvent; tz: string }) {
  return (
    <Link className={`event-card${event.is_featured ? " is-featured" : ""}`} href={`/events/${event.slug}`}>
      <div className="top">
        <DateTile iso={event.starts_at} tz={tz} />
        <span className={event.is_featured ? "chip chip-solid" : "chip"}>{event.category_label}</span>
      </div>
      <h3>{event.title}</h3>
      <EventMeta event={event} tz={tz} />
      <p className="summary">{event.summary}</p>
      <span className="link-arrow">
        Details <ArrowIcon />
      </span>
    </Link>
  );
}

export function NoEvents({ facebook }: { facebook: string }) {
  return (
    <div className="events-empty">
      <h3>No events announced yet</h3>
      <p>New crusades, conferences and special services are announced here and on our Facebook page.</p>
      {facebook && (
        <a className="link-arrow" href={facebook} target="_blank" rel="noopener">
          Follow us on Facebook <ArrowIcon />
        </a>
      )}
    </div>
  );
}
