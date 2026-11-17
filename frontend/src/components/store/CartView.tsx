"use client";

import Link from "next/link";
import type { StoreSettings } from "@/lib/api";
import { cartCount, removeFromCart, setQuantity, useCart, useCartReady } from "@/lib/cart";
import { money } from "@/lib/format";
import { BagIcon, ShieldIcon, TrashIcon } from "../icons";
import { Stepper } from "./AddToCart";
import { problemsFor, useQuote } from "./useQuote";

/** The cart page: change quantities, see current prices, then go to checkout. */
export default function CartView({ currency, store }: { currency: string; store: StoreSettings }) {
  const lines = useCart();
  const ready = useCartReady();
  const { quote, error, loading } = useQuote(lines);
  const count = cartCount(lines);
  const problems = quote?.problems ?? [];
  const priceOf = (product: string, option: string) =>
    quote?.lines.find((l) => l.product === product && l.option === option);
  const cur = quote?.currency || currency;

  if (!ready) return <div className="skeleton" style={{ height: 360 }} aria-label="Loading your cart" />;
  if (!lines.length) {
    return (
      <div className="st-empty">
        <BagIcon />
        <h2>Your cart is empty</h2>
        <p>Books, sermons, clothing and gifts from the ministry are waiting in the store.</p>
        <Link className="btn btn-primary" href="/store">Go to the store</Link>
      </div>
    );
  }

  return (
    <div className="gv-layout st-cart">
      <div className="gv-card">
        <ul className="st-lines">
          {lines.map((line) => {
            const priced = priceOf(line.product, line.option);
            const issues = problemsFor(problems, line);
            const max = Math.min(50, priced?.stock_left ?? 50) || 1;
            return (
              <li key={`${line.product}|${line.option}`} className={`st-line${issues.length ? " has-problem" : ""}`}>
                <Link className="st-line-img" href={`/store/${line.product}`} tabIndex={-1} aria-hidden>
                  {line.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.image} alt="" />
                  ) : <BagIcon />}
                </Link>
                <div className="st-line-main">
                  <Link className="st-line-name" href={`/store/${line.product}`}>{line.name}</Link>
                  {line.option && <span className="st-line-opt">{priced?.option_name || "Option"}: {line.option}</span>}
                  <span className="st-line-each">{money(priced?.unit_price ?? line.price, cur)} each</span>
                  {issues.map((p) => <span key={p.message} className="sum-error" role="alert">{p.message}</span>)}
                </div>
                <div className="st-line-qty">
                  <Stepper value={line.quantity} max={Math.max(max, line.quantity)} name={line.name}
                    onChange={(q) => setQuantity(line, q)} />
                  <button type="button" className="st-remove" onClick={() => removeFromCart(line)} aria-label={`Remove ${line.name}`}>
                    <TrashIcon /> Remove
                  </button>
                </div>
                <strong className="st-line-total">
                  {priced ? money(priced.line_total, cur) : "—"}
                </strong>
              </li>
            );
          })}
        </ul>
        <Link className="gv-link" href="/store">← Keep shopping</Link>
      </div>

      <aside className="summary" aria-label="Order summary">
        <div className="summary-card">
          <div className="summary-top">
            <p className="eyebrow">Your cart</p>
            <p className="sum-amount">{quote ? money(quote.subtotal, cur) : "…"}</p>
            <p className="sum-type">{count} {count === 1 ? "item" : "items"}</p>
          </div>
          <div className="summary-body">
            <dl className="sum-list">
              <div><dt>Items</dt><dd>{quote ? money(quote.subtotal, cur) : "…"}</dd></div>
              <div>
                <dt>Collection or delivery</dt>
                <dd>{store.delivery_enabled ? `Free or ${money(store.delivery_fee, cur)}` : "Free collection"}</dd>
              </div>
            </dl>
            {error && <p className="sum-error" role="alert">{error}</p>}
            {problems.length > 0 && (
              <p className="sum-error" role="alert">Please fix the items marked above before checking out.</p>
            )}
            {problems.length || !quote ? (
              <button type="button" className="gv-submit" disabled>{loading ? "Checking prices…" : "Go to checkout"}</button>
            ) : (
              <Link className="gv-submit" href="/store/checkout">Go to checkout</Link>
            )}
            <p className="safe-note">
              <ShieldIcon />
              <span>Pay with PayPal, a debit or credit card, EcoCash, InnBucks, O&apos;mari or OneMoney.</span>
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
