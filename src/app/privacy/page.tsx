import type { Metadata } from "next";
import Link from "next/link";
import { Placeholder, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { business } from "@/content/business";

// Describes what the code actually does. Have it reviewed against India's
// data-protection obligations by a qualified professional before launch.

export const metadata: Metadata = { title: "Privacy: Pigeon Post 2027" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Privacy policy</h1>
        <p className="lede">Last updated: {business.policiesUpdated ?? <Placeholder>date</Placeholder>}</p>
        <h2>What we collect</h2>
        <ul>
          <li>Your name and email address, to send your receipt and private order link.</li>
          <li>Each recipient&rsquo;s name and email address, and the letter you write to them, to deliver your pigeons.</li>
          <li>Payment records from Razorpay (payment ID, amount, status, method). We never receive card numbers or UPI PINs.</li>
          <li>Delivery records from our email provider (sent, delivered, bounced).</li>
        </ul>
        <p>We don&rsquo;t use accounts, advertising trackers or analytics cookies.</p>
        <h2>How we use it</h2>
        <p>
          Only to take your payment, deliver your pigeons on 1 January 2027, show you their status, and answer support requests.
          We don&rsquo;t sell or share your data for marketing.
        </p>
        <h2>Who processes it for us</h2>
        <ul>
          <li>Razorpay, for payments.</li>
          <li>Supabase, for our database and scheduled delivery.</li>
          <li>Vercel, for hosting the website.</li>
          <li>Resend, for sending emails.</li>
        </ul>
        <h2>Who can read your letters</h2>
        <p>
          Letters are kept private until they land. Each one opens only through a long, unguessable link sent to its recipient;
          we store a fingerprint of that link, not the link itself. If you allowed it, a recipient may release a letter into the
          public <Link href="/universe">Pigeon Universe</Link>. Released letters are reviewed before they appear, show first names
          only if the recipient chooses, and never show email addresses.
        </p>
        <h2>How long we keep it</h2>
        <p>
          We delete recipients&rsquo; email addresses, letters and sender details{" "}
          {business.dataRetentionDays ? (
            `${business.dataRetentionDays} days after 1 January 2027`
          ) : (
            <Placeholder>retention period after 1 January 2027</Placeholder>
          )}
          , except where we must keep payment records by law. Letters released to the Pigeon Universe stay there until you or
          the recipient ask us to remove them.
        </p>
        <h2>Your choices</h2>
        <p>
          You can ask us to access, correct or delete your data, or to remove a letter from the Universe, by{" "}
          <Link href="/contact">contacting us</Link>.
        </p>
        <h2>Grievance officer</h2>
        <p>{business.grievanceOfficer ?? <Placeholder>name and email of grievance officer</Placeholder>}</p>
      </main>
      <SiteFooter />
    </>
  );
}
