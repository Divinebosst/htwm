"use client";

import Image from "next/image";
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useEffect, useRef, useState } from "react";
import logo from "@/assets/logo.png";
import type { GivingCategory, GivingSettings } from "@/lib/api";
import { buildReference } from "@/lib/format";
import { CheckIcon, CopyIcon, MobileIcon, ShieldIcon } from "./icons";

/*
  Giving page form. Payments are confirmed automatically:
  - PayPal (and cards through PayPal): the server creates and captures the order.
  - Mobile money through Paynow: the giver approves on their phone and this page
    checks with the server every few seconds until Paynow says it's paid.
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

/** What the server sends back about a payment. */
type Payment = {
  id: string;
  status: "pending" | "received" | "failed" | "not_found";
  amount: string;
  currency: string;
  reference: string;
  label: string;
  payment_label: string;
  gift_number: number;
  next?: "approve" | "innbucks_code" | "omari_otp";
  instructions?: string;
  authorization_code?: string;
  authorization_expires?: string;
  deep_link?: string;
};

type Phase =
  | { kind: "form" }
  | { kind: "paypal"; step: "open" | "capturing" }
  | { kind: "starting" }
  | { kind: "mobile"; payment: Payment; wallet: Wallet; phone: string; stage: "otp" | "waiting"; slow: boolean }
  | { kind: "done"; payment: Payment };

type Message = { tone: "error" | "info"; text: string } | null;

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
const POLL_EVERY_MS = 4000;
const POLL_FOR_MS = 3 * 60 * 1000;
const NOT_CHARGED = "The payment was cancelled or didn't go through, so nothing was charged. You can try again.";

type Props = {
  giving: GivingSettings;
  churchName: string;
  categories: GivingCategory[];
  initialType: string;
};

