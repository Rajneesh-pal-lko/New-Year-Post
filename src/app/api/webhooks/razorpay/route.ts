import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { confirmCapturedPayment, findOrderByRazorpayId } from "@/lib/payments";
import { verifyWebhookSignature, type RazorpayPayment } from "@/lib/razorpay";

// POST /api/webhooks/razorpay
//
// Subscribe in the Razorpay dashboard to: payment.captured, order.paid, payment.failed.
//
// 1. Read the RAW body bytes and verify X-Razorpay-Signature over them
//    (before any JSON parsing; re-serialised JSON would not match).
// 2. Store the event keyed by x-razorpay-event-id (unique). A repeat delivery
//    of an already-processed event is acknowledged and skipped.
// 3. Apply it through the same idempotent confirmation used everywhere else.
//    Out-of-order events are harmless: PAID never moves backwards, and a
//    payment.failed after a capture does not downgrade anything.
// 4. Answer 2xx quickly. On an unexpected error we answer 500 so Razorpay
//    retries (it retries with backoff for 24 hours).

export const dynamic = "force-dynamic";

interface RazorpayEvent {
  event: string;
  payload?: {
    payment?: { entity?: RazorpayPayment & { error_description?: string } };
    order?: { entity?: { id: string } };
  };
}

export async function POST(req: Request) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("Razorpay webhook with invalid signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventId = req.headers.get("x-razorpay-event-id");
  if (!eventId) return NextResponse.json({ error: "missing event id" }, { status: 400 });

  // Idempotency: insert-or-detect by (source, event_id).
  const { error: insertErr } = await db()
    .from("webhook_events")
    .insert({ source: "razorpay", event_id: eventId, event_type: event.event, payload: event });
  if (insertErr) {
    if (insertErr.code !== "23505") {
      console.error("webhook_events insert failed", insertErr);
      return NextResponse.json({ error: "storage error" }, { status: 500 });
    }
    const { data: existing } = await db()
      .from("webhook_events")
      .select("id, processed_at, deliveries")
      .eq("source", "razorpay")
      .eq("event_id", eventId)
      .single();
    if (existing?.processed_at) return NextResponse.json({ ok: true, duplicate: true });
    // Seen before but never finished: process again (safe, it's idempotent).
    await db().from("webhook_events").update({ deliveries: (existing?.deliveries ?? 1) + 1 }).eq("id", existing?.id);
  }

  try {
    const outcome = await handle(event);
    await db()
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq("source", "razorpay")
      .eq("event_id", eventId);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Razorpay webhook processing failed", eventId, message);
    await db().from("webhook_events").update({ last_error: message.slice(0, 1000) }).eq("source", "razorpay").eq("event_id", eventId);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

async function handle(event: RazorpayEvent): Promise<string> {
  const payment = event.payload?.payment?.entity;

  if (event.event === "payment.captured" || event.event === "order.paid") {
    if (!payment?.order_id) return "IGNORED_NO_ORDER";
    const order = await findOrderByRazorpayId(payment.order_id);
    if (!order) return "IGNORED_UNKNOWN_ORDER"; // not one of ours (e.g. another integration on the account)
    return confirmCapturedPayment(order, payment);
  }

  if (event.event === "payment.failed") {
    if (!payment) return "IGNORED_NO_PAYMENT";
    const { error } = await db().rpc("record_payment_failure", {
      p_payment: {
        id: payment.id,
        order_id: payment.order_id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method ?? null,
        error_description: payment.error_description ?? null,
        raw: payment,
      },
    });
    if (error) throw new Error(`record_payment_failure: ${error.message}`);
    // The order stays PENDING_PAYMENT: the customer can retry until it expires.
    return "PAYMENT_FAILED_RECORDED";
  }

  return "IGNORED_EVENT_TYPE";
}
