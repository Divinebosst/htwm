/*
  The store cart, kept in this browser (localStorage) so it survives page
  loads. It only remembers which items and how many: prices, stock and totals
  always come from the server (POST /api/store/quote) before anyone pays.
*/
import { useSyncExternalStore } from "react";

export type CartLine = {
  product: string; // the item's slug
  name: string;
  option: string; // e.g. a size; "" if the item has no choices
  price: string; // last price seen, for display only
  image: string | null;
  quantity: number;
};

const KEY = "htwm-cart-v1";
export const MAX_QUANTITY = 50;
const EMPTY: CartLine[] = [];

let lines: CartLine[] | null = null;
const listeners = new Set<() => void>();

function valid(l: unknown): l is CartLine {
  if (!l || typeof l !== "object") return false;
  const c = l as Record<string, unknown>;
  return typeof c.product === "string" && typeof c.name === "string" && typeof c.option === "string"
    && typeof c.quantity === "number" && c.quantity > 0;
}

function read(): CartLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(valid) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(next: CartLine[]) {
  lines = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private browsing or storage full: the cart still works until the page is closed
  }
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      lines = read();
      callback();
    }
  };
  window.addEventListener("storage", onStorage); // another tab changed the cart
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot() {
  if (lines === null) lines = read();
  return lines;
}

/** The cart's lines. Empty while the page first loads, then the saved cart. */
export function useCart() {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export const sameLine = (a: { product: string; option: string }, b: { product: string; option: string }) =>
  a.product === b.product && a.option === b.option;

export function addToCart(item: Omit<CartLine, "quantity">, quantity = 1) {
  const current = snapshot();
  const existing = current.find((l) => sameLine(l, item));
  write(existing
    ? current.map((l) => (l === existing ? { ...item, quantity: Math.min(MAX_QUANTITY, l.quantity + quantity) } : l))
    : [...current, { ...item, quantity: Math.min(MAX_QUANTITY, quantity) }]);
}

export function setQuantity(line: { product: string; option: string }, quantity: number) {
  const q = Math.max(0, Math.min(MAX_QUANTITY, Math.floor(quantity)));
  write(q === 0 ? snapshot().filter((l) => !sameLine(l, line))
    : snapshot().map((l) => (sameLine(l, line) ? { ...l, quantity: q } : l)));
}

export function removeFromCart(line: { product: string; option: string }) {
  write(snapshot().filter((l) => !sameLine(l, line)));
}

export function clearCart() {
  write([]);
}

export function cartCount(items: CartLine[]) {
  return items.reduce((n, l) => n + l.quantity, 0);
}

const noop = () => () => {};

/** False while the page is first loading (before the saved cart can be read). */
export function useCartReady() {
  return useSyncExternalStore(noop, () => true, () => false);
}