export default function GiveForm({ giving, churchName, categories, initialType }: Props) {
  const presets = giving.preset_amounts;
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: giving.currency || "USD" });
  const symbol = money.formatToParts(0).find((p) => p.type === "currency")?.value ?? "$";

  const [typeKey, setTypeKey] = useState(initialType);
  const [amountInput, setAmountInput] = useState(presets.includes(50) ? "50" : "");
  const [showTithe, setShowTithe] = useState(false);
  const [income, setIncome] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [payWith, setPayWith] = useState<"paypal" | "mobile" | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [message, setMessage] = useState<Message>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const category = categories.find((c) => c.key === typeKey) ?? categories[0];
  const parsed = parseFloat(amountInput);
  const amount = parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const reference = category ? buildReference(category.reference_code, name, anonymous) : "";
  const typeLabel = category?.asks_purpose ? (purpose ? `Gift: ${purpose}` : "Gift") : (category?.label ?? "Gift");
  const amountText = amount > 0 ? money.format(amount) : "";
  const incomeValue = parseFloat(income);
  const tithe = incomeValue > 0 ? Math.round(incomeValue * 10) / 100 : 0;
  const mobileOpen = payWith === "mobile";
  const locked = phase.kind !== "form";

  // Move focus to the thank-you message so it's seen (and read out) straight away.
  useEffect(() => {
    if (phase.kind === "done") doneRef.current?.focus();
  }, [phase.kind]);

  // While a mobile money payment waits for the giver to approve it, ask the server for news.
  const watching = phase.kind === "mobile" && phase.stage === "waiting" && !phase.slow ? phase.payment.id : null;
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();

    async function check() {
      try {
        const res = await fetch(`/api/payments/${watching}`, { headers: { Accept: "application/json" }, cache: "no-store" });
        if (res.ok && !stopped) {
          const payment = (await res.json()) as Payment;
          if (payment.status === "received") {
            setPhase({ kind: "done", payment });
            return;
          }
          if (payment.status === "failed") {
            setPhase({ kind: "form" });
            setMessage({ tone: "error", text: NOT_CHARGED });
            return;
          }
        }
      } catch {
        // offline for a moment; try again on the next round
      }
      if (stopped) return;
      if (Date.now() - started > POLL_FOR_MS) {
        setPhase((p) => (p.kind === "mobile" ? { ...p, slow: true } : p));
        return;
      }
      timer = setTimeout(check, POLL_EVERY_MS);
    }

    timer = setTimeout(check, POLL_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching]);

  if (!category) {
    return <p className="lead">Online giving is being set up. Please give in person at any service for now.</p>;
  }

  function details() {
    return {
      category: category.key,
      amount: amount.toFixed(2),
      giver_name: anonymous ? "" : name.trim(),
      giver_contact: contact.trim(),
      anonymous,
      purpose: category.asks_purpose ? purpose.trim() : "",
    };
  }

  function amountProblem() {
    if (!(amount >= 1)) return `Enter an amount of at least ${money.format(1)}.`;
    if (amount > 1_000_000) return "For gifts this large, please contact the church office.";
    return "";
  }

  // ---------------------------------------------------------------- mobile money

  async function startMobile() {
    setMessage(null);
    const problem = amountProblem();
    if (problem) return setMessage({ tone: "error", text: problem });
    if (!wallet) return setMessage({ tone: "error", text: "Choose your wallet." });
    const number = zimbabweMobile(phone);
    if (!number) {
      return setMessage({ tone: "error", text: `Enter your ${WALLET[wallet].name} number, e.g. 0771 234 567.` });
    }

    setPhase({ kind: "starting" });
    try {
      const res = await fetch("/api/payments/mobile", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...details(), provider: wallet, phone: number }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase({ kind: "form" });
        setMessage({ tone: "error", text: apiError(body, "We couldn't start the payment. Please try again.") });
        return;
      }
      const payment = body as Payment;
      setPhase({
        kind: "mobile",
        payment,
        wallet,
        phone: number,
        stage: payment.next === "omari_otp" ? "otp" : "waiting",
        slow: false,
      });
    } catch {
      setPhase({ kind: "form" });
      setMessage({ tone: "error", text: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  async function sendOtp(otp: string) {
    if (phase.kind !== "mobile") return;
    setMessage(null);
    setOtpBusy(true);
    try {
      const res = await fetch(`/api/payments/mobile/${phase.payment.id}/otp`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ otp }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: apiError(body, "That code didn't work. Check the SMS and try again.") });
        return;
      }
      const payment = body as Payment;
      if (payment.status === "received") setPhase({ kind: "done", payment });
      else if (payment.status === "failed") {
        setPhase({ kind: "form" });
        setMessage({ tone: "error", text: NOT_CHARGED });
      } else setPhase({ ...phase, stage: "waiting" });
    } catch {
      setMessage({ tone: "error", text: "We couldn't reach the server. Check your connection and try again." });
    } finally {
      setOtpBusy(false);
    }
  }

  function stopWaiting() {
    setPhase({ kind: "form" });
    setMessage({
      tone: "info",
      text: "Stopped waiting. If you already approved the payment it will still be received, so there's no need to pay again.",
    });
  }

  // ---------------------------------------------------------------- PayPal

  const paypal = giving.paypal_client_id ? (
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
          disabled={amount < 1}
          onClick={(_data, actions) => {
            const problem = amountProblem();
            if (problem) {
              setMessage({ tone: "error", text: problem });
              return actions.reject();
            }
            setMessage(null);
            setPayWith("paypal");
            return actions.resolve();
          }}
          createOrder={async () => {
            setPhase({ kind: "paypal", step: "open" });
            const res = await fetch("/api/payments/paypal/orders", {
              method: "POST",
              headers: JSON_HEADERS,
              body: JSON.stringify(details()),
            }).catch(() => null);
            const body = res ? await res.json().catch(() => ({})) : {};
            if (!res?.ok) {
              const text = apiError(body, "We couldn't start PayPal. Please try again.");
              setPhase({ kind: "form" });
              setMessage({ tone: "error", text });
              throw new Error(text);
            }
            return (body as { order_id: string }).order_id;
          }}
          onApprove={async (data, actions) => {
            setPhase({ kind: "paypal", step: "capturing" });
            try {
              const res = await fetch(`/api/payments/paypal/orders/${encodeURIComponent(data.orderID)}/capture`, {
                method: "POST",
                headers: JSON_HEADERS,
              });
              const body = await res.json().catch(() => ({}));
              if (res.status === 422 && body.code === "instrument_declined") {
                setPhase({ kind: "paypal", step: "open" });
                setMessage({ tone: "error", text: body.detail });
                return actions.restart();
              }
              if (!res.ok || body.status === "failed") {
                setPhase({ kind: "form" });
                setMessage({ tone: "error", text: res.ok ? NOT_CHARGED : apiError(body, NOT_CHARGED) });
                return;
              }
              setPhase({ kind: "done", payment: body as Payment });
            } catch {
              setPhase({ kind: "form" });
              setMessage({
                tone: "error",
                text: "We couldn't confirm your payment. If PayPal shows it as paid, please don't pay again. Call the church office and we'll check.",
              });
            }
          }}
          onCancel={() => {
            setPhase({ kind: "form" });
            setMessage({ tone: "info", text: "You closed PayPal before paying, so nothing was charged." });
          }}
          onError={() => {
            setPhase({ kind: "form" });
            setMessage((m) => (m?.tone === "error" ? m : { tone: "error", text: "PayPal couldn't finish the payment. Please try again, or use mobile money." }));
          }}
        />
      </PayPalArea>
    </PayPalScriptProvider>
  ) : (
    <p className="gv-pay-off">PayPal and card giving is being set up. Please use mobile money for now.</p>
  );

  // ---------------------------------------------------------------- page

  const doneAmount = phase.kind === "done" ? money.format(parseFloat(phase.payment.amount)) : "";
  const firstName = anonymous ? "" : name.trim().split(/\s+/)[0] || "";
  const payingBy =
    phase.kind === "mobile" ? WALLET[phase.wallet].name
      : payWith === "mobile" ? (wallet ? WALLET[wallet].name : "Mobile money")
        : payWith === "paypal" ? "PayPal or card"
          : "Choose below";

  return (
    <div className="gv-layout">
      {phase.kind === "done" ? (
        <div className="gv-card gv-done" aria-live="polite">
          <span className="gv-done-icon"><CheckIcon /></span>
          {phase.payment.status === "received" ? (
            <>
              <h2 ref={doneRef} tabIndex={-1}>{firstName ? `Thank you, ${firstName}!` : "Thank you!"}</h2>
              <p className="gv-done-lead">
                We&apos;ve received your {giftWords(phase.payment.label)} of <strong>{doneAmount}</strong>. God bless you.
              </p>
            </>
          ) : (
            <>
              <h2 ref={doneRef} tabIndex={-1}>Almost there</h2>
              <p className="gv-done-lead">
                PayPal is still processing your {giftWords(phase.payment.label)} of <strong>{doneAmount}</strong>. It will be
                recorded as soon as PayPal completes it, so there&apos;s no need to pay again.
              </p>
            </>
          )}
          <dl className="details">
            <div><dt>Gift number</dt><dd>{phase.payment.gift_number}</dd><span /></div>
            <div><dt>Paid with</dt><dd>{phase.payment.payment_label}</dd><span /></div>
            <div><dt>Reference</dt><dd className="mono">{phase.payment.reference}</dd><span /></div>
          </dl>
          <p className="gv-help">
            {phase.payment.payment_label.startsWith("Mobile")
              ? "Your wallet will also send you a confirmation SMS."
              : "PayPal will email you a receipt."}
          </p>
          <button
            type="button"
            className="gv-submit"
            onClick={() => {
              setPhase({ kind: "form" });
              setMessage(null);
              setPayWith(null);
            }}
          >
            Give again
          </button>
          <blockquote className="scripture">
            “Give, and it shall be given unto you; good measure, pressed down, and shaken together, and running over.”
            <cite>Luke 6:38</cite>
          </blockquote>
        </div>
      ) : (
        <form className="gv-card" onSubmit={(e) => e.preventDefault()} noValidate>
          <div className="gv-intro">
            <span className="gv-thumb"><Image src={logo} alt="" width={56} /></span>
            <p>
              You&apos;re giving to <strong>{churchName}</strong>
              <span>Omega Family Church</span>
            </p>
          </div>

          <fieldset className="gv-lock" disabled={locked}>
            {/* What */}
            <section className="gv-section" aria-labelledby="gv-what">
              <h2 id="gv-what"><label htmlFor="gv-type">What are you giving?</label></h2>
              <select id="gv-type" value={category.key} onChange={(e) => setTypeKey(e.target.value)}>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              {category.description && <p className="gv-help">{category.description}</p>}

              {category.key === "tithe" && (
                showTithe ? (
                  <div className="gv-tithe">
                    <label htmlFor="gv-income">Your income for this period</label>
                    <div className="gv-tithe-row">
                      <input id="gv-income" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                        value={income} onChange={(e) => setIncome(e.target.value)} />
                      <span aria-live="polite">Tithe (10%): <strong>{money.format(tithe)}</strong></span>
                      <button type="button" className="gv-link" disabled={!tithe} onClick={() => setAmountInput(tithe.toFixed(2))}>
                        Use this amount
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="gv-link" onClick={() => setShowTithe(true)}>Work out my tithe</button>
                )
              )}

              {category.asks_purpose && (
                <div className="field">
                  <label htmlFor="gv-purpose">What is this gift for?</label>
                  <input id="gv-purpose" type="text" maxLength={140} placeholder="e.g. Youth conference"
                    value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                </div>
              )}
            </section>

            {/* How much */}
            <section className="gv-section" aria-labelledby="gv-amount-title">
              <h2 id="gv-amount-title">Enter your gift</h2>
              <div className="gv-presets">
                {presets.map((a) => (
                  <button key={a} type="button" className="gv-preset" aria-pressed={amount === a}
                    onClick={() => setAmountInput(String(a))}>
                    {symbol}{a}
                  </button>
                ))}
              </div>
              <label className="gv-amount" htmlFor="gv-amount">
                <span className="gv-cur"><strong>{symbol}</strong><small>{giving.currency}</small></span>
                <span className="sr-only">Amount in {giving.currency}</span>
                <input id="gv-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))} />
                {amountInput && !amountInput.includes(".") && <span className="gv-cents" aria-hidden>.00</span>}
              </label>
              <p className="gv-help">Minimum {money.format(1)}. All gifts are in {giving.currency}.</p>
            </section>

            {/* Who */}
            <section className="gv-section" aria-labelledby="gv-who">
              <h2 id="gv-who">Your details</h2>
              <div className="field">
                <label htmlFor="gv-name">Your name</label>
                <input id="gv-name" type="text" autoComplete="name" placeholder="e.g. Tendai Moyo" value={name}
                  disabled={anonymous} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="gv-contact">Phone or email <span className="hint">(optional)</span></label>
                <input id="gv-contact" type="text" autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <label className="check" htmlFor="gv-anon">
                <input id="gv-anon" type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                <span>Give anonymously. Your name won&apos;t be recorded with this gift.</span>
              </label>
            </section>
          </fieldset>

          {/* How */}
          <section className="gv-section" aria-labelledby="gv-pay-title">
            <h2 id="gv-pay-title">Payment method</h2>

            {phase.kind === "mobile" ? (
              <MobileWait
                phase={phase}
                amountText={money.format(parseFloat(phase.payment.amount))}
                otpBusy={otpBusy}
                onOtp={sendOtp}
                onCheckAgain={() => setPhase({ ...phase, slow: false })}
                onStop={stopWaiting}
              />
            ) : (
              <>
                <div className="gv-paypal">{paypal}</div>
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
                      setPayWith(mobileOpen ? null : "mobile");
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
                              disabled={locked} onChange={() => { setWallet(w.value); setMessage(null); }} />
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
                            {phase.kind === "starting"
                              ? "Sending request…"
                              : `Pay ${amountText || money.format(0)} with ${WALLET[wallet].name}`}
                          </button>
                        </>
                      ) : (
                        <p className="gv-help">Tap your wallet to continue.</p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {message && (
              <p className={message.tone === "error" ? "sum-error" : "gv-info"} role={message.tone === "error" ? "alert" : "status"}>
                {message.text}
              </p>
            )}
          </section>
        </form>
      )}

      {/* Summary */}
      <aside className="summary" aria-label="Your gift">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">Your gift</p>
            {phase.kind === "done" ? (
              <>
                <p className="sum-amount">{doneAmount}</p>
                <p className="sum-type">{phase.payment.label}</p>
              </>
            ) : (
              <>
                <p className={`sum-amount${amount > 0 ? "" : " empty"}`}>{amount > 0 ? amountText : "Choose an amount"}</p>
                <p className="sum-type">{typeLabel}</p>
              </>
            )}
          </div>
          <div className="summary-body">
            {phase.kind === "done" ? (
              <dl className="sum-list">
                <div>
                  <dt>Status</dt>
                  <dd className={phase.payment.status === "received" ? "sum-ok" : ""}>
                    {phase.payment.status === "received" ? <><CheckIcon /> Received</> : "Processing"}
                  </dd>
                </div>
                <div><dt>Paid with</dt><dd>{phase.payment.payment_label}</dd></div>
                <div><dt>Gift number</dt><dd>{phase.payment.gift_number}</dd></div>
              </dl>
            ) : (
              <dl className="sum-list">
                <div><dt>Paying by</dt><dd>{payingBy}</dd></div>
                <div className="ref-row"><dt>Reference</dt><dd><span className="ref-code">{reference}</span></dd></div>
              </dl>
            )}
            <p className="safe-note">
              <ShieldIcon />
              <span>
                Payments go through PayPal and Paynow&apos;s secure checkouts and are confirmed automatically. The church
                never sees your card details or PIN.
              </span>
            </p>
          </div>
        </div>
        <div className="summary-verse">
          <blockquote className="scripture">
            “Honour the LORD with thy substance, and with the firstfruits of all thine increase.”<cite>Proverbs 3:9</cite>
          </blockquote>
        </div>
      </aside>
    </div>
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
          Open the InnBucks app, choose <strong>Pay</strong> and enter this code to give <strong>{amountText}</strong>.
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

function CopyButton({ text }: { text: string }) {
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

/** "Tithe" -> "tithe", "Gift: Youth conference" -> "gift for Youth conference" */
function giftWords(label: string) {
  return label.startsWith("Gift: ") ? `gift for ${label.slice(6)}` : label.toLowerCase();
}

function formatPhone(digits: string) {
  return digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : digits;
}

/** The server's error message: {"detail": "..."} or {"field": ["..."]}. */
function apiError(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string" && b.detail) return b.detail;
    for (const value of Object.values(b)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}
