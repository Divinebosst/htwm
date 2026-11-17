"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "@/lib/cart";

export type QuoteLine = {
  product: string;
  name: string;
  option: string;
  option_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  image_url: string | null;
  stock_left: number | null;
};

export type CartProblem = { product: string; option: string; message: string };

export type Quote = {
  currency: string;
  lines: QuoteLine[];
  subtotal: string;
  delivery_enabled: boolean;
  delivery_fee: string;
  problems: CartProblem[];
};

/**
 * Current prices, stock and totals for the cart, from the server. Asks again
 * whenever the cart changes (or `version` goes up).
 */
export function useQuote(lines: CartLine[], version = 0) {
  const items = lines.map((l) => ({ product: l.product, option: l.option, quantity: l.quantity }));
  const key = lines.length ? `${JSON.stringify(items)}#${version}` : null;
  const [result, setResult] = useState<{ key: string | null; quote?: Quote; error?: string }>({ key: null });

  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const body = key.slice(0, key.lastIndexOf("#"));
    const timer = setTimeout(() => {
      fetch("/api/store/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: `{"items":${body}}`,
        signal: ctrl.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          setResult({ key, quote: (await res.json()) as Quote });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setResult({ key, error: "We couldn't check the prices just now. Please try again." });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);

  const current = result.key === key;
  return {
    quote: key ? result.quote : undefined, // the last prices stay on screen while new ones load
    error: current ? result.error : undefined,
    loading: !!key && !current,
  };
}

/** Problems for one cart line (stock problems apply to every size of an item). */
export function problemsFor(problems: CartProblem[], line: { product: string; option: string }) {
  return problems.filter((p) => p.product === line.product && (!p.option || p.option === line.option || !line.option));
}
