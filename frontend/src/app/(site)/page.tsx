import Image from "next/image";
import Link from "next/link";
import leaders from "@/assets/leaders.jpg";
import logo from "@/assets/logo.png";
import { EventRow, FeaturedEvent, NoEvents } from "@/components/Events";
import PrayerForm from "@/components/PrayerForm";
import Rays from "@/components/Rays";
import {
  ArrowIcon,
  FacebookIcon,
  GiftIcon,
  HealingIcon,
  HomeIcon,
  PlayIcon,
  PrayerIcon,
  SparkleIcon,
  UnlockIcon,
  YoutubeIcon,
} from "@/components/icons";
import { getServiceTimes, getSettings, getUpcomingEvents } from "@/lib/api";
import { dateTile, serviceTime, telHref } from "@/lib/format";

export default function HomePage() {
  return (
    <>
      <Hero />
      <JoinTheFamily />
      <UpcomingEvents />
      <About />
      <ServiceTimes />
      <Watch />
      <Prayer />
      <GiveBand />
    </>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <Rays variant="hero" />
      <div className="wrap">
        <p className="eyebrow hero-eyebrow">Omega Family Church</p>
        <div className="hero-copy">
          <h1 id="hero-title">
            Changing lives. <span className="line2">Reviving nations.</span>
          </h1>
          <p className="lead">
            A family of believers who expect God to move. Come as you are and receive healing, freedom and a new
            beginning in Christ.
          </p>
          <ul className="hero-pills" aria-label="Our ministry">
            <li>Healings</li>
            <li>Miracles</li>
            <li>Deliverances</li>
          </ul>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/#services">Plan your visit</Link>
            <Link className="btn btn-ghost" href="/events">Upcoming events</Link>
          </div>
        </div>
        <VisitCard />
      </div>
    </section>
  );
}

