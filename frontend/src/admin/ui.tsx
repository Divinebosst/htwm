"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";
import type { ApiError } from "./api";

/* ---------- Page header ---------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="adm-page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="adm-actions">{actions}</div>}
    </header>
  );
}

/* ---------- Status badge ---------- */

export type Tone = "ok" | "warn" | "bad" | "info" | "muted" | "violet";

export function Pill({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`adm-pill adm-pill-${tone}`}>{children}</span>;
}

/* ---------- Loading, empty and error states ---------- */

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="adm-loading" role="status">
      <span className="adm-spinner" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="adm-empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div className="adm-error" role="alert">
      <p>{error.message}</p>
      {onRetry && (
        <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="adm-empty">
      <h3>You don&apos;t have access to this page</h3>
      <p>Ask a System Admin if you need it for your work.</p>
    </div>
  );
}

/* ---------- Side panel ---------- */

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const first = panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.adm-drawer-close)");
    first?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="adm-drawer-wrap">
      <div className="adm-drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="adm-drawer" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="adm-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="adm-drawer-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="adm-drawer-body">{children}</div>
        {footer && <div className="adm-drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Form field ---------- */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  full,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="adm-field-error">{error}</span>}
    </div>
  );
}

/* ---------- Two-step confirmation (no pop-up dialogs) ---------- */

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  danger,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={`adm-btn ${danger ? "adm-btn-danger-ghost" : "adm-btn-ghost"}`}
        onClick={() => setAsking(true)} disabled={disabled}>
        {label}
      </button>
    );
  }
  return (
    <span className="adm-confirm">
      <button
        type="button"
        className={`adm-btn ${danger ? "adm-btn-danger" : "adm-btn-primary"}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? "Working…" : confirmLabel}
      </button>
      <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setAsking(false)} disabled={busy}>
        Cancel
      </button>
    </span>
  );
}

/* ---------- Pages of results ---------- */

export function Pager({ page, pages, count, onPage }: { page: number; pages: number; count: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <p className="adm-count">{count} {count === 1 ? "item" : "items"}</p>;
  return (
    <nav className="adm-pager" aria-label="Pages">
      <span className="adm-count">{count} items · page {page} of {pages}</span>
      <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

/* ---------- Toasts ---------- */

type Toast = { id: number; text: string; tone: "ok" | "bad" };
const ToastContext = createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="adm-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`adm-toast adm-toast-${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------- Copyable secret (temporary passwords) ---------- */

export function SecretBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="adm-secret">
      <span className="adm-secret-label">{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className="adm-btn adm-btn-ghost adm-btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
