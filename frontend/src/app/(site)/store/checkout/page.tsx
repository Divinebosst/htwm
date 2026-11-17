import type { Metadata } from "next";
import Checkout from "@/components/store/Checkout";
import { getSettings } from "@/lib/api";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const settings = await getSettings();
  return (
    <div className="gv-page">
      <div className="wrap">
        <header className="gv-top">
          <h1>Checkout</h1>
          <p className="st-top-note">Pay with PayPal, a debit or credit card, or mobile money.</p>
        </header>
        <Checkout giving={settings.giving} store={settings.store} />
      </div>
    </div>
  );
}
