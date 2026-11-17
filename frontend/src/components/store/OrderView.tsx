"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import { CheckIcon, TruckIcon } from "../icons";

type Order = {
  id: string;
  number: number;
  status: string;
  status_label: string;
  payment: "pending" | "paid" | "failed";
  currency: string;
  subtotal: string;
  delivery_fee: string;
  total: string;
  payment_label: string;
  customer_name: string;
  fulfilment: "collect" | "delivery";
  fulfilment_label: string;
  fulfilment_note: string;
  address: string;
  items: { name: string; option: string; option_name: string; quantity: number; unit_price: string; line_total: string; product: string | null }[];
  created_at: string;
};

/** An order's own page: the receipt after paying, and where to check on it later. */
export default function OrderView({ id, thanks }: { id: string; thanks: boolean }) {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; order?: Order; error?: string } | null>(null);
  const key = `${id}#${nonce}`;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetch(`/api/store/orders/${id}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 404) return setResult({ key, error: "We couldn't find this order. Check the link and try again." });
        if (!res.ok) throw new Error(String(res.status));
        setResult({ key, order: (await res.json()) as Order });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setResult({ key, error: "We couldn't load your order just now. Please try again." });
      });
    return () => ctrl.abort();
  }, [id, key]);

  const order = result?.order;
  useEffect(() => {
    if (thanks && order) headingRef.current?.focus();
  }, [thanks, order]);

  if (!id) {
    return (
      <div className="gv-card st-order">
        <p className="sum-error" role="alert">We couldn&apos;t find this order. Check the link and try again.</p>
        <Link className="gv-submit" href="/store">Go to the store</Link>
      </div>
    );
  }
  if (!result) return <div className="skeleton" style={{ height: 480 }} aria-label="Loading your order" />;
  if (!order) {
    return (
      <div className="gv-card st-order">
        <p className="sum-error" role="alert">{result.error}</p>
        <button type="button" className="gv-submit" onClick={() => setNonce((n) => n + 1)}>Try again</button>
      </div>
    );
  }

  const cur = order.currency;
  const first = order.customer_name.split(/\s+/)[0];
  const paid = order.payment === "paid";

  return (
    <div className="gv-card st-order" aria-live="polite">
      {paid ? <span className="gv-done-icon"><CheckIcon /></span> : null}
      <div className="st-order-head">
        <h1 ref={headingRef} tabIndex={-1}>
          {thanks && paid ? `Thank you, ${first}!` : `Order #${order.number}`}
        </h1>
        <span className={`st-status st-status-${order.status}`}>{order.status_label}</span>
      </div>
      {thanks && paid && (
        <p className="gv-done-lead">
          Your payment of <strong>{money(order.total, cur)}</strong> went through and your order number is{" "}
          <strong>#{order.number}</strong>. Keep this page&apos;s link to check on your order.
        </p>
      )}
      {order.payment === "pending" && (
        <div className="st-order-note">
          <p>We&apos;re still waiting for the payment to be confirmed. This page will show it as paid once it is.</p>
          <button type="button" className="gv-link" onClick={() => setNonce((n) => n + 1)}>Check again</button>
        </div>
      )}
      {order.payment === "failed" && (
        <p className="sum-error">The payment for this order didn&apos;t go through, so nothing was charged.</p>
      )}

      <ul className="st-sum-items st-order-items">
        {order.items.map((i, n) => (
          <li key={n}>
            <span>
              {i.product ? <Link href={`/store/${i.product}`}>{i.name}</Link> : i.name}
              {i.option && <small>{i.option_name ? `${i.option_name}: ${i.option}` : i.option}</small>}
            </span>
            <span className="st-sum-qty">× {i.quantity}</span>
            <strong>{money(i.line_total, cur)}</strong>
          </li>
        ))}
      </ul>
      <dl className="details">
        <div><dt>Items</dt><dd>{money(order.subtotal, cur)}</dd><span /></div>
        <div><dt>{order.fulfilment === "delivery" ? "Delivery" : "Collection"}</dt>
          <dd>{parseFloat(order.delivery_fee) ? money(order.delivery_fee, cur) : "Free"}</dd><span /></div>
        <div><dt>Total</dt><dd>{money(order.total, cur)}</dd><span /></div>
        {paid && <div><dt>Paid with</dt><dd>{order.payment_label}</dd><span /></div>}
      </dl>

      {paid && (
        <div className="st-order-note">
          <strong>{order.fulfilment === "delivery" ? <><TruckIcon /> Delivery</> : "Collect at church"}</strong>
          <p>{order.fulfilment_note}</p>
          {order.address && <p className="st-address">{order.address}</p>}
        </div>
      )}
      <div className="st-order-actions">
        <Link className="gv-submit" href="/store">Back to the store</Link>
      </div>
    </div>
  );
}
