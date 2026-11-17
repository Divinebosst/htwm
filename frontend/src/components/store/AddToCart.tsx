"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProductDetail } from "@/lib/api";
import { MAX_QUANTITY, addToCart } from "@/lib/cart";
import { money } from "@/lib/format";
import { CheckIcon, MinusIcon, PlusIcon } from "../icons";

/** Size (if any), quantity and the "Add to cart" button on an item's page. */
export default function AddToCart({ product: p, currency }: { product: ProductDetail; currency: string }) {
  const [option, setOption] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const max = Math.min(MAX_QUANTITY, p.stock_left ?? MAX_QUANTITY);
  const optionName = (p.option_name || "Option").toLowerCase();

  if (p.stock_state === "sold_out") {
    return <p className="st-soldout-note">This item is sold out for now. Please check again soon.</p>;
  }

  function add() {
    if (p.options.length && !option) {
      setError(`Choose a ${optionName}.`);
      return;
    }
    addToCart({ product: p.slug, name: p.name, option, price: p.price, image: p.image_url }, quantity);
    setError("");
    setAdded(true);
  }

  return (
    <div className="st-buy">
      {p.options.length > 0 && (
        <fieldset className="st-options">
          <legend>{p.option_name || "Option"}</legend>
          <div className="st-option-list">
            {p.options.map((o) => (
              <label key={o} className="st-option">
                <input type="radio" name="option" value={o} checked={option === o}
                  onChange={() => { setOption(o); setError(""); setAdded(false); }} />
                <span>{o}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="st-qty-row">
        <span className="st-qty-label" id="qty-label">Quantity</span>
        <Stepper value={quantity} max={max} labelledBy="qty-label"
          onChange={(q) => { setQuantity(q); setAdded(false); }} />
      </div>
      {error && <p className="sum-error" role="alert">{error}</p>}
      <button type="button" className="gv-submit" onClick={add}>
        Add to cart · {money(parseFloat(p.price) * quantity, currency)}
      </button>
      {added && (
        <p className="st-added" role="status">
          <CheckIcon /> Added to your cart. <Link href="/store/cart">View cart and pay</Link>
        </p>
      )}
    </div>
  );
}

export function Stepper({ value, max, onChange, labelledBy, name }: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  labelledBy?: string;
  name?: string;
}) {
  return (
    <div className="st-stepper" role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : `Quantity of ${name}`}>
      <button type="button" aria-label="One fewer" disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <MinusIcon />
      </button>
      <input type="number" inputMode="numeric" min={1} max={max} value={value} aria-label="Quantity"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(1, Math.min(max, n)));
        }} />
      <button type="button" aria-label="One more" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <PlusIcon />
      </button>
    </div>
  );
}
