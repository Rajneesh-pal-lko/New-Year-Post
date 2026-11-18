import type { Metadata } from "next";
import Link from "next/link";
import { formatRupees, perPigeonPaise } from "@shared/money";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { now } from "@/lib/campaign";
import { PACKAGE_SIZES } from "@/lib/packages";
import { PRICE_TIERS, tierAt } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pricing: Pigeon Post 2027" };

export default function PricingPage() {
  const current = tierAt(now());
  return (
    <>
      <SiteHeader />
      <main className="page sheet" style={{ maxWidth: "56rem" }}>
        <h1>Pricing</h1>
        <p className="lede">
          You buy a bundle of pigeons and pay once. Each pigeon carries one letter to one person. Prices are in Indian rupees and
          include applicable taxes.
        </p>
        <p>
          Prices rise each week in December, at 12:00 AM IST on the dates below. The price you see when you start paying is
          held for that checkout, even if a new week begins while you pay.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="price-table">
            <caption className="field__hint" style={{ textAlign: "left", marginBottom: "0.5rem" }}>
              Bundle prices by week (IST). Per-pigeon figures are approximate and for comparison only.
            </caption>
            <thead>
              <tr>
                <th scope="col">Dates</th>
                {PACKAGE_SIZES.map((s) => (
                  <th scope="col" key={s}>
                    {s} {s === 1 ? "pigeon" : "pigeons"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRICE_TIERS.map((tier) => (
                <tr key={tier.id} aria-current={tier.id === current.id ? "true" : undefined}>
                  <th scope="row">
                    {tier.label}
                    {tier.id === current.id && <span className="price-table__now">current</span>}
                  </th>
                  {PACKAGE_SIZES.map((s) => (
                    <td key={s}>
                      <strong>{formatRupees(tier.prices[s])}</strong>
                      {s > 1 && <small>about {formatRupees(perPigeonPaise(tier.prices[s], s))} each</small>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>What you get</h2>
        <ul>
          <li>One pigeon per recipient, each with its own letter of up to 500 characters and its own delivery time.</li>
          <li>Delivery by email on 1 January 2027, in a half-hour slot you choose (IST).</li>
          <li>A private order page with each pigeon&rsquo;s status, and a shareable pigeon page for WhatsApp.</li>
        </ul>
        <p>
          See the <Link href="/refunds">cancellation and refund policy</Link> for what happens if something goes wrong.
        </p>
        <p>
          <Link href="/send" className="button button--primary">
            Send Your First Pigeon
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
