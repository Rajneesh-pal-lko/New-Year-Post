import type { Metadata } from "next";
import Link from "next/link";
import { Placeholder, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { business } from "@/content/business";

export const metadata: Metadata = { title: "About: Pigeon Post 2027" };

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="page sheet">
        <h1>About Pigeon Post 2027</h1>
        <p className="lede">A little bird. A special message.</p>
        <p>
          Pigeon Post 2027 is a small New Year experiment. You write a personal letter to each person you love, and on 1 January
          2027 a virtual carrier pigeon delivers it to their inbox at the time you choose. When they open it, the pigeon flies in,
          lands, and hands over your envelope.
        </p>
        <p>
          It is a gift, not a messaging app. There are no accounts, no feeds and no ads. Sales run from 1 to 31 December 2026,
          for customers in India, and every pigeon flies on New Year&rsquo;s Day.
        </p>
        <p>
          Recipients can choose to release their pigeon into the public <Link href="/universe">Pigeon Universe</Link>, a sky
          of real New Year letters, if the sender allowed it. Every released letter is reviewed before it appears.
        </p>
        <h2>Who runs it</h2>
        <p>
          Pigeon Post 2027 is operated by {business.legalName ?? <Placeholder>legal name of the business</Placeholder>}
          {business.address ? `, ${business.address}` : <>, <Placeholder>registered address</Placeholder></>}.
        </p>
        <p>
          Questions? <Link href="/contact">Contact us</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
