"use client";

import { useEffect, useRef, useState } from "react";
import type { GivingCategory, GivingSettings } from "@/lib/api";
import { buildReference, whatsappUrl } from "@/lib/format";
import { BankIcon, CardIcon, ChatIcon, CopyIcon, GlobeIcon, MobileIcon, ShieldIcon } from "./icons";

type Method = "ecocash" | "bank" | "card" | "abroad";

const METHODS: { value: Method; label: string; Icon: typeof BankIcon }[] = [
  { value: "ecocash", label: "EcoCash", Icon: MobileIcon },
  { value: "bank", label: "Bank transfer", Icon: BankIcon },
  { value: "card", label: "Card / PayPal", Icon: CardIcon },
  { value: "abroad", label: "From abroad", Icon: GlobeIcon },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<Method, string>;

type SavedGift = { id: number; reference: string };
type Phase = { kind: "form" } | { kind: "sending" } | { kind: "done"; gift: SavedGift | null };

type Props = {
  giving: GivingSettings;
  whatsapp: string;
  shortName: string;
  categories: GivingCategory[];
  initialType: string;
};

export default function GiveForm({ giving, whatsapp, shortName, categories, initialType }: Props) {
  const presets = giving.preset_amounts;
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: giving.currency || "USD" });
  const symbol = money.formatToParts(0).find((p) => p.type === "currency")?.value ?? "$";

  const [typeKey, setTypeKey] = useState(initialType);
  const [preset, setPreset] = useState<number | null>(presets.includes(50) ? 50 : null);
  const [custom, setCustom] = useState("");
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
  const customValue = parseFloat(custom);
  const amount = customValue > 0 ? customValue : (preset ?? 0);
  const reference = category ? buildReference(category.reference_code, name, anonymous) : "";
  const typeLabel = category?.asks_purpose ? (purpose ? `Gift: ${purpose}` : "Gift") : (category?.label ?? "Gift");
  const amountText = amount > 0 ? money.format(amount) : "";
  const incomeValue = parseFloat(income);
  const tithe = incomeValue > 0 ? Math.round(incomeValue * 10) / 100 : 0;

  if (!category) {
    return (
      <div className="wrap give-layout">
        <p className="lead">Online giving is being set up. Please give in person at any service for now.</p>
      </div>
    );
  }

  async function confirm() {
    setError("");
    if (!(amount > 0)) {
      setError("Choose or enter an amount in step 2 first.");
      return;
    }
    if (method === "card" && !giving.online_giving_url) {
      setError("Online card giving is not available yet. Please choose EcoCash, bank transfer or From abroad.");
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
    <div className="wrap give-layout">
      <form className="steps" onSubmit={(e) => e.preventDefault()} noValidate>
        {/* Step 1 */}
        <fieldset className="step">
          <legend><span className="step-no">1</span>What are you giving?</legend>
          <div className="type-grid">
            {categories.map((c) => (
              <label className="type-card" key={c.key}>
                <input
                  type="radio"
                  name="type"
                  value={c.key}
                  id={`type-${c.key}`}
                  checked={typeKey === c.key}
                  onChange={() => setTypeKey(c.key)}
                />
                <span className="t-name">{c.label}</span>
                <span className="t-desc">{c.description}</span>
              </label>
            ))}
          </div>

          {category.key === "tithe" && (
            <div className="tithe-calc">
              <div className="field">
                <label htmlFor="income">Work out your tithe</label>
                <div className="money-input">
                  <span className="cur">{symbol}</span>
                  <input
                    id="income"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Your income this period"
                    value={income}
                    onChange={(e) => setIncome(e.target.value)}
                  />
                </div>
              </div>
              <div className="result" aria-live="polite">
                <span>Your tithe (10%)</span>
                <strong>{money.format(tithe)}</strong>
              </div>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={!tithe}
                onClick={() => {
                  setCustom(tithe.toFixed(2));
                  setPreset(null);
                }}
              >
                Use this amount
              </button>
            </div>
          )}

          {category.asks_purpose && (
            <div className="field" id="other-wrap">
              <label htmlFor="other-purpose">What is this gift for?</label>
              <input
                id="other-purpose"
                type="text"
                maxLength={140}
                placeholder="e.g. Youth conference, a widow's support"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
          )}
        </fieldset>

        {/* Step 2 */}
        <fieldset className="step">
          <legend><span className="step-no">2</span>How much?</legend>
          <p className="step-note">
            Choose an amount or type your own. All amounts are in <strong>{giving.currency}</strong>.
          </p>
          <div className="amount-grid">
            {presets.map((a) => (
              <label className="amount-opt" htmlFor={`amt-${a}`} key={a}>
                <input
                  type="radio"
                  name="preset"
                  id={`amt-${a}`}
                  value={a}
                  checked={preset === a && !(customValue > 0)}
                  onChange={() => {
                    setPreset(a);
                    setCustom("");
                  }}
                />
                <span>{symbol}{a}</span>
              </label>
            ))}
          </div>
          <div className="custom-amount field">
            <label htmlFor="custom-amount">Or enter your own amount</label>
            <div className="money-input">
              <span className="cur">{symbol}</span>
              <input
                id="custom-amount"
                type="number"
                inputMode="decimal"
                min="1"
                step="0.01"
                placeholder="0.00"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {/* Step 3 */}
        <fieldset className="step">
          <legend><span className="step-no">3</span>Your details</legend>
          <p className="step-note">So we can record your gift and thank you. Your details stay with the church office.</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="giver-name">Full name</label>
              <input
                id="giver-name"
                type="text"
                autoComplete="name"
                placeholder="e.g. Tendai Moyo"
                value={name}
                disabled={anonymous}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="giver-contact">Phone or email <span className="hint">(optional)</span></label>
              <input
                id="giver-contact"
                type="text"
                autoComplete="tel"
                placeholder="For your receipt"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <label className="check field full" htmlFor="anonymous">
              <input id="anonymous" type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              <span>Give anonymously. Your name will not appear on the payment reference.</span>
            </label>
          </div>
        </fieldset>

        {/* Step 4 */}
        <fieldset className="step">
          <legend><span className="step-no">4</span>How would you like to give?</legend>
          <div className="method-tabs" role="radiogroup" aria-label="Payment method">
            {METHODS.map(({ value, label, Icon }) => (
              <label className="method-tab" key={value}>
                <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                <span><Icon />{label}</span>
              </label>
            ))}
          </div>
          <div className="method-panel" aria-live="polite">
            <MethodPanel method={method} giving={giving} amountText={amountText} reference={reference} />
          </div>
        </fieldset>
      </form>

      {/* Summary */}
      <aside className="summary" aria-label="Your gift">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">Your gift</p>
            <p className={`sum-amount${amount > 0 ? "" : " empty"}`}>{amount > 0 ? amountText : "Choose an amount"}</p>
            <p className="sum-type">{typeLabel}</p>
          </div>

          {phase.kind !== "done" ? (
            <div className="summary-body">
              <dl className="sum-list">
                <div><dt>Paying by</dt><dd>{METHOD_LABEL[method]}</dd></div>
                <div className="ref-row">
                  <dt>Reference</dt>
                  <dd><span className="ref-code">{reference}</span><CopyButton text={reference} /></dd>
                </div>
              </dl>
              {error && <p className="sum-error" role="alert">{error}</p>}
              {method === "card" && giving.online_giving_url && (
                <a className="btn btn-primary" href={giving.online_giving_url} target="_blank" rel="noopener">
                  Continue to secure payment
                </a>
              )}
              <button className="btn btn-gold" type="button" onClick={confirm} disabled={phase.kind === "sending"}>
                {phase.kind === "sending" ? "Recording…" : "I've sent my gift"}
              </button>
              <p className="safe-note">
                <ShieldIcon />
                <span>Only use the account details on this page. The church will never ask you to send money to a personal number.</span>
              </p>
            </div>
          ) : (
            <div className="summary-body thanks">
              <h3 ref={thanksRef} tabIndex={-1}>{firstName ? `Thank you, ${firstName}!` : "Thank you!"}</h3>
              <p>
                Your {typeLabel.toLowerCase()} of {amountText} by {METHOD_LABEL[method]} is on its way.{" "}
                {phase.gift
                  ? `We have recorded it as gift number ${phase.gift.id}. Send your proof of payment so the church office can confirm it.`
                  : "We couldn't save a record of it just now, but your payment is fine. Send your proof of payment and the church office will record it."}
              </p>
              <a className="btn btn-primary" href={whatsappUrl(whatsapp, proofMessage)} target="_blank" rel="noopener">
                <ChatIcon />
                Send proof on WhatsApp
              </a>
              <button className="btn btn-ghost" type="button" onClick={() => setPhase({ kind: "form" })}>
                Give again
              </button>
              <blockquote className="scripture">
                “Give, and it shall be given unto you; good measure, pressed down, and shaken together, and running
                over.”<cite>Luke 6:38</cite>
              </blockquote>
            </div>
          )}
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

function MethodPanel({
  method,
  giving,
  amountText,
  reference,
}: {
  method: Method;
  giving: GivingSettings;
  amountText: string;
  reference: string;
}) {
  const { ecocash, bank, abroad } = giving;

  if (method === "ecocash") {
    return (
      <>
        <h3>Pay with EcoCash</h3>
        <dl className="details">
          <Row label="Merchant name" value={ecocash.merchant_name} />
          <Row label="Merchant code" value={ecocash.merchant_code} copy />
          <Row label="Amount" value={amountText} copy />
          <Row label="Reference" value={reference} copy />
        </dl>
        {ecocash.steps.length > 0 && (
          <ol className="how">
            {ecocash.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        )}
        <p className="panel-note">When you have paid, tap “I&apos;ve sent my gift” and send us the confirmation SMS.</p>
      </>
    );
  }

  if (method === "bank") {
    return (
      <>
        <h3>Bank transfer</h3>
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
          Type the reference in the “reference” or “narration” field of your transfer so we can match your gift. The
          SWIFT code is only needed when sending from another country.
        </p>
      </>
    );
  }

  if (method === "card") {
    return giving.online_giving_url ? (
      <>
        <h3>Card or PayPal</h3>
        <p>
          You will go to our secure payment page to finish your gift{amountText && <> of <strong>{amountText}</strong></>}.
          Add <strong>{reference}</strong> in the notes so we can record it.
        </p>
        <p className="panel-note">Card details are handled by the payment provider. The church never sees or stores them.</p>
      </>
    ) : (
      <>
        <h3>Card or PayPal</h3>
        <p><span className="todo">Coming soon</span></p>
        <p>Online card giving is not set up yet. Please give by EcoCash, bank transfer or in person at any service.</p>
      </>
    );
  }

  const services = abroad.services.length
    ? abroad.services.length > 1
      ? `${abroad.services.slice(0, -1).join(", ")} or ${abroad.services[abroad.services.length - 1]}`
      : abroad.services[0]
    : "a money transfer service";
  return (
    <>
      <h3>Send from abroad</h3>
      <dl className="details">
        <Row label="Send to" value={abroad.recipient_name} copy />
        <Row label="Phone" value={abroad.recipient_phone} copy />
        <Row label="Country" value={abroad.country} />
        <Row label="Amount" value={amountText} copy />
        <Row label="Reference" value={reference} copy />
      </dl>
      <p>Use {services}.</p>
      <ol className="how">
        <li>Send the money to the name and phone number above.</li>
        <li>Keep the transaction code (PIN or MTCN).</li>
        <li>Tap “I&apos;ve sent my gift” and send us the code on WhatsApp so the church office can collect it.</li>
      </ol>
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
      // Older browsers: copy through a temporary text box
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
