import type { Metadata } from "next";
import { Suspense } from "react";
import OrderView from "@/components/store/OrderView";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

// /store/order?id=<private order id> (the link is only known to the buyer)
export default function OrderPage({ searchParams }: PageProps<"/store/order">) {
  return (
    <div className="gv-page">
      <div className="wrap st-order-wrap">
        <Suspense fallback={<div className="skeleton" style={{ height: 480 }} />}>
          <OrderLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function OrderLoader({ searchParams }: Pick<PageProps<"/store/order">, "searchParams">) {
  const { id, thanks } = await searchParams;
  const orderId = typeof id === "string" && /^[0-9a-f-]{32,36}$/.test(id) ? id : "";
  return <OrderView id={orderId} thanks={thanks === "1"} />;
}
