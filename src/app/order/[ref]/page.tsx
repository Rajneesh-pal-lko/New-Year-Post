import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRupees } from "@shared/money";
import { formatIstDate, slotLabel } from "@shared/slots";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatIst } from "@/lib/campaign";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { looksLikeOrderRef } from "@/lib/ids";
import { pigeonStatusLabel } from "@/lib/status";
import { tokenMatches } from "@/lib/tokens";

// /order/{ref}?k={token}: the sender's private order page. No account: the
// unguessable token in the link is the key (only its hash is stored).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your pigeons: Pigeon Post 2027", robots: { index: false } };

interface Props {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ k?: string }>;
}

interface PigeonRow {
  public_id: string;
  position: number;
  recipient_name: string;
  slot_local: string;
  scheduled_at_utc: string;
  status: string;
  failure_reason: string | null;
}

export default async function OrderPage({ params, searchParams }: Props) {
  const { ref } = await params;
  const { k } = await searchParams;
  if (!looksLikeOrderRef(ref) || !k) notFound();

  const { data: order } = await db()
    .from("orders")
    .select("id, public_ref, status, package_size, amount_paise, paid_at, expires_at, access_token_hash, created_at")
    .eq("public_ref", ref)
    .maybeSingle();
  if (!order || !(await tokenMatches(k, order.access_token_hash))) notFound();

  const { data: pigeonRows } = await db()
    .from("pigeons")
    .select("public_id, position, recipient_name, slot_local, scheduled_at_utc, status, failure_reason")
    .eq("order_id", order.id)
    .order("position");
  const pigeons = (pigeonRows ?? []) as PigeonRow[];
  const deliveryDay = pigeons[0] ? formatIstDate(istDateOf(pigeons[0].scheduled_at_utc)) : "";

  return (
    <>
      <SiteHeader />
      <main className="page">
        {order.status === "PENDING_PAYMENT" && (
          <>
            <AutoRefresh />
            <h1>Confirming your payment…</h1>
            <p className="lede">
              This page updates by itself. If you&rsquo;ve paid, it usually takes a few seconds. You&rsquo;ll also get an email with
              this link.
            </p>
            <p className="notice">
              Haven&rsquo;t paid yet? This order is held until {formatIst(new Date(order.expires_at))}.{" "}
              <Link href="/send">Go back to your letters</Link> to pay.
            </p>
          </>
        )}

        {order.status === "EXPIRED" && (
          <>
            <h1>This checkout expired</h1>
            <p className="lede">No payment was received for this order, so no pigeons were scheduled.</p>
            <p>
              If money left your account, don&rsquo;t worry: we check with Razorpay automatically, and a late payment still
              schedules your pigeons. This page will show it.
            </p>
            <p>
              <Link href="/send" className="button button--primary">
                Start again
              </Link>
            </p>
          </>
        )}

        {(order.status === "REFUNDED" || order.status === "PARTIALLY_REFUNDED") && (
          <>
            <h1>This order was refunded</h1>
            <p className="lede">Contact us if you have questions about this refund.</p>
          </>
        )}

        {order.status === "PAID" && (
          <>
            <h1>
              Your {order.package_size === 1 ? "pigeon is" : "pigeons are"} booked
            </h1>
            <p className="lede">
              Payment received. {order.package_size === 1 ? "It lands" : "They land"} on {deliveryDay}. Bookmark this page: it&rsquo;s
              your private link to check on them.
            </p>
            <dl className="summary-grid">
              <dt>Order</dt>
              <dd>{order.public_ref}</dd>
              <dt>Paid</dt>
              <dd>
                {formatRupees(order.amount_paise)}
                {order.paid_at ? `, ${formatIst(new Date(order.paid_at))}` : ""}
              </dd>
              <dt>Pigeons</dt>
              <dd>{order.package_size}</dd>
            </dl>
          </>
        )}

        {pigeons.length > 0 && order.status !== "EXPIRED" && (
          <section aria-label="Pigeons">
            {order.status === "PAID" && <h2>Your pigeons</h2>}
            {pigeons.map((p) => {
              const status = pigeonStatusLabel(p.status);
              const pageUrl = `${env.appBaseUrl}/p/${p.public_id}`;
              const share = `I've sent you a New Year pigeon 🕊️ It lands on ${deliveryDay} at ${slotLabel(p.slot_local)} IST. Keep an eye on your email! ${pageUrl}`;
              return (
                <article className="ticket" key={p.public_id}>
                  <div className="ticket__row">
                    <span className="ticket__name">To {p.recipient_name}</span>
                    <span className={`status status--${status.tone}`}>{status.label}</span>
                  </div>
                  <div className="ticket__row">
                    <span>
                      {deliveryDay}, {slotLabel(p.slot_local)} IST
                    </span>
                    <span className="ticket__id">{p.public_id}</span>
                  </div>
                  {p.status === "FAILED" && (
                    <p className="field__hint" style={{ marginTop: "0.5rem" }}>
                      {p.failure_reason?.startsWith("Bounced")
                        ? "Their email server turned it away, so the address may be wrong."
                        : "We couldn't send this one."}{" "}
                      Please <Link href="/contact">contact us</Link> with the pigeon ID.
                    </p>
                  )}
                  {order.status === "PAID" && (
                    <div className="ticket__actions">
                      <a
                        className="button button--whatsapp"
                        href={`https://wa.me/?text=${encodeURIComponent(share)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Share on WhatsApp
                      </a>
                      <Link className="button button--quiet" href={`/p/${p.public_id}`}>
                        Pigeon page
                      </Link>
                    </div>
                  )}
                </article>
              );
            })}
            {order.status === "PAID" && (
              <p className="field__hint">
                The pigeon page and WhatsApp share show only who it&rsquo;s for and when it lands. Your letter stays sealed until
                the recipient opens their email.
              </p>
            )}
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

function istDateOf(utcIso: string): string {
  return new Date(new Date(utcIso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
