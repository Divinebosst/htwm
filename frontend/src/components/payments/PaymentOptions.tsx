"use client";

import Image from "next/image";
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useEffect, useRef, useState } from "react";
import type { GivingSettings } from "@/lib/api";
import { CheckIcon, CopyIcon, MobileIcon } from "../icons";

/*
  The "Payment method" box used by the giving page and the store checkout.

  - PayPal's own buttons (PayPal account, or a debit/credit card): the server
    creates and captures the order.
  - Mobile money through Paynow (EcoCash, InnBucks, O'mari, OneMoney): the
    payer approves on their phone and this box asks the server every few
    seconds until Paynow says it's paid.

  The server decides when something is paid; this box only reports what the
  server says.
*/

type Wallet = "ecocash" | "innbucks" | "omari" | "onemoney";

const WALLETS: { value: Wallet; name: string; logo: string; width: number; height: number; dark?: boolean; hint: string }[] = [
  { value: "ecocash", name: "EcoCash", logo: "/payments/ecocash.png", width: 116, height: 28,
    hint: "You'll get a pop-up on your phone asking for your EcoCash PIN." },
  { value: "innbucks", name: "InnBucks", logo: "/payments/innbucks.png", width: 360, height: 99, dark: true,
    hint: "You'll get a code to approve in the InnBucks app." },
  { value: "omari", name: "O'mari", logo: "/payments/omari.png", width: 360, height: 104,
    hint: "O'mari will send you a one-time code by SMS to enter here." },
  { value: "onemoney", name: "OneMoney", logo: "/payments/onemoney.png", width: 92, height: 58,
    hint: "You'll get a pop-up on your phone asking for your OneMoney PIN." },
];
const WALLET = Object.fromEntries(WALLETS.map((w) => [w.value, w])) as Record<Wallet, (typeof WALLETS)[number]>;

/** What the server says about a payment (a gift or a store order, plus these fields). */
export type PaymentResult = {
  id: string;
  payment: "pending" | "paid" | "failed";
  amount: string;
  currency: string;
  payment_label: string;
  next?: "approve" | "innbucks_code" | "omari_otp";
  instructions?: string;
  authorization_code?: string;
  authorization_expires?: string;
  deep_link?: string;
};

/** Where this box sends its requests. */
export type PaymentUrls = {
  paypalCreate: string;
  paypalCapture: (paypalOrderId: string) => string;
  mobileStart: string;
  otp: (id: string) => string;
  status: (id: string) => string;
};

type Phase =
  | { kind: "ready" }
  | { kind: "paypal"; step: "open" | "capturing" }
  | { kind: "starting" }
  | { kind: "mobile"; payment: PaymentResult; wallet: Wallet; phone: string; stage: "otp" | "waiting"; slow: boolean };

type Message = { tone: "error" | "info"; text: string } | null;

type Props = {
  giving: GivingSettings;
  /** Amount shown on the "Pay $X" buttons. */
  amount: number;
  /** "" when the form is ready to pay; otherwise what's missing, shown when they try to pay. */
  check: () => string;
  /** The form's details, sent with the request that starts a payment. */
  details: () => Record<string, unknown>;
  urls: PaymentUrls;
  /** Paid (or, rarely, PayPal still processing). */
  onComplete: (result: PaymentResult) => void;
  /** True while a payment is under way, so the form above can stop changes. */
  onBusyChange?: (busy: boolean) => void;
  /** "PayPal or card", "EcoCash", "Mobile money" or "Choose below", for a summary. */
  onMethodChange?: (label: string) => void;
  /** The server refused to start a payment (e.g. the cart changed). */
  onRefused?: (body: unknown) => void;
};

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
const POLL_EVERY_MS = 4000;
const POLL_FOR_MS = 3 * 60 * 1000;
const NOT_CHARGED = "The payment was cancelled or didn't go through, so nothing was charged. You can try again.";
const OFFLINE = "We couldn't reach the server. Check your connection and try again.";

