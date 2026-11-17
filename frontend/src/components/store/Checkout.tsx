"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GivingSettings, StoreSettings } from "@/lib/api";
import { cartCount, clearCart, useCart, useCartReady } from "@/lib/cart";
import { money } from "@/lib/format";
import { BagIcon, ShieldIcon, TruckIcon } from "../icons";
import PaymentOptions, { type PaymentUrls } from "../payments/PaymentOptions";
import { useQuote } from "./useQuote";

const ORDER_URLS: PaymentUrls = {
  paypalCreate: "/api/store/checkout/paypal",
  paypalCapture: (id) => `/api/store/checkout/paypal/${id}/capture`,
  mobileStart: "/api/store/checkout/mobile",
  otp: (id) => `/api/store/orders/${id}/otp`,
  status: (id) => `/api/store/orders/${id}`,
};

type Props = { giving: GivingSettings; store: StoreSettings };

/** Checkout: the buyer's details, collection or delivery, then payment. */
export default function Checkout({ giving, store }: Props) {
  const router = useRouter();
  const lines = useCart();
  const ready = useCartReady();
  const [version, setVersion] = useState(0);
  const { quote, error, loading } = useQuote(lines, version);
  const [form, setForm] = useState({ name: "", contact_phone: "", email: "", address: "", notes: "" });
  const [fulfilment, setFulfilment] = useState<"collect" | "delivery">("collect");
  const [payingBy, setPayingBy] = useState("Choose below");
  const [locked, setLocked] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const cur = quote?.currency || giving.currency || "USD";
  const subtotal = quote ? parseFloat(quote.subtotal) : 0;
  const delivery = fulfilment === "delivery" && quote ? parseFloat(quote.delivery_fee) : 0;
  const total = subtotal + delivery;
  const count = cartCount(lines);
  const problems = quote?.problems ?? [];
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  if (!ready) return <div className="skeleton" style={{ height: 520 }} aria-label="Loading your order" />;
  if (!lines.length && !leaving) {
    return (
      <div className="st-empty">
        <BagIcon />
        <h2>Your cart is empty</h2>
        <p>Add something from the store first.</p>
        <Link className="btn btn-primary" href="/store">Go to the store</Link>
      </div>
    );
  }

  function check() {
    if (!quote || loading) return "Checking prices… please try again in a moment.";
    if (problems.length) return "Some items in your cart need attention. Go back to your cart to fix them.";
    if (!form.name.trim()) return "Enter your name.";
    if (form.contact_phone.replace(/\D/g, "").length < 9) return "Enter a phone number so we can reach you about your order.";
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return "Check your email address.";
    if (fulfilment === "delivery" && !form.address.trim()) return "Enter the delivery address.";
    return "";
  }

  function details() {
    return {
      items: lines.map((l) => ({ product: l.product, option: l.option, quantity: l.quantity })),
      name: form.name.trim(),
      contact_phone: form.contact_phone.trim(),
      email: form.email.trim(),
      fulfilment,
      address: fulfilment === "delivery" ? form.address.trim() : "",
      notes: form.notes.trim(),
    };
  }

  return (
    <div className="gv-layout">
      <form className="gv-card" onSubmit={(e) => e.preventDefault()} noValidate>
        <fieldset className="gv-lock" disabled={locked}>
          <section className="gv-section" aria-labelledby="co-who">
            <h2 id="co-who">Your details</h2>
            <div className="field">
              <label htmlFor="co-name">Full name</label>
              <input id="co-name" autoComplete="name" value={form.name} onChange={set("name")} maxLength={120} />
            </div>
            <div className="st-two">
              <div className="field">
                <label htmlFor="co-phone">Phone number</label>
                <input id="co-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="0771 234 567"
                  value={form.contact_phone} onChange={set("contact_phone")} maxLength={30} />
              </div>
              <div className="field">
                <label htmlFor="co-email">Email <span className="hint">(optional)</span></label>
                <input id="co-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} maxLength={254} />
              </div>
            </div>
            <p className="gv-help">We&apos;ll only use these to tell you when your order is ready.</p>
          </section>

          <section className="gv-section" aria-labelledby="co-how">
            <h2 id="co-how">Collection or delivery</h2>
            <div className="st-fulfil" role="radiogroup" aria-labelledby="co-how">
              <label className={`st-fulfil-opt${fulfilment === "collect" ? " is-on" : ""}`}>
                <input type="radio" name="fulfilment" value="collect" checked={fulfilment === "collect"}
                  onChange={() => setFulfilment("collect")} />
                <span className="st-fulfil-text">
                  <strong>Collect at church</strong>
                  <span>{store.collect_note}</span>
                </span>
                <span className="st-fulfil-price">Free</span>
              </label>
              {store.delivery_enabled && (
                <label className={`st-fulfil-opt${fulfilment === "delivery" ? " is-on" : ""}`}>
                  <input type="radio" name="fulfilment" value="delivery" checked={fulfilment === "delivery"}
                    onChange={() => setFulfilment("delivery")} />
                  <span className="st-fulfil-text">
                    <strong><TruckIcon /> Delivery</strong>
                    <span>{store.delivery_note}</span>
                  </span>
                  <span className="st-fulfil-price">{money(quote?.delivery_fee ?? store.delivery_fee, cur)}</span>
                </label>
              )}
            </div>
            {fulfilment === "delivery" && (
              <div className="field">
                <label htmlFor="co-address">Delivery address</label>
                <textarea id="co-address" autoComplete="street-address" rows={3} maxLength={300}
                  placeholder="House number, street, suburb and city" value={form.address} onChange={set("address")} />
              </div>
            )}
            <div className="field">
              <label htmlFor="co-notes">Anything we should know? <span className="hint">(optional)</span></label>
              <textarea id="co-notes" rows={2} maxLength={500} value={form.notes} onChange={set("notes")} />
            </div>
          </section>
        </fieldset>

        <section className="gv-section" aria-labelledby="co-pay">
          <h2 id="co-pay">Payment</h2>
          {problems.length > 0 && (
            <p className="sum-error" role="alert">
              Some items in your cart have changed. <Link href="/store/cart">Check your cart</Link> before paying.
            </p>
          )}
          {error && <p className="sum-error" role="alert">{error}</p>}
          <PaymentOptions
            giving={giving}
            amount={total}
            check={check}
            details={details}
            urls={ORDER_URLS}
            onComplete={(result) => {
              setLeaving(true);
              clearCart();
              router.push(`/store/order?id=${result.id}&thanks=1`);
            }}
            onBusyChange={setLocked}
            onMethodChange={setPayingBy}
            onRefused={(body) => {
              if (body && typeof body === "object" && (body as { code?: string }).code === "cart_changed") {
                setVersion((v) => v + 1);
              }
            }}
          />
        </section>
      </form>

      <aside className="summary" aria-label="Your order">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">Your order</p>
            <p className={`sum-amount${quote ? "" : " empty"}`}>{quote ? money(total, cur) : "Checking…"}</p>
            <p className="sum-type">{count} {count === 1 ? "item" : "items"}</p>
          </div>
          <div className="summary-body">
            <ul className="st-sum-items">
              {(quote?.lines ?? []).map((l) => (
                <li key={`${l.product}|${l.option}`}>
                  <span>
                    {l.name}
                    {l.option && <small>{l.option_name}: {l.option}</small>}
                  </span>
                  <span className="st-sum-qty">× {l.quantity}</span>
                  <strong>{money(l.line_total, cur)}</strong>
                </li>
              ))}
            </ul>
            <dl className="sum-list">
              <div><dt>Items</dt><dd>{money(subtotal, cur)}</dd></div>
              <div><dt>{fulfilment === "delivery" ? "Delivery" : "Collection"}</dt><dd>{delivery ? money(delivery, cur) : "Free"}</dd></div>
              <div><dt>Paying by</dt><dd>{payingBy}</dd></div>
            </dl>
            <Link className="gv-link" href="/store/cart">Edit cart</Link>
            <p className="safe-note">
              <ShieldIcon />
              <span>
                Payments go through PayPal and Paynow&apos;s secure checkouts and are confirmed automatically. The church
                never sees your card details or PIN.
              </span>
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
