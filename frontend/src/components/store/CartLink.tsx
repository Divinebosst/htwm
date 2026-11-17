"use client";

import Link from "next/link";
import { cartCount, useCart } from "@/lib/cart";
import { BagIcon } from "../icons";

/** The cart button in the header, with how many items are in it. */
export default function CartLink({ onClick }: { onClick?: () => void }) {
  const count = cartCount(useCart());
  return (
    <Link className="cart-link" href="/store/cart" onClick={onClick}
      aria-label={count ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}>
      <BagIcon />
      {count > 0 && <span className="cart-count" aria-hidden>{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
