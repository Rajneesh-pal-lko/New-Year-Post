import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { looksLikeOrderRef } from "@/lib/ids";
import { confirmCapturedPayment, type OrderRow } from "@/lib/payments";
import { fetchPayment, verifyCheckoutSignature } from "@/lib/razorpay";
import { tokenMatches } from "@/lib/tokens";

// POST /api/payments/verify
//
// Called by the browser from Razorpay Checkout's success handler. The browser's
// word is NOT trusted: it only triggers a server-side check.
//   1. The checkout signature must verify with our key secret.
//   2. We fetch the payment from Razorpay ourselves and require status
//      "captured", the right order and the snapshot amount.
// If the payment is only authorized so far, we answer PENDING; the webhook or
// the reconciliation job will finish the job.
//
// out: 200 { status: "PAID" | "PENDING" }   400/403/404 on bad input

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderRef: z.string().refine(looksLikeOrderRef),
  accessToken: z.string().min(1).max(100),
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;

  const { data: order, error } = await db()
    .from("orders")
    .select("id, public_ref, status, razorpay_order_id, amount_paise, expires_at, access_token_hash")
    .eq("public_ref", body.orderRef)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Please try again." }, { status: 500 });
  if (!order || !(await tokenMatches(body.accessToken, order.access_token_hash))) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status === "PAID") return NextResponse.json({ status: "PAID" });

  if (order.razorpay_order_id !== body.razorpay_order_id) {
    return NextResponse.json({ error: "Payment does not match this order." }, { status: 403 });
  }
  if (!verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
    console.warn("Checkout signature mismatch", body.orderRef);
    return NextResponse.json({ error: "Payment could not be verified." }, { status: 403 });
  }

  try {
    const payment = await fetchPayment(body.razorpay_payment_id);
    if (payment.order_id !== order.razorpay_order_id) {
      return NextResponse.json({ error: "Payment does not match this order." }, { status: 403 });
    }
    if (payment.status !== "captured") {
      // Authorized but not yet captured (auto-capture usually follows within
      // seconds). The order page keeps checking; the webhook will confirm.
      return NextResponse.json({ status: "PENDING" });
    }
    const result = await confirmCapturedPayment(order as OrderRow, payment);
    const paid = result === "ACTIVATED" || result === "ALREADY_PAID" || result === "DUPLICATE_PAYMENT";
    if (!paid) console.error("Payment confirmation needs admin attention", body.orderRef, result);
    return NextResponse.json({ status: paid ? "PAID" : "PENDING" });
  } catch (err) {
    console.error("verify failed", body.orderRef, err);
    // Not fatal for the customer: webhook + reconciliation still run.
    return NextResponse.json({ status: "PENDING" });
  }
}
