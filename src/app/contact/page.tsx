import type { Metadata } from "next";
import { Placeholder, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { business } from "@/content/business";

export const metadata: Metadata = { title: "Contact: Pigeon Post 2027" };

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <main className="page sheet">
        <h1>Contact us</h1>
        <p className="lede">We read every message. Include your order ID (it starts with PP-) or pigeon ID (PGN-) if you have one.</p>
        <dl className="summary-grid">
          <dt>Email</dt>
          <dd>
            {business.supportEmail ? (
              <a href={`mailto:${business.supportEmail}`}>{business.supportEmail}</a>
            ) : (
              <Placeholder>support email</Placeholder>
            )}
          </dd>
          {business.supportPhone && (
            <>
              <dt>Phone</dt>
              <dd>{business.supportPhone}</dd>
            </>
          )}
          <dt>Business</dt>
          <dd>{business.legalName ?? <Placeholder>legal name</Placeholder>}</dd>
          <dt>Address</dt>
          <dd>{business.address ?? <Placeholder>registered address</Placeholder>}</dd>
          <dt>Grievance officer</dt>
          <dd>{business.grievanceOfficer ?? <Placeholder>name and email of grievance officer</Placeholder>}</dd>
        </dl>
        <h2>Reporting a letter</h2>
        <p>
          If you received a pigeon you didn&rsquo;t want, or you saw something in the Pigeon Universe that shouldn&rsquo;t be
          there, email us with the link or pigeon ID. We can stop pigeons that haven&rsquo;t landed yet and remove letters from
          the Universe.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
