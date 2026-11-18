import type { Metadata } from "next";
import Link from "next/link";
import { Placeholder, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { business } from "@/content/business";

// A plain-language starting point. Have it reviewed by a qualified lawyer
// before launch; this is not legal advice.

export const metadata: Metadata = { title: "Terms: Pigeon Post 2027" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="page sheet">
        <h1>Terms of service</h1>
        <p className="lede">Last updated: {business.policiesUpdated ?? <Placeholder>date</Placeholder>}</p>
        <p>
          These terms apply when you use Pigeon Post 2027, operated by {business.legalName ?? <Placeholder>legal name</Placeholder>}{" "}
          (&ldquo;we&rdquo;). By buying pigeons you agree to them.
        </p>
        <h2>The service</h2>
        <p>
          You buy a bundle of virtual pigeons. Each pigeon carries one letter you write to one recipient, delivered by email on
          1 January 2027 at a half-hour slot you choose, in Indian Standard Time. Sales run from 1 December 2026, 12:00 AM IST to
          31 December 2026, 11:59 PM IST. The service is offered to customers in India and is paid in Indian rupees.
        </p>
        <h2>Prices and payment</h2>
        <p>
          Prices are listed on the <Link href="/pricing">pricing page</Link>, include applicable taxes, and change on the dates
          shown there. The price shown when you start checkout is held for that checkout session. Payments are processed by
          Razorpay; we do not receive or store card or UPI credentials. Pigeons are scheduled only after Razorpay confirms your
          payment.
        </p>
        <h2>Delivery</h2>
        <p>
          We send each pigeon&rsquo;s email at or shortly after its chosen slot. When many pigeons share a slot, some may be
          sent a few minutes later. We can&rsquo;t control recipients&rsquo; email providers, spam filters or inboxes. Your order
          page shows each pigeon&rsquo;s status as reported by our email provider.
        </p>
        <h2>Your letters</h2>
        <p>
          You are responsible for what you write and for having a good reason to email each recipient. Don&rsquo;t send
          letters that are abusive, threatening, harassing, unlawful, or that share someone else&rsquo;s private information.
          We may cancel pigeons that break these rules, and we may stop letters that are reported to us.
        </p>
        <h2>The Pigeon Universe</h2>
        <p>
          If you allow it at checkout, recipients may choose to publish your letter in the public Pigeon Universe. Published
          letters show the letter text and, only if the recipient chooses, first names. We review letters before they appear and
          may decline or remove any letter.
        </p>
        <h2>Cancellations and refunds</h2>
        <p>
          See our <Link href="/refunds">cancellation and refund policy</Link>.
        </p>
        <h2>Liability</h2>
        <p>
          <Placeholder>limitation of liability wording, reviewed by a lawyer</Placeholder>
        </p>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of India. Courts at {business.jurisdictionCity ?? <Placeholder>city</Placeholder>}{" "}
          have jurisdiction.
        </p>
        <h2>Contact</h2>
        <p>
          <Link href="/contact">Contact us</Link> with any questions about these terms.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
