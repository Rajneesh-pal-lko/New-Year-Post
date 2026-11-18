import type { Metadata } from "next";
import { Placeholder, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { business } from "@/content/business";

// The refund policy is an owner decision (open question Q8). Until it is set
// in src/content/business.ts, this page shows placeholders, not invented terms.

export const metadata: Metadata = { title: "Cancellations and refunds: Pigeon Post 2027" };

export default function RefundsPage() {
  const policy = business.refundPolicy;
  return (
    <>
      <SiteHeader />
      <main className="page sheet">
        <h1>Cancellations and refunds</h1>
        <p className="lede">
          Last updated: {business.policiesUpdated ?? <Placeholder>date</Placeholder>}
        </p>
        <h2>Before your pigeons land</h2>
        <p>{policy?.beforeDelivery ?? <Placeholder>whether and until when orders can be cancelled or letters edited</Placeholder>}</p>
        <h2>After your pigeons land</h2>
        <p>{policy?.afterDelivery ?? <Placeholder>policy once a pigeon has been delivered</Placeholder>}</p>
        <h2>If we can&rsquo;t deliver a pigeon</h2>
        <p>{policy?.failedDelivery ?? <Placeholder>what happens when a pigeon fails or bounces</Placeholder>}</p>
        <h2>If you were charged twice</h2>
        <p>{policy?.duplicatePayment ?? <Placeholder>refund of duplicate payments</Placeholder>}</p>
        <h2>How long refunds take</h2>
        <p>{policy?.refundTimeline ?? <Placeholder>refund timeline and method</Placeholder>}</p>
        <p>
          To ask for a cancellation or refund, email{" "}
          {business.supportEmail ? <a href={`mailto:${business.supportEmail}`}>{business.supportEmail}</a> : <Placeholder>support email</Placeholder>}{" "}
          with your order ID.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
