"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/lib/api";
import { addToCart } from "@/lib/cart";
import { money } from "@/lib/format";
import { BagIcon, CheckIcon } from "../icons";

/** The store's items, with category buttons to narrow the list. */
export default function StoreGrid({ products, currency }: { products: Product[]; currency: string }) {
  const [category, setCategory] = useState("all");
  const categories = [...new Map(products.map((p) => [p.category, p.category_label])).entries()];
  const shown = category === "all" ? products : products.filter((p) => p.category === category);

  return (
    <>
      {categories.length > 1 && (
        <div className="st-filters" role="group" aria-label="Show">
          <button type="button" className="st-chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
            Everything
          </button>
          {categories.map(([key, label]) => (
            <button key={key} type="button" className="st-chip" aria-pressed={category === key} onClick={() => setCategory(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <ul className="st-grid">
        {shown.map((p) => <ProductCard key={p.slug} product={p} currency={currency} />)}
      </ul>
    </>
  );
}

export function StockBadge({ product }: { product: Product }) {
  if (product.stock_state === "sold_out") return <span className="st-badge sold">Sold out</span>;
  if (product.stock_state === "low" && product.stock_left) return <span className="st-badge low">Only {product.stock_left} left</span>;
  return null;
}

function ProductCard({ product: p, currency }: { product: Product; currency: string }) {
  const [added, setAdded] = useState(false);
  const href = `/store/${p.slug}`;

  function add() {
    addToCart({ product: p.slug, name: p.name, option: "", price: p.price, image: p.image_url });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <li className="st-card">
      <Link className="st-media" href={href} tabIndex={-1} aria-hidden>
        {p.image_url ? (
          // Uploaded pictures are served by the backend under /media
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" loading="lazy" />
        ) : (
          <span className="st-noimage"><BagIcon /></span>
        )}
        <StockBadge product={p} />
      </Link>
      <div className="st-body">
        <p className="st-cat">{p.category_label}</p>
        <h3><Link href={href}>{p.name}</Link></h3>
        <p className="st-summary">{p.summary}</p>
        <div className="st-foot">
          <strong className="st-price">{money(p.price, currency)}</strong>
          {p.stock_state === "sold_out" ? (
            <span className="st-out">Sold out</span>
          ) : p.options.length ? (
            <Link className="st-add" href={href}>Choose {p.option_name.toLowerCase() || "option"}</Link>
          ) : (
            <button type="button" className={`st-add${added ? " is-added" : ""}`} onClick={add} aria-live="polite">
              {added ? <><CheckIcon /> Added</> : <>Add to cart</>}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
