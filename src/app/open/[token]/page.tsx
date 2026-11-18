import type { Metadata } from "next";
import Link from "next/link";
import { RecipientReveal } from "@/components/RecipientReveal";
import { SiteHeader } from "@/components/SiteChrome";
import { findPigeonByRecipientToken } from "@/lib/recipient";

// /open/{token}: the recipient's private reveal. The token comes from their
// email; only its hash is stored. Opening the page does not mark the pigeon
// as opened (mail scanners follow links); opening the envelope does.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A pigeon has landed for you", robots: { index: false } };

export default async function OpenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pigeon = await findPigeonByRecipientToken(token);

  if (!pigeon) {
    return (
      <>
        <SiteHeader />
        <main className="page">
          <h1>We couldn&rsquo;t find this pigeon</h1>
          <p className="lede">
            The link may be incomplete. Try opening it again from your email, or copy the whole link into your browser.
          </p>
          <p>
            <Link href="/contact">Contact us</Link> if it still doesn&rsquo;t work.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>A pigeon from {pigeon.sender_name}</h1>
        <RecipientReveal
          token={token}
          recipientName={pigeon.recipient_name}
          senderName={pigeon.sender_name}
          message={pigeon.message}
          canRelease={pigeon.allow_public_release}
          alreadyReleased={pigeon.released}
        />
      </main>
    </>
  );
}
