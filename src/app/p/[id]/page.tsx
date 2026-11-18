import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatIstDate, slotLabel } from "@shared/slots";
import { Pigeon } from "@/components/Pigeon";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { now, salesState } from "@/lib/campaign";
import { db } from "@/lib/db";
import { looksLikePigeonId } from "@/lib/ids";

// /p/{pigeonId}: the shareable pigeon page (what WhatsApp shares). It shows
// who the pigeon is for and when it lands, never the message. Only paid
// pigeons have a page.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "A pigeon is on its way: Pigeon Post 2027",
  description: "Someone has sent you a New Year pigeon. It lands by email on 1 January 2027.",
  robots: { index: false },
};

export default async function PigeonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!looksLikePigeonId(id)) notFound();

  const { data, error } = await db()
    .from("pigeons")
    .select("public_id, recipient_name, slot_local, scheduled_at_utc, status, orders!inner(sender_name, status)")
    .eq("public_id", id)
    .maybeSingle();
  if (error) throw new Error(`Pigeon lookup failed: ${error.message}`);
  if (!data) notFound();
  const order = (Array.isArray(data.orders) ? data.orders[0] : data.orders) as { sender_name: string; status: string };
  if (order.status !== "PAID" || data.status === "PENDING_PAYMENT" || data.status === "CANCELLED") notFound();

  const at = now();
  const landed = new Date(data.scheduled_at_utc) <= at && data.status !== "SCHEDULED";
  const day = formatIstDate(new Date(new Date(data.scheduled_at_utc).getTime() + 330 * 60_000).toISOString().slice(0, 10));
  const recipient = data.recipient_name.split(/\s+/)[0];

  return (
    <>
      <SiteHeader />
      <main className="page teaser">
        <Pigeon pose={landed ? "perch" : "fly"} envelope={!landed} title="A carrier pigeon" />
        {landed ? (
          <>
            <h1>This pigeon has landed</h1>
            <p className="lede">
              {order.sender_name}&rsquo;s pigeon flew to {recipient} on {day}. The letter is theirs to read.
            </p>
          </>
        ) : (
          <>
            <h1>A pigeon is flying to {recipient}</h1>
            <p className="lede">
              From {order.sender_name}. It lands on {day} at {slotLabel(data.slot_local)} IST, carrying a letter by email.
            </p>
            <p>The letter is sealed until then.</p>
          </>
        )}
        <p className="field__hint">Pigeon {data.public_id}</p>
        <p>
          {salesState(at) === "OPEN" ? (
            <Link href="/send" className="button button--primary">
              Send Your First Pigeon
            </Link>
          ) : (
            <Link href="/universe" className="button button--primary">
              Explore the Pigeon Universe
            </Link>
          )}
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
