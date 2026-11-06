"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import logo from "@/assets/logo.png";
import {
  CalendarIcon,
  ClockIcon,
  DashboardIcon,
  ExternalIcon,
  GiftIcon,
  LogIcon,
  MenuIcon,
  CloseIcon,
  PrayerIcon,
  SettingsIcon,
  SignOutIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { useAuth } from "./auth";
import { Loading, ToastProvider } from "./ui";

export const NAV = [
  { href: "/admin", label: "Dashboard", perm: "dashboard.view", Icon: DashboardIcon },
  { href: "/admin/events", label: "Events", perm: "events.edit", Icon: CalendarIcon },
  { href: "/admin/services", label: "Service times", perm: "services.edit", Icon: ClockIcon },
  { href: "/admin/prayer", label: "Prayer requests", perm: "prayer.view", Icon: PrayerIcon },
  { href: "/admin/gifts", label: "Gifts", perm: "gifts.view", Icon: GiftIcon },
  { href: "/admin/giving", label: "Giving categories", perm: "giving.edit", Icon: TagIcon },
  { href: "/admin/settings", label: "Church settings", perm: "settings.view", Icon: SettingsIcon },
  { href: "/admin/users", label: "Staff accounts", perm: "users.view", Icon: UsersIcon },
  { href: "/admin/audit", label: "Audit log", perm: "audit.view", Icon: LogIcon },
];

const ROLE_TONE: Record<string, string> = {
  system_admin: "adm-role-system",
  admin: "adm-role-admin",
  pastor: "adm-role-pastor",
  caretaker: "adm-role-caretaker",
};

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { state, me, can, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const mustChange = !!me?.must_change_password;
  useEffect(() => {
    if (state.status === "signed-out") router.replace("/admin/login");
    else if (mustChange && pathname !== "/admin/account") router.replace("/admin/account");
  }, [state.status, mustChange, pathname, router]);

  if (state.status !== "signed-in" || !me) {
    return (
      <div className="adm-splash">
        <Loading label={state.status === "signed-out" ? "Taking you to sign in…" : "Loading the church admin…"} />
      </div>
    );
  }

  const items = mustChange ? [] : NAV.filter((n) => can(n.perm));
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <ToastProvider>
      <div className={`adm-app${menuOpen ? " menu-open" : ""}`}>
        <aside className="adm-side" aria-label="Admin menu">
          <div className="adm-side-head">
            <Link href="/admin" className="adm-brand" onClick={() => setMenuOpen(false)}>
              <span className="adm-brand-badge"><Image src={logo} alt="" width={40} /></span>
              <span>
                <strong>Heal The World</strong>
                <small>Church admin</small>
              </span>
            </Link>
            <button type="button" className="adm-menu-btn" aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
          <nav className="adm-nav" onClick={() => setMenuOpen(false)}>
            {items.map(({ href, label, Icon }) => (
              <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}>
                <Icon /> {label}
              </Link>
            ))}
            <Link href="/admin/account" aria-current={pathname === "/admin/account" ? "page" : undefined}>
              <UserIcon /> My account
            </Link>
            <a href="/" target="_blank" rel="noopener" className="adm-nav-muted">
              <ExternalIcon /> View website
            </a>
          </nav>
          <div className="adm-side-user">
            <div>
              <strong>{me.full_name}</strong>
              <span className={`adm-role ${ROLE_TONE[me.role] ?? ""}`}>{me.role_label}</span>
            </div>
            <button type="button" className="adm-signout" onClick={() => signOut()}>
              <SignOutIcon /> Sign out
            </button>
          </div>
        </aside>
        <main className="adm-main">{children}</main>
      </div>
    </ToastProvider>
  );
}
