import type { Metadata } from "next";
import { Suspense } from "react";
import GiveForm from "@/components/GiveForm";
import { getGivingCategories, getSettings } from "@/lib/api";
import { telHref } from "@/lib/format";

export const metadata: Metadata = {
  title: "Give",
  description:
    "Give your tithes, offerings, seeds and building fund to Heal The World Ministries International with PayPal, a card, EcoCash, InnBucks, O'mari or OneMoney.",
};

export default function GivePage({ searchParams }: PageProps<"/give">) {
  return (
    <>
      <div className="gv-page">
        <div className="wrap">
          <header className="gv-top">
            <h1>Give to the work of God</h1>
            <p>
              “Every man according as he purposeth in his heart, so let him give… for God loveth a cheerful giver.”{" "}
              <cite>2 Corinthians 9:7</cite>
            </p>
          </header>
          {/* The form reads ?type=tithe from the link, which is only known at request time */}
          <Suspense fallback={<GiveFormLoading />}>
            <GiveFormWithData searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
      <GivingFaq />
    </>
  );
}

async function GiveFormWithData({ searchParams }: Pick<PageProps<"/give">, "searchParams">) {
  const [{ type }, settings, categories] = await Promise.all([searchParams, getSettings(), getGivingCategories()]);
  const wanted = typeof type === "string" ? type : "";
  const initialType = categories.some((c) => c.key === wanted)
    ? wanted
    : (categories.find((c) => c.key === "offering")?.key ?? categories[0]?.key ?? "");

  return (
    <GiveForm
      key={initialType}
      initialType={initialType}
      giving={settings.giving}
      churchName={settings.church_name}
      categories={categories}
    />
  );
}

function GiveFormLoading() {
  return (
    <div className="gv-layout" aria-busy="true" aria-label="Loading the giving form">
      <div className="skeleton" style={{ height: 640 }} />
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}

async function GivingFaq() {
  const settings = await getSettings();
  const phone = settings.phones[0];
  return (
    <section className="faq section" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <div className="in-person">
          <p className="eyebrow">Questions</p>
          <h2 id="faq-title">About giving</h2>
          <p>
            You can also give in person at any service using the offering envelopes. Write your name and what the gift
            is for on the envelope.
          </p>
          {phone && (
            <p>
              For anything else about giving, call or WhatsApp <a href={telHref(phone)}>{phone}</a>.
            </p>
          )}
        </div>
        <div className="faq-list">
          <details open>
            <summary>What is the difference between a tithe and an offering?</summary>
            <p>
              A tithe is the first tenth (10%) of your income, given to the house of God as taught in Malachi 3:10. An
              offering is any gift above your tithe, given freely as the Lord leads you.
            </p>
          </details>
          <details>
            <summary>How do I give with mobile money?</summary>
            <p>
              Choose Mobile money, tap EcoCash, InnBucks, O&apos;mari or OneMoney, and enter your number. You&apos;ll get a
              prompt on your phone (or a code for InnBucks and O&apos;mari) to approve the payment. The page shows a
              thank-you message as soon as it goes through.
            </p>
          </details>
          <details>
            <summary>Will I get a receipt?</summary>
            <p>
              Yes. Your gift is confirmed on the page as soon as it&apos;s received, with a gift number for your records.
              PayPal also emails you a receipt, and mobile money wallets send a confirmation SMS.
            </p>
          </details>
          <details>
            <summary>Can I give from outside the country?</summary>
            <p>
              Yes. Use the PayPal button, or Debit or Credit Card if you don&apos;t have a PayPal account. Gifts are in{" "}
              {settings.giving.currency}, and PayPal or your bank converts from your own currency.
            </p>
          </details>
          <details>
            <summary>Is my giving safe?</summary>
            <p>
              Yes. Card and PayPal payments are handled by PayPal, and mobile money by Paynow, so the church never sees
              your card details or PIN. If anyone asks you to send money for the ministry to a personal number, please
              call the church office first.
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}