export default function PaymentOptions(props: Props) {
  const { giving, amount, check, details, urls, onComplete, onBusyChange, onMethodChange, onRefused } = props;
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: giving.currency || "USD" });
  const [payWith, setPayWith] = useState<"paypal" | "mobile" | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phone, setPhone] = useState("");
  const [phase, setPhaseState] = useState<Phase>({ kind: "ready" });
  const [message, setMessage] = useState<Message>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  // The latest props, for the status checks that run on a timer
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const problem = check();
  const amountText = money.format(amount);
  const mobileOpen = payWith === "mobile";
  const locked = phase.kind !== "ready";

  function setPhase(next: Phase) {
    setPhaseState(next);
    onBusyChange?.(next.kind !== "ready");
  }

  function choose(nextPayWith: typeof payWith, nextWallet: Wallet | null) {
    setPayWith(nextPayWith);
    setWallet(nextWallet);
    onMethodChange?.(
      nextPayWith === "mobile" ? (nextWallet ? WALLET[nextWallet].name : "Mobile money")
        : nextPayWith === "paypal" ? "PayPal or card"
          : "Choose below",
    );
  }

  function finish(result: PaymentResult) {
    setPhase({ kind: "ready" });
    onComplete(result);
  }

  // While a mobile money payment waits for the payer to approve it, ask the server for news.
  const watching = phase.kind === "mobile" && phase.stage === "waiting" && !phase.slow ? phase.payment.id : null;
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();

    async function poll() {
      try {
        const res = await fetch(latest.current.urls.status(watching!), {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (res.ok && !stopped) {
          const result = (await res.json()) as PaymentResult;
          if (result.payment !== "pending") {
            setPhaseState({ kind: "ready" });
            latest.current.onBusyChange?.(false);
            if (result.payment === "paid") latest.current.onComplete(result);
            else setMessage({ tone: "error", text: NOT_CHARGED });
            return;
          }
        }
      } catch {
        // offline for a moment; try again on the next round
      }
      if (stopped) return;
      if (Date.now() - started > POLL_FOR_MS) {
        setPhaseState((p) => (p.kind === "mobile" ? { ...p, slow: true } : p));
        return;
      }
      timer = setTimeout(poll, POLL_EVERY_MS);
    }

    timer = setTimeout(poll, POLL_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching]);

  // ---------------------------------------------------------------- mobile money

  async function startMobile() {
    setMessage(null);
    if (problem) return setMessage({ tone: "error", text: problem });
    if (!wallet) return setMessage({ tone: "error", text: "Choose your wallet." });
    const number = zimbabweMobile(phone);
    if (!number) {
      return setMessage({ tone: "error", text: `Enter your ${WALLET[wallet].name} number, e.g. 0771 234 567.` });
    }

    setPhase({ kind: "starting" });
    try {
      const res = await fetch(urls.mobileStart, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...details(), provider: wallet, phone: number }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase({ kind: "ready" });
        setMessage({ tone: "error", text: apiError(body, "We couldn't start the payment. Please try again.") });
        onRefused?.(body);
        return;
      }
      const result = body as PaymentResult;
      setPhase({ kind: "mobile", payment: result, wallet, phone: number,
                 stage: result.next === "omari_otp" ? "otp" : "waiting", slow: false });
    } catch {
      setPhase({ kind: "ready" });
      setMessage({ tone: "error", text: OFFLINE });
    }
  }

  async function sendOtp(otp: string) {
    if (phase.kind !== "mobile") return;
    setMessage(null);
    setOtpBusy(true);
    try {
      const res = await fetch(urls.otp(phase.payment.id), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ otp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: apiError(body, "That code didn't work. Check the SMS and try again.") });
        return;
      }
      const result = body as PaymentResult;
      if (result.payment === "paid") finish(result);
      else if (result.payment === "failed") {
        setPhase({ kind: "ready" });
        setMessage({ tone: "error", text: NOT_CHARGED });
      } else setPhase({ ...phase, stage: "waiting" });
    } catch {
      setMessage({ tone: "error", text: OFFLINE });
    } finally {
      setOtpBusy(false);
    }
  }

  function stopWaiting() {
    setPhase({ kind: "ready" });
    setMessage({
      tone: "info",
      text: "Stopped waiting. If you already approved the payment it will still go through, so there's no need to pay again.",
    });
  }

  if (phase.kind === "mobile") {
    return (
      <>
        <MobileWait
          phase={phase}
          amountText={money.format(parseFloat(phase.payment.amount))}
          otpBusy={otpBusy}
          onOtp={sendOtp}
          onCheckAgain={() => setPhaseState({ ...phase, slow: false })}
          onStop={stopWaiting}
        />
        <Note message={message} />
      </>
    );
  }

  // ---------------------------------------------------------------- PayPal and the choices

  return (
    <>
      <div className="gv-paypal">
        {giving.paypal_client_id ? (
          <PayPalScriptProvider
            options={{
              clientId: giving.paypal_client_id,
              currency: giving.currency || "USD",
              intent: "capture",
              components: "buttons",
              disableFunding: "paylater,venmo,credit",
              environment: giving.paypal_mode === "live" ? "production" : "sandbox",
            }}
          >
            <PayPalArea>
              <PayPalButtons
                className="gv-paypal-buttons"
                style={{ layout: "vertical", color: "gold", label: "paypal", height: 48, borderRadius: 10 }}
                disabled={!!problem}
                onClick={(_data, actions) => {
                  const now = check();
                  if (now) {
                    setMessage({ tone: "error", text: now });
                    return actions.reject();
                  }
                  setMessage(null);
                  choose("paypal", null);
                  return actions.resolve();
                }}
                createOrder={async () => {
                  setPhase({ kind: "paypal", step: "open" });
                  const res = await fetch(urls.paypalCreate, {
                    method: "POST",
                    headers: JSON_HEADERS,
                    body: JSON.stringify(details()),
                  }).catch(() => null);
                  const body = res ? await res.json().catch(() => ({})) : {};
                  if (!res?.ok) {
                    const text = res ? apiError(body, "We couldn't start PayPal. Please try again.") : OFFLINE;
                    setPhase({ kind: "ready" });
                    setMessage({ tone: "error", text });
                    if (res) onRefused?.(body);
                    throw new Error(text);
                  }
                  return (body as { order_id: string }).order_id;
                }}
                onApprove={async (data, actions) => {
                  setPhase({ kind: "paypal", step: "capturing" });
                  try {
                    const res = await fetch(urls.paypalCapture(encodeURIComponent(data.orderID)), {
                      method: "POST",
                      headers: JSON_HEADERS,
                    });
                    const body = await res.json().catch(() => ({}));
                    if (res.status === 422 && body.code === "instrument_declined") {
                      setPhase({ kind: "paypal", step: "open" });
                      setMessage({ tone: "error", text: body.detail });
                      return actions.restart();
                    }
                    if (!res.ok || body.payment === "failed") {
                      setPhase({ kind: "ready" });
                      setMessage({ tone: "error", text: res.ok ? NOT_CHARGED : apiError(body, NOT_CHARGED) });
                      return;
                    }
                    finish(body as PaymentResult);
                  } catch {
                    setPhase({ kind: "ready" });
                    setMessage({
                      tone: "error",
                      text: "We couldn't confirm your payment. If PayPal shows it as paid, please don't pay again. Call the church office and we'll check.",
                    });
                  }
                }}
                onCancel={() => {
                  setPhase({ kind: "ready" });
                  setMessage({ tone: "info", text: "You closed PayPal before paying, so nothing was charged." });
                }}
                onError={() => {
                  setPhase({ kind: "ready" });
                  setMessage((m) => (m?.tone === "error" ? m : { tone: "error", text: "PayPal couldn't finish the payment. Please try again, or use mobile money." }));
                }}
              />
            </PayPalArea>
          </PayPalScriptProvider>
        ) : (
          <p className="gv-pay-off">PayPal and card payments are being set up. Please use mobile money for now.</p>
        )}
      </div>
      {phase.kind === "paypal" && phase.step === "capturing" && (
        <p className="gv-wait-line" role="status"><span className="gv-spinner" aria-hidden />Confirming your payment with PayPal…</p>
      )}

      <div className="gv-or" aria-hidden><span>or</span></div>

      <div className={`gv-mobile${mobileOpen ? " is-on" : ""}`}>
        <button
          type="button"
          className="gv-mobile-toggle"
          aria-expanded={mobileOpen}
          aria-controls="gv-mobile-body"
          disabled={!giving.mobile_money_enabled || locked}
          onClick={() => {
            setMessage(null);
            choose(mobileOpen ? null : "mobile", mobileOpen ? null : wallet);
          }}
        >
          <MobileIcon className="gv-mobile-icon" />
          <span className="gv-mobile-name">
            Mobile money
            <small>{!giving.mobile_money_enabled ? "Coming soon" : mobileOpen ? "Choose your wallet" : "Pay from your phone"}</small>
          </span>
          {!mobileOpen && (
            <span className="gv-mini-logos">
              <span className="sr-only">EcoCash, InnBucks, O&apos;mari or OneMoney</span>
              {WALLETS.map((w) => (
                <span key={w.value} className={`gv-mini${w.dark ? " is-dark" : ""}`}>
                  <Image src={w.logo} alt="" width={w.width} height={w.height} />
                </span>
              ))}
            </span>
          )}
          <span className="gv-chevron" aria-hidden />
        </button>

        {mobileOpen && (
          <div id="gv-mobile-body" className="gv-mobile-body">
            <div className="gv-wallets" role="radiogroup" aria-label="Choose your wallet">
              {WALLETS.map((w) => (
                <label key={w.value} className={`gv-wallet gv-wallet-${w.value}${w.dark ? " is-dark" : ""}`}>
                  <input type="radio" name="wallet" value={w.value} checked={wallet === w.value}
                    disabled={locked} onChange={() => { choose("mobile", w.value); setMessage(null); }} />
                  <Image src={w.logo} alt={w.name} width={w.width} height={w.height} />
                  <span className="gv-wallet-tick" aria-hidden><CheckIcon /></span>
                </label>
              ))}
            </div>

            {wallet ? (
              <>
                <div className="field">
                  <label htmlFor="gv-phone">Your {WALLET[wallet].name} number</label>
                  <input id="gv-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="0771 234 567"
                    value={phone} disabled={locked} onChange={(e) => setPhone(e.target.value)} />
                  <span className="hint">{WALLET[wallet].hint}</span>
                </div>
                <button type="button" className="gv-submit" onClick={startMobile} disabled={locked}>
                  {phase.kind === "starting" ? "Sending request…" : `Pay ${amountText} with ${WALLET[wallet].name}`}
                </button>
              </>
            ) : (
              <p className="gv-help">Tap your wallet to continue.</p>
            )}
          </div>
        )}
      </div>
      <Note message={message} />
    </>
  );
}

