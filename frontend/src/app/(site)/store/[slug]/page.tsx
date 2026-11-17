import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AddToCart from "@/components/store/AddToCart";
import { StockBadge } from "@/components/store/StoreGrid";
import { ArrowIcon, BagIcon, TruckIcon } from "@/components/icons";
import { getProduct, getProducts, getSettings } from "@/lib/api";
import { money } from "@/lib/format";
import { mediaPath, pageMetadata } from "@/lib/site";

// Prerender the store's items at build time. Items added later are rendered
// on their first visit and then cached.
export async function generateStaticParams() {
  const products = await getProducts();
  return products.length ? products.map((p) => ({ slug: p.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/store/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Item not found" };
  return pageMetadata({
    title: product.name,
    description: product.summary,
    path: `/store/${product.slug}`,
    image: mediaPath(product.image_url),
  });
}

export default function ProductPage({ params }: PageProps<"/store/[slug]">) {
  return (
    <Suspense fallback={<div className="wrap section"><div className="skeleton" style={{ height: 520 }} /></div>}>
      <ProductDetail params={params} />
    </Suspense>
  );
}

async function ProductDetail({ params }: Pick<PageProps<"/store/[slug]">, "params">) {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getProduct(slug), getSettings()]);
  if (!product) notFound();
  const currency = settings.giving.currency;
  const paragraphs = product.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <section className="st-product" aria-labelledby="product-name">
      <div className="wrap">
        <Link className="back-link" href="/store">
          <ArrowIcon /> Store
        </Link>
        <div className="st-product-grid">
          <div className="st-product-media">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.name} />
            ) : (
              <span className="st-noimage"><BagIcon /></span>
            )}
            <StockBadge product={product} />
          </div>
          <div className="st-product-info">
            <p className="eyebrow">{product.category_label}</p>
            <h1 id="product-name">{product.name}</h1>
            <p className="st-product-price">{money(product.price, currency)}</p>
            <p className="lead">{product.summary}</p>
            <AddToCart product={product} currency={currency} />
            <ul className="st-perks">
              <li><strong>Collect at church</strong> for free. {settings.store.collect_note}</li>
              {settings.store.delivery_enabled && (
                <li>
                  <strong><TruckIcon /> Delivery</strong> for {money(settings.store.delivery_fee, currency)}.{" "}
                  {settings.store.delivery_note}
                </li>
              )}
              <li><strong>Pay safely</strong> with PayPal, a card, EcoCash, InnBucks, O&apos;mari or OneMoney.</li>
            </ul>
            {paragraphs.length > 0 && (
              <div className="st-description">
                <h2>About this item</h2>
                {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
