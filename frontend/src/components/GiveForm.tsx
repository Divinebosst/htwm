"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo from "@/assets/logo.png";
import type { GivingCategory, GivingSettings } from "@/lib/api";
import { buildReference, whatsappUrl } from "@/lib/format";
import { BankIcon, CardIcon, ChatIcon, CopyIcon, GlobeIcon, MobileIcon, ShieldIcon } from "./icons";

type Method = "ecocash" | "bank" | "card" | "abroad";

const METHODS: { value: Method; label: string; Icon: typeof BankIcon; about: (g: GivingSettings) => string }[] = [
  { value: "ecocash", label: "EcoCash", Icon: MobileIcon, about: (g) => `Pay from your EcoCash wallet in ${g.currency}.` },
  { value: "bank", label: "Bank transfer", Icon: BankIcon, about: () => "Send from your bank account or banking app." },
  {
    value: "card",
    label: "Card or PayPal",
    Icon: CardIcon,
    about: (g) => (g.online_giving_url ? "Pay on a secure online payment page." : "Coming soon."),
  },
  {
    value: "abroad",
    label: "From abroad",
    Icon: GlobeIcon,
    about: (g) => (g.abroad.services.length ? `${g.abroad.services.join(", ")}.` : "Send through a money transfer service."),
  },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<Method, string>;

type SavedGift = { id: number; reference: string };
type Phase = { kind: "form" } | { kind: "sending" } | { kind: "done"; gift: SavedGift | null };

type Props = {
  giving: GivingSettings;
  whatsapp: string;
  shortName: string;
  churchName: string;
  categories: GivingCategory[];
  initialType: string;
};

export default function GiveForm({ giving, whatsapp, shortName, churchName, categories, initialType }: Props) {
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
  const [method, setMethod] = useState<Method>("ecocash");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState("");
  const thanksRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase.kind === "done") thanksRef.current?.focus();
  }, [phase.kind]);

  const category = categories.find((c) => c.key === typeKey) ?? categories[0];
  const parsed = parseFloat(amountInput);
  const amount = parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const reference = category ? buildReference(category.reference_code, name, anonymous) : "";
  const typeLabel = category?.asks_purpose ? (purpose ? `Gift: ${purpose}` : "Gift") : (category?.label ?? "Gift");
  const amountText = amount > 0 ? money.format(amount) : "";
  const incomeValue = parseFloat(income);
  const tithe = incomeValue > 0 ? Math.round(incomeValue * 10) / 100 : 0;

  if (!category) {
    return <p className="lead">Online giving is being set up. Please give in person at any service for now.</p>;
  }

  async function confirm() {
    setError("");
    if (!(amount >= 1)) {
      setError(`Enter an amount of at least ${money.format(1)}.`);
      return;
    }
    if (method === "card" && !giving.online_giving_url) {
      setError("Card giving isn't available yet. Please choose EcoCash, bank transfer or From abroad.");
      return;
    }
    setPhase({ kind: "sending" });
    let gift: SavedGift | null = null;
    try {
      const res = await fetch("/api/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          category: category.key,
          amount: amount.toFixed(2),
          method,
          giver_name: anonymous ? "" : name.trim(),
          giver_contact: contact.trim(),
          anonymous,
          purpose: category.asks_purpose ? purpose.trim() : "",
        }),
      });
      if (res.ok) gift = await res.json();
    } catch {
      gift = null;
    }
    setPhase({ kind: "done", gift });
  }

  const firstName = anonymous ? "" : name.trim().split(/\s+/)[0] || "";
  const proofMessage =
    phase.kind === "done"
      ? [
          `Hello, I have sent my ${typeLabel.toLowerCase()} to ${shortName}.`,
          `Amount: ${amountText}`,
          `Paid by: ${METHOD_LABEL[method]}`,
          `Reference: ${phase.gift?.reference ?? reference}`,
          phase.gift ? `Website gift number: ${phase.gift.id}` : "",
          `Name: ${anonymous ? "Anonymous" : name.trim() || "Not given"}`,
          contact.trim() ? `Contact: ${contact.trim()}` : "",
          "",
          "My proof of payment is attached.",
        ]
          .filter((l, i, all) => l !== "" || i === all.length - 2)
          .join("\n")
      : "";

  return (
    <div className="gv-layout">
      <form className="gv-card" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="gv-intro">
          <span className="gv-thumb"><Image src={logo} alt="" width={56} /></span>
          <p>
            You&apos;re giving to <strong>{churchName}</strong>
            <span>Omega Family Church</span>
          </p>
        </div>

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

        {/* How */}
        <section className="gv-section" aria-labelledby="gv-method-title">
          <h2 id="gv-method-title">Payment method</h2>
          <div className="gv-methods" role="radiogroup" aria-labelledby="gv-method-title">
            {METHODS.map(({ value, label, Icon, about }) => (
              <div key={value} className={`gv-method${method === value ? " is-on" : ""}`}>
                <label>
                  <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                  <Icon className="gv-method-icon" />
                  <span className="gv-method-name">{label}</span>
                  <span className="gv-method-about">{about(giving)}</span>
                </label>
                {method === value && (
                  <div className="gv-method-body">
                    <MethodPanel method={value} giving={giving} amountText={amountText} reference={reference} />
                  </div>
                )}
              </div>
            ))}
          </div>
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
            <label htmlFor="gv-contact">Phone or email for your receipt <span className="hint">(optional)</span></label>
            <input id="gv-contact" type="text" autoComplete="tel" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <label className="check" htmlFor="gv-anon">
            <input id="gv-anon" type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span>Give anonymously. Your name won&apos;t appear on the payment reference.</span>
          </label>
        </section>
      </form>

      {/* Sidebar */}
      <aside className="gv-side" aria-label="Your gift">
        <div className="gv-summary">
          {phase.kind !== "done" ? (
            <>
              <h2>Your gift</h2>
              <dl>
                <div><dt>Giving</dt><dd>{typeLabel}</dd></div>
                <div><dt>Paying by</dt><dd>{METHOD_LABEL[method]}</dd></div>
                <div><dt>Reference</dt><dd><span className="mono">{reference}</span><CopyButton text={reference} /></dd></div>
                <div className="gv-total"><dt>Total</dt><dd>{amount > 0 ? amountText : "—"}</dd></div>
              </dl>
              {error && <p className="sum-error" role="alert">{error}</p>}
              {method === "card" && giving.online_giving_url && (
                <a className="gv-submit gv-submit-alt" href={giving.online_giving_url} target="_blank" rel="noopener">
                  Continue to secure payment
                </a>
              )}
              <button className="gv-submit" type="button" onClick={confirm} disabled={phase.kind === "sending"}>
                {phase.kind === "sending" ? "Recording…" : "I've sent my gift"}
              </button>
              <p className="gv-fine">Pay using the details on the left, then tap the button so we can record your gift.</p>
            </>
          ) : (
            <div className="gv-thanks">
              <h2 ref={thanksRef} tabIndex={-1}>{firstName ? `Thank you, ${firstName}!` : "Thank you!"}</h2>
              <p>
                Your {typeLabel.toLowerCase()} of <strong>{amountText}</strong> by {METHOD_LABEL[method]} is on its way.{" "}
                {phase.gift
                  ? `We've recorded it as gift number ${phase.gift.id}. Send your proof of payment so the church office can confirm it.`
                  : "We couldn't save a record of it just now, but your payment is fine. Send your proof of payment and the church office will record it."}
              </p>
              <a className="gv-submit" href={whatsappUrl(whatsapp, proofMessage)} target="_blank" rel="noopener">
                <ChatIcon /> Send proof on WhatsApp
              </a>
              <button type="button" className="gv-link" onClick={() => setPhase({ kind: "form" })}>Give again</button>
              <p className="gv-verse">“God loveth a cheerful giver.” <cite>2 Corinthians 9:7</cite></p>
            </div>
          )}
        </div>
        <div className="gv-safe">
          <ShieldIcon />
          <p>
            <strong>Give safely</strong>
            Only use the account details on this page. The church will never ask you to send money to a personal number.
          </p>
        </div>
      </aside>
    </div>
  );
}

