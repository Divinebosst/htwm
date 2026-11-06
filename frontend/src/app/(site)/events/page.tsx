import type { Metadata } from "next";
import { EventCard, EventRow, NoEvents } from "@/components/Events";
import Rays from "@/components/Rays";
import { getPastEvents, getSettings, getUpcomingEvents } from "@/lib/api";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Crusades, conferences, prayer meetings and special services at Heal The World Ministries International, Omega Family Church.",
};

export default async function EventsPage() {
  const [upcoming, past, settings] = await Promise.all([getUpcomingEvents(), getPastEvents(6), getSettings()]);
  const tz = settings.time_zone;

  return (
    <>
      <section className="page-hero" aria-labelledby="events-heading">
        <Rays variant="page" />
        <div className="wrap">
          <p className="eyebrow">What&apos;s on</p>
          <h1 id="events-heading">
            Upcoming <span>events</span>
          </h1>
          <p className="lead">
            Crusades, conferences, prayer meetings and special services. Everyone is welcome. Bring your family and
            friends.
          </p>
        </div>
      </section>

      <section className="section" aria-label="Event list">
        <div className="wrap">
          {upcoming.length > 0 ? (
            <div className="event-cards">
              {upcoming.map((e) => (
                <EventCard key={e.id} event={e} tz={tz} />
              ))}
            </div>
          ) : (
            <NoEvents facebook={settings.social.facebook} />
          )}

          {past.length > 0 && (
            <div className="past">
              <h2>Past events</h2>
              <ul className="event-list">
                {past.map((e) => (
                  <EventRow key={e.id} event={e} tz={tz} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