function Note({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p className={message.tone === "error" ? "sum-error" : "gv-info"} role={message.tone === "error" ? "alert" : "status"}>
      {message.text}
    </p>
  );
}

/** Shows a placeholder while PayPal's script loads, and a note if it can't load. */
function PayPalArea({ children }: { children: React.ReactNode }) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  if (isRejected) {
    return <p className="gv-pay-off">PayPal couldn&apos;t load. Check your connection and reload the page, or use mobile money.</p>;
  }
  return (
    <>
      {isPending && <div className="skeleton gv-paypal-loading" aria-label="Loading PayPal" />}
      {children}
    </>
  );
}

function MobileWait({ phase, amountText, otpBusy, onOtp, onCheckAgain, onStop }: {
  phase: Extract<Phase, { kind: "mobile" }>;
  amountText: string;
  otpBusy: boolean;
  onOtp: (otp: string) => void;
  onCheckAgain: () => void;
  onStop: () => void;
}) {
  const [otp, setOtp] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const w = WALLET[phase.wallet];
  const { payment } = phase;
  const expires = payment.authorization_expires ? new Date(payment.authorization_expires.replace(" ", "T")) : null;

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase.stage]);

  let title = "Check your phone";
  let body = (
    <p>
      We sent a payment request for <strong>{amountText}</strong> to <strong>{formatPhone(phase.phone)}</strong>. Enter
      your {w.name} PIN when it pops up to approve it.
    </p>
  );
  if (phase.wallet === "innbucks") {
    title = "Approve in InnBucks";
    body = (
      <>
        <p>
          Open the InnBucks app, choose <strong>Pay</strong> and enter this code to pay <strong>{amountText}</strong>.
        </p>
        {payment.authorization_code && (
          <div className="gv-code">
            <span className="mono">{payment.authorization_code}</span>
            <CopyButton text={payment.authorization_code} />
          </div>
        )}
        {expires && !Number.isNaN(expires.getTime()) && (
          <p className="gv-help">Use it before {expires.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
        )}
        {payment.deep_link && (
          <a className="gv-submit gv-submit-dark gv-app-link" href={payment.deep_link}>Open the InnBucks app</a>
        )}
      </>
    );
  }
  if (phase.wallet === "omari" && phase.stage === "otp") {
    title = "Enter your O'mari code";
    body = (
      <form
        className="gv-otp"
        onSubmit={(e) => {
          e.preventDefault();
          onOtp(otp.trim());
        }}
      >
        <p>
          O&apos;mari sent a one-time code by SMS to <strong>{formatPhone(phase.phone)}</strong>. Enter it to pay{" "}
          <strong>{amountText}</strong>.
        </p>
        <div className="field">
          <label htmlFor="gv-otp">Code from the SMS</label>
          <input id="gv-otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
            value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
        </div>
        <button type="submit" className="gv-submit" disabled={otpBusy || otp.length < 4}>
          {otpBusy ? "Checking…" : `Pay ${amountText}`}
        </button>
      </form>
    );
  }

  return (
    <div className="gv-wait">
      <div className="gv-wait-head">
        <span className={`gv-wait-logo${w.dark ? " is-dark" : ""}`}>
          <Image src={w.logo} alt={w.name} width={w.width} height={w.height} />
        </span>
        <h3 ref={headingRef} tabIndex={-1}>{title}</h3>
      </div>
      {body}
      {payment.instructions && phase.wallet !== "omari" && <p className="gv-help">{payment.instructions}</p>}

      {phase.stage === "waiting" && (
        phase.slow ? (
          <div className="gv-slow" role="status">
            <p>
              This is taking longer than usual. If you&apos;ve approved the payment, it will show here as soon as {w.name}{" "}
              confirms it.
            </p>
            <div className="gv-slow-actions">
              <button type="button" className="gv-submit" onClick={onCheckAgain}>Check again</button>
            </div>
          </div>
        ) : (
          <p className="gv-wait-line" role="status">
            <span className="gv-spinner" aria-hidden />
            Waiting for {w.name} to confirm…
          </p>
        )
      )}

      <button type="button" className="gv-link" onClick={onStop}>Cancel and choose another way</button>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    setState(ok ? "ok" : "fail");
    setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button className={`copy-btn${state === "ok" ? " done" : ""}`} type="button" onClick={copy} aria-label={`Copy ${text}`}>
      {state === "idle" && <><CopyIcon />Copy</>}
      {state === "ok" && "Copied"}
      {state === "fail" && "Copy failed"}
    </button>
  );
}

/** Same rule as the server: 0771 234 567, +263 77 123 4567 or 263771234567 -> 0771234567 */
function zimbabweMobile(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("263") && digits.length === 12) digits = "0" + digits.slice(3);
  return /^07\d{8}$/.test(digits) ? digits : "";
}

function formatPhone(digits: string) {
  return digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : digits;
}

/** The server's error message: {"detail": "..."} or {"field": ["..."]}. */
export function apiError(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string" && b.detail) return b.detail;
    for (const value of Object.values(b)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}