function MethodPanel({ method, giving, amountText, reference }: {
  method: Method;
  giving: GivingSettings;
  amountText: string;
  reference: string;
}) {
  const { ecocash, bank, abroad } = giving;

  if (method === "ecocash") {
    return (
      <>
        <dl className="details">
          <Row label="Merchant name" value={ecocash.merchant_name} />
          <Row label="Merchant code" value={ecocash.merchant_code} copy />
          <Row label="Amount" value={amountText} copy />
          <Row label="Reference" value={reference} copy />
        </dl>
        {ecocash.steps.length > 0 && (
          <ol className="how">{ecocash.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        )}
      </>
    );
  }

  if (method === "bank") {
    return (
      <>
        <dl className="details">
          <Row label="Account name" value={bank.account_name} copy />
          <Row label="Bank" value={bank.bank_name} />
          <Row label="Branch" value={bank.branch} />
          <Row label="Account number" value={bank.account_number} copy />
          <Row label="Currency" value={bank.account_currency} />
          <Row label="SWIFT code" value={bank.swift} copy />
          <Row label="Amount" value={amountText} copy />
          <Row label="Reference" value={reference} copy />
        </dl>
        <p className="panel-note">
          Put the reference in the “reference” or “narration” field so we can match your gift. The SWIFT code is only
          needed from another country.
        </p>
      </>
    );
  }

  if (method === "card") {
    return giving.online_giving_url ? (
      <p className="panel-note">
        Use <strong>Continue to secure payment</strong> on the right, and add <strong>{reference}</strong> in the notes.
        Card details are handled by the payment provider; the church never sees them.
      </p>
    ) : (
      <p className="panel-note">Online card giving isn&apos;t set up yet. Please give by EcoCash, bank transfer or in person.</p>
    );
  }

  return (
    <>
      <dl className="details">
        <Row label="Send to" value={abroad.recipient_name} copy />
        <Row label="Phone" value={abroad.recipient_phone} copy />
        <Row label="Country" value={abroad.country} />
        <Row label="Amount" value={amountText} copy />
        <Row label="Reference" value={reference} copy />
      </dl>
      <p className="panel-note">Keep the transaction code (PIN or MTCN) and send it to us on WhatsApp after you tap “I&apos;ve sent my gift”.</p>
    </>
  );
}

function Row({ label, value, copy = false }: { label: string; value: string; copy?: boolean }) {
  const has = value.trim() !== "";
  return (
    <div>
      <dt>{label}</dt>
      <dd>{has ? value : <span className="todo">To be added</span>}</dd>
      {has && copy ? <CopyButton text={value} /> : <span />}
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
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      box.remove();
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
