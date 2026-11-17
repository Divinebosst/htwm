import type { Metadata } from "next";
import CartView from "@/components/store/CartView";
import { getSettings } from "@/lib/api";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const settings = await getSettings();
  return (
    <div className="gv-page">
      <div className="wrap">
        <header className="gv-top">
          <h1>Your cart</h1>
          <p className="st-top-note">Prices and stock are checked again before you pay.</p>
        </header>
        <CartView currency={settings.giving.currency} store={settings.store} />
      </div>
    </div>
  );
}
