"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import logo from "@/assets/logo.png";
import { CloseIcon, MenuIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/#about", label: "About" },
  { href: "/events", label: "Events" },
  { href: "/#services", label: "Services" },
  { href: "/#prayer", label: "Prayer" },
  { href: "#contact", label: "Contact" },
];

export function Brand() {
  return (
    <>
      <span className="brand-badge">
        <Image src={logo} alt="" width={52} priority />
      </span>
      <span className="brand-text">
        <span className="brand-name">Heal The World</span>
        <span className="brand-sub">Ministries International</span>
      </span>
    </>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : !href.includes("#") && pathname.startsWith(href);

  return (
    <header className="site-header">
      <div className="wrap">
        <Link className="brand" href="/" aria-label="Heal The World Ministries International, home">
          <Brand />
        </Link>
        <button
          className="nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="site-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
        <nav className={`nav${open ? " open" : ""}`} id="site-nav" aria-label="Main" onClick={() => setOpen(false)}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
          <Link className="btn btn-gold" href="/give" aria-current={pathname === "/give" ? "page" : undefined}>
            Give
          </Link>
        </nav>
      </div>
    </header>
  );
}
