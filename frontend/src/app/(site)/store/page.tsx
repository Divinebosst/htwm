import type { Metadata } from "next";
import Link from "next/link";
import Rays from "@/components/Rays";
import StoreGrid from "@/components/store/StoreGrid";
import { getProducts, getSettings } from "@/lib/api";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Store",
  description:
    "Books, sermons, clothing and gifts from Heal The World Ministries International. Pay with PayPal, a card or mobile money, then collect at church or have it delivered.",
  path: "/store",
});

export default async function StorePage() {
  const [products, settings] = await Promise.all([getProducts(), getSettings()]);

  return (
    <>
      <section className="page-hero" aria-labelledby="store-heading">
        <Rays variant="page" />
        <div className="wrap">
          <p className="eyebrow">Church store</p>
          <h1 id="store-heading">
            Books, sermons <span>&amp; more</span>
          </h1>
          <p className="lead">
            Teaching from Apostle Chrispen and Prophetess Yvonne Mahovo, worship, church clothing and gifts. Every
            purchase supports the work of the ministry.
          </p>
        </div>
      </section>

      <section className="section st-section" aria-label="Items for sale">
        <div className="wrap">
          {products.length ? (
            <StoreGrid products={products} currency={settings.giving.currency} />
          ) : (
            <div className="st-empty">
              <h2>The store is being stocked</h2>
              <p>Please check back soon, or ask at the church office after any service.</p>
              <Link className="btn btn-primary" href="/give">Give instead</Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
