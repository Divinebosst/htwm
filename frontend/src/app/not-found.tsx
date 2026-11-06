import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { SiteFooter, TopBar } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <TopBar />
      <SiteHeader />
      <main>
        <div className="wrap not-found">
          <p className="eyebrow">Page not found</p>
          <h1>We couldn&apos;t find that page</h1>
          <p className="lead">It may have moved, or the event may have ended. These links will help you find your way.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/">Go to the home page</Link>
            <Link className="btn btn-ghost" href="/events">See upcoming events</Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
