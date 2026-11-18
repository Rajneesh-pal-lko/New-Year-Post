import { NextResponse } from "next/server";
import { slotToUtc } from "@shared/slots";
import { deliveryDate, now, salesState } from "@/lib/campaign";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { newOrderRef, newPigeonId } from "@/lib/ids";
import { quote } from "@/lib/pricing";
import type { PackageSize } from "@/lib/packages";
import { createRazorpayOrder } from "@/lib/razorpay";
import { issueToken } from "@/lib/tokens";
import { issuesToFieldErrors, orderInputSchema } from "@/lib/validation";

// POST /api/orders
//
// Contract
//   in:  { packageSize, sender: {name, email}, allowPublicRelease, acceptTerms, pigeons: [...] }
//   out: 201 { orderRef, accessToken, razorpayOrderId, keyId, amountPaise, currency, expiresAt, checkoutTimeoutSeconds }
//        400 { error, fieldErrors }   invalid input
//        409 { error }                sales not open / closed
//        429 { error }                too many orders for this email
//        502 { error, orderRef }      Razorpay unavailable (order saved but unpayable; it expires)
//
// The browser sends only choices and text. The server decides the price from
// its own clock, snapshots it, and creates the Razorpay order for that amount.

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "That order is too large." });

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const parsed = orderInputSchema.safeParse(input);
  if (!parsed.success) {
    return json(400, { error: "Some details need fixing.", fieldErrors: issuesToFieldErrors(parsed.error) });
  }
  const order = parsed.data;

  const at = now();
  const state = salesState(at);
  if (state === "BEFORE") return json(409, { error: "Sales open on 1 December 2026 at 12:00 AM IST." });
  if (state === "CLOSED") return json(409, { error: "Sales closed on 31 December 2026 at 11:59 PM IST." });

  const price = quote(order.packageSize as PackageSize, at);
  const day = deliveryDate();

  for (let attempt = 0; attempt < 3; attempt++) {
    const orderRef = newOrderRef();
    // Access token for the sender's private order page. The id component is
    // the order ref because the database id doesn't exist yet; the delivery
    // function derives the same way (see deliverOutbox).
    const access = await issueToken("order", orderRef);

    const { data, error } = await db().rpc("create_order_with_pigeons", {
      p_order: {
        public_ref: orderRef,
        sender_name: order.sender.name,
        sender_email: order.sender.email,
        package_size: order.packageSize,
        tier_id: price.tierId,
        amount_paise: price.amountPaise,
        price_snapshot: price,
        allow_public_release: order.allowPublicRelease,
        access_token_nonce: access.nonce,
        access_token_hash: access.hash,
      },
      p_pigeons: order.pigeons.map((p, i) => ({
        position: i + 1,
        public_id: newPigeonId(),
        recipient_name: p.recipientName,
        recipient_email: p.recipientEmail,
        message: p.message,
        slot_local: p.slot,
        scheduled_at_utc: slotToUtc(day, p.slot).toISOString(),
      })),
      p_checkout_minutes: env.checkoutTtlMinutes,
    });

    if (error) {
      if (error.message.includes("RATE_LIMITED")) {
        return json(429, { error: "Too many orders from this email in the last hour. Please try again later." });
      }
      // 23505 = unique violation: a random public id collided. Try new ids.
      if (error.code === "23505" && attempt < 2) continue;
      console.error("create_order_with_pigeons failed", error);
      return json(500, { error: "We couldn't save your order. Please try again." });
    }

    const { order_id: orderId, expires_at: expiresAt } = data as { order_id: string; expires_at: string };

    try {
      const rzp = await createRazorpayOrder({
        amountPaise: price.amountPaise,
        receipt: orderRef,
        notes: { order_ref: orderRef, pigeons: String(order.packageSize) },
      });
      const { error: attachErr } = await db()
        .from("orders")
        .update({ razorpay_order_id: rzp.id, updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .is("razorpay_order_id", null);
      if (attachErr) throw new Error(attachErr.message);

      const secondsLeft = Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      return json(201, {
        orderRef,
        accessToken: access.token,
        razorpayOrderId: rzp.id,
        keyId: env.razorpayKeyId,
        amountPaise: price.amountPaise,
        currency: "INR",
        expiresAt,
        checkoutTimeoutSeconds: secondsLeft,
      });
    } catch (err) {
      console.error("Razorpay order creation failed", orderRef, err);
      return json(502, { error: "The payment service didn't respond. Please try again in a minute.", orderRef });
    }
  }

  return json(500, { error: "We couldn't save your order. Please try again." });
}