/* First thing visitors see: when they can come, and what's coming up. */
async function VisitCard() {
  const [services, events, settings] = await Promise.all([getServiceTimes(), getUpcomingEvents(6), getSettings()]);
  const next = events.find((e) => e.is_featured) ?? events[0];
  const when = next ? dateTile(next.starts_at, settings.time_zone) : null;
  const phone = settings.phones[0];
  return (
    <aside className="visit-card" aria-labelledby="visit-title">
      <div className="visit-card-body">
        <span className="visit-badge"><Image src={logo} alt="" width={72} priority /></span>
        <h2 id="visit-title" className="eyebrow">Join us this week</h2>
        {services.length > 0 ? (
          <ul className="visit-times">
            {services.slice(0, 4).map((s) => {
              const t = serviceTime(s.start_time);
              return (
                <li key={s.id}>
                  <span className="day">{s.day_name}</span>
                  <span className="time">{t.time}<small>{t.meridiem}</small></span>
                  <span className="what">{s.title}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="visit-empty">
            Service times are coming soon.{phone && <> Call <a href={telHref(phone)}>{phone}</a> to find out more.</>}
          </p>
        )}
      </div>
      {next && (
        <Link className="visit-next" href={`/events/${next.slug}`}>
          <span className="label">
            {next.is_featured ? "Don't miss" : "Next event"} · {when?.weekday} {when?.day} {when?.month}
          </span>
          <strong>{next.title}</strong>
          <ArrowIcon />
        </Link>
      )}
    </aside>
  );
}

const ACTIONS = [
  { href: "/#services", cls: "ac-royal", Icon: HomeIcon, title: "New here?", text: "See our service times and what to expect on your first Sunday.", go: "Plan a visit" },
  { href: "/#prayer", cls: "ac-violet", Icon: PrayerIcon, title: "Prayer request", text: "Tell us what you are believing God for. We will stand with you.", go: "Send a request" },
  { href: "/#watch", cls: "ac-peri", Icon: PlayIcon, title: "Watch online", text: "Catch services and teachings on YouTube and Facebook.", go: "Watch now" },
  { href: "/give", cls: "ac-gold", Icon: GiftIcon, title: "Give", text: "Tithes, offerings, seeds and the building fund.", go: "Give now" },
];

function JoinTheFamily() {
  return (
    <section className="actions section" aria-labelledby="actions-title">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Welcome home</p>
          <h2 id="actions-title">Join the family</h2>
        </div>
        <div className="action-grid">
          {ACTIONS.map(({ href, cls, Icon, title, text, go }) => (
            <Link key={title} className={`action-card ${cls}`} href={href}>
              <span className="icon"><Icon /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="go">{go} <ArrowIcon /></span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

async function UpcomingEvents() {
  const [events, settings] = await Promise.all([getUpcomingEvents(6), getSettings()]);
  const tz = settings.time_zone;
  // Featured event first, otherwise the soonest one
  const featured = events.find((e) => e.is_featured) ?? events[0];
  const rest = events.filter((e) => e !== featured).slice(0, 3);

  return (
    <section className="events section" id="events" aria-labelledby="events-title">
      <div className="wrap">
        <div className="head-row">
          <div className="section-head">
            <p className="eyebrow">What&apos;s on</p>
            <h2 id="events-title">Upcoming events</h2>
          </div>
          {events.length > 0 && (
            <Link className="link-arrow" href="/events">
              See all events <ArrowIcon />
            </Link>
          )}
        </div>
        {featured ? (
          <div className="events-grid">
            <FeaturedEvent event={featured} tz={tz} />
            {rest.length > 0 && (
              <ul className="event-list">
                {rest.map((e) => (
                  <EventRow key={e.id} event={e} tz={tz} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <NoEvents facebook={settings.social.facebook} />
        )}
      </div>
    </section>
  );
}

const PILLARS = [
  { Icon: HealingIcon, title: "Healings", verse: "He sent his word, and healed them, and delivered them from their destructions.", ref: "Psalm 107:20" },
  { Icon: SparkleIcon, title: "Miracles", verse: "Jesus Christ the same yesterday, and to day, and for ever.", ref: "Hebrews 13:8" },
  { Icon: UnlockIcon, title: "Deliverances", verse: "If the Son therefore shall make you free, ye shall be free indeed.", ref: "John 8:36" },
];

function About() {
  return (
    <section className="about section" id="about" aria-labelledby="about-title">
      <div className="wrap">
        <div className="about-grid">
          <figure className="leaders-photo">
            <div className="arch">
              <Image
                src={leaders}
                alt="Apostle Chrispen Mahovo standing beside Prophetess Yvonne Mahovo, both dressed in purple"
                placeholder="blur"
                sizes="(max-width: 860px) 360px, 420px"
              />
            </div>
            <figcaption className="hero-caption">
              <strong>Apostle Chrispen &amp; Prophetess Yvonne Mahovo</strong>
              <span>Leading Heal The World Ministries International</span>
            </figcaption>
          </figure>
          <div className="about-copy">
            <p className="eyebrow">About us</p>
            <h2 id="about-title">A ministry of healing for families and nations</h2>
            <p className="lead">
              Heal The World Ministries International, home of Omega Family Church, is led by Apostle Chrispen Mahovo
              and Prophetess Yvonne Mahovo.
            </p>
            <p>
              We believe that Jesus Christ is the same yesterday, today and forever, and that the power that healed
              the sick in the Bible still heals today. Every service is a place to worship, hear the Word and receive
              prayer for healing and deliverance.
            </p>
            <p>
              Our mission is in our name: to carry the healing message of the Gospel to individuals, families,
              communities and nations.
            </p>
            <dl className="vision">
              <div><dt>Our vision</dt><dd>Changing lives, reviving nations</dd></div>
              <div><dt>Our church</dt><dd>Omega Family Church</dd></div>
            </dl>
          </div>
        </div>
        <ul className="pillars pillars-row" aria-label="What we believe God for">
          {PILLARS.map(({ Icon, title, verse, ref }) => (
            <li className="pillar" key={title}>
              <span className="mark"><Icon /></span>
              <h3>{title}</h3>
              <blockquote>“{verse}”</blockquote>
              <cite>{ref}</cite>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

async function ServiceTimes() {
  const [services, settings] = await Promise.all([getServiceTimes(), getSettings()]);
  const phone = settings.phones[0];
  return (
    <section className="services section" id="services" aria-labelledby="services-title">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Plan your visit</p>
          <h2 id="services-title">Service times</h2>
          <p>Everyone is welcome. Come early, find a seat, and expect God to meet you.</p>
        </div>
        {services.length > 0 ? (
          <ul className="service-list">
            {services.map((s) => {
              const t = serviceTime(s.start_time);
              return (
                <li className="service" key={s.id}>
                  <span className="day">{s.day_name}</span>
                  <span className="time">{t.time}<small>{t.meridiem}</small></span>
                  <h3>{s.title}</h3>
                  {s.description && <p>{s.description}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lead">Service times will be posted here soon.</p>
        )}
        {phone && (
          <div className="visit-note">
            <p>
              <strong>Need directions?</strong> Call or WhatsApp <a href={telHref(phone)}>{phone}</a> and we will
              help you find us.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

async function Watch() {
  const { social } = await getSettings();
  return (
    <section className="watch" id="watch" aria-labelledby="watch-title">
      <Rays variant="band" />
      <div className="wrap">
        <div className="watch-copy">
          <p className="eyebrow">Watch online</p>
          <h2 id="watch-title">Church wherever you are</h2>
          <p>
            Follow Apostle Chrispen Mahovo for sermons, live services and testimonies. Share them with someone who
            needs a touch from God today.
          </p>
        </div>
        <div className="watch-links">
          {social.youtube && (
            <a className="watch-link" href={social.youtube} target="_blank" rel="noopener">
              <span className="logo yt"><YoutubeIcon style={{ color: "#fff" }} /></span>
              <span><strong>YouTube</strong><span>Apostle Chrispen Mahovo</span></span>
              <ArrowIcon />
            </a>
          )}
          {social.facebook && (
            <a className="watch-link" href={social.facebook} target="_blank" rel="noopener">
              <span className="logo fb"><FacebookIcon style={{ color: "#fff" }} /></span>
              <span><strong>Facebook</strong><span>{social.facebook.replace(/^https?:\/\/(www\.|m\.)?/, "")}</span></span>
              <ArrowIcon />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

async function Prayer() {
  const settings = await getSettings();
  return (
    <section className="section" id="prayer" aria-labelledby="prayer-title">
      <div className="wrap prayer-grid">
        <div className="prayer-copy">
          <p className="eyebrow">We are praying with you</p>
          <h2 id="prayer-title">Send a prayer request</h2>
          <p>
            Whatever you are facing, sickness, family trouble, finances or a battle no one else knows about, you do not
            have to carry it alone. Our prayer team will stand with you.
          </p>
          <blockquote className="scripture">
            “Is any sick among you? let him call for the elders of the church; and let them pray over him, anointing
            him with oil in the name of the Lord.”<cite>James 5:14</cite>
          </blockquote>
        </div>
        <PrayerForm whatsapp={settings.whatsapp} phone={settings.phones[0] ?? ""} />
      </div>
    </section>
  );
}

function GiveBand() {
  return (
    <section className="give-band" aria-labelledby="give-title">
      <div className="wrap">
        <div>
          <p className="eyebrow" id="give-title">Tithes &amp; offerings</p>
          <blockquote className="scripture">
            “Bring ye all the tithes into the storehouse, that there may be meat in mine house, and prove me now
            herewith, saith the LORD of hosts, if I will not open you the windows of heaven, and pour you out a
            blessing.”<cite>Malachi 3:10</cite>
          </blockquote>
        </div>
        <div className="btns">
          <Link className="btn btn-gold" href="/give">Give an offering</Link>
          <Link className="btn btn-primary" href="/give?type=tithe">Pay your tithe</Link>
        </div>
      </div>
    </section>
  );
}
