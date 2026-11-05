import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap not-found">
      <p className="eyebrow">Page not found</p>
      <h1>We couldn&apos;t find that page</h1>
      <p className="lead">It may have moved, or the event may have ended. These links will help you find your way.</p>
      <div className="hero-actions">
        <Link className="btn btn-primary" href="/">Go to the home page</Link>
        <Link className="btn btn-ghost" href="/events">See upcoming events</Link>
      </div>
    </div>
  );
}
