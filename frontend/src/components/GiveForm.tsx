"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo from "@/assets/logo.png";
import type { GivingCategory, GivingSettings } from "@/lib/api";
import { buildReference } from "@/lib/format";
import { CheckIcon, ShieldIcon } from "./icons";
import PaymentOptions, { type PaymentResult, type PaymentUrls } from "./payments/PaymentOptions";

/*
  Giving page form. Payments are confirmed automatically (see PaymentOptions):
  the thank-you message shows only once PayPal or Paynow confirms the gift.
*/

/** What the server says about a gift. */
type GiftResult = PaymentResult & {
  status: "pending" | "received" | "failed" | "not_found";
  reference: string;
  label: string;
  gift_number: number;
};

const GIFT_URLS: PaymentUrls = {
  paypalCreate: "/api/payments/paypal/orders",
  paypalCapture: (id) => `/api/payments/paypal/orders/${id}/capture`,
  mobileStart: "/api/payments/mobile",
  otp: (id) => `/api/payments/mobile/${id}/otp`,
  status: (id) => `/api/payments/${id}`,
};

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
  const [payingBy, setPayingBy] = useState("Choose below");
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState<GiftResult | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const category = categories.find((c) => c.key === typeKey) ?? categories[0];
  const parsed = parseFloat(amountInput);
  const amount = parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  const reference = category ? buildReference(category.reference_code, name, anonymous) : "";
  const typeLabel = category?.asks_purpose ? (purpose ? `Gift: ${purpose}` : "Gift") : (category?.label ?? "Gift");
  const amountText = amount > 0 ? money.format(amount) : "";
  const incomeValue = parseFloat(income);
  const tithe = incomeValue > 0 ? Math.round(incomeValue * 10) / 100 : 0;

  // Move focus to the thank-you message so it's seen (and read out) straight away.
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

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

  // ---------------------------------------------------------------- page

  const doneAmount = done ? money.format(parseFloat(done.amount)) : "";
  const firstName = anonymous ? "" : name.trim().split(/\s+/)[0] || "";

  return (
    <div className="gv-layout">
      {done ? (
        <div className="gv-card gv-done" aria-live="polite">
          <span className="gv-done-icon"><CheckIcon /></span>
          {done.payment === "paid" ? (
            <>
              <h2 ref={doneRef} tabIndex={-1}>{firstName ? `Thank you, ${firstName}!` : "Thank you!"}</h2>
              <p className="gv-done-lead">
                We&apos;ve received your {giftWords(done.label)} of <strong>{doneAmount}</strong>. God bless you.
              </p>
            </>
          ) : (
            <>
              <h2 ref={doneRef} tabIndex={-1}>Almost there</h2>
              <p className="gv-done-lead">
                PayPal is still processing your {giftWords(done.label)} of <strong>{doneAmount}</strong>. It will be
                recorded as soon as PayPal completes it, so there&apos;s no need to pay again.
              </p>
            </>
          )}
          <dl className="details">
            <div><dt>Gift number</dt><dd>{done.gift_number}</dd><span /></div>
            <div><dt>Paid with</dt><dd>{done.payment_label}</dd><span /></div>
            <div><dt>Reference</dt><dd className="mono">{done.reference}</dd><span /></div>
          </dl>
          <p className="gv-help">
            {done.payment_label.startsWith("Mobile")
              ? "Your wallet will also send you a confirmation SMS."
              : "PayPal will email you a receipt."}
          </p>
          <button
            type="button"
            className="gv-submit"
            onClick={() => {
              setDone(null);
              setLocked(false);
              setPayingBy("Choose below");
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

            <PaymentOptions
              giving={giving}
              amount={amount}
              check={amountProblem}
              details={details}
              urls={GIFT_URLS}
              onComplete={(result) => setDone(result as GiftResult)}
              onBusyChange={setLocked}
              onMethodChange={setPayingBy}
            />
          </section>
        </form>
      )}

      {/* Summary */}
      <aside className="summary" aria-label="Your gift">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">Your gift</p>
            {done ? (
              <>
                <p className="sum-amount">{doneAmount}</p>
                <p className="sum-type">{done.label}</p>
              </>
            ) : (
              <>
                <p className={`sum-amount${amount > 0 ? "" : " empty"}`}>{amount > 0 ? amountText : "Choose an amount"}</p>
                <p className="sum-type">{typeLabel}</p>
              </>
            )}
          </div>
          <div className="summary-body">
            {done ? (
              <dl className="sum-list">
                <div>
                  <dt>Status</dt>
                  <dd className={done.payment === "paid" ? "sum-ok" : ""}>
                    {done.payment === "paid" ? <><CheckIcon /> Received</> : "Processing"}
                  </dd>
                </div>
                <div><dt>Paid with</dt><dd>{done.payment_label}</dd></div>
                <div><dt>Gift number</dt><dd>{done.gift_number}</dd></div>
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

/** "Tithe" -> "tithe", "Gift: Youth conference" -> "gift for Youth conference" */
function giftWords(label: string) {
  return label.startsWith("Gift: ") ? `gift for ${label.slice(6)}` : label.toLowerCase();
}
