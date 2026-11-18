import "server-only";
import { db } from "./db";
import { fetchOrderPayments, type RazorpayPayment } from "./razorpay";
import { issueToken } from "./tokens";

// The single place where a captured payment turns into active pigeons.
// Every path (checkout callback, webhook, reconciliation) ends here, and the
// database function it calls is idempotent, so whichever path arrives first
// wins and the others are no-ops.

export type ConfirmResult =
  | "ACTIVATED"
  | "ALREADY_PAID"
  | "DUPLICATE_PAYMENT"
  | "AMOUNT_MISMATCH"
  | "ORDER_NOT_PAYABLE"
  | "NOT_CAPTURED";

export interface OrderRow {
  id: string;
  public_ref: string;
  status: string;
  razorpay_order_id: string | null;
  amount_paise: number;
  expires_at: string;
}

export async function confirmCapturedPayment(order: OrderRow, payment: RazorpayPayment): Promise<ConfirmResult> {
  if (payment.status !== "captured") return "NOT_CAPTURED";
  if (!order.razorpay_order_id || payment.order_id !== order.razorpay_order_id) {
    throw new Error(`Payment ${payment.id} does not belong to order ${order.public_ref}`);
  }

  // Generate recipient link secrets only if the order still needs activating.
  // If two paths race, both compute tokens; the row lock in the database means
  // only the first set is stored.
  let tokens: { pigeon_id: string; nonce: string; hash: string }[] = [];
  if (order.status !== "PAID") {
    const { data: pigeons, error } = await db().from("pigeons").select("id").eq("order_id", order.id);
    if (error) throw new Error(`Could not load pigeons: ${error.message}`);
    tokens = await Promise.all(
      (pigeons ?? []).map(async (p: { id: string }) => {
        const t = await issueToken("recipient", p.id);
        return { pigeon_id: p.id, nonce: t.nonce, hash: t.hash };
      }),
    );
  }

  const { data, error } = await db().rpc("confirm_order_payment", {
    p_order_id: order.id,
    p_payment: {
      id: payment.id,
      order_id: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method ?? null,
      raw: payment,
    },
    p_tokens: tokens,
  });
  if (error) throw new Error(`confirm_order_payment failed: ${error.message}`);
  return data as ConfirmResult;
}

const ORDER_COLUMNS = "id, public_ref, status, razorpay_order_id, amount_paise, expires_at";

export async function findOrderByRazorpayId(razorpayOrderId: string): Promise<OrderRow | null> {
  const { data, error } = await db().from("orders").select(ORDER_COLUMNS).eq("razorpay_order_id", razorpayOrderId).maybeSingle();
  if (error) throw new Error(`Order lookup failed: ${error.message}`);
  return data as OrderRow | null;
}

/** Grace period after checkout expiry before we give up on a payment arriving. */
const EXPIRY_GRACE_MS = 15 * 60_000;

export interface ReconcileOutcome {
  ref: string;
  result: string;
}

/**
 * Reconciliation for one order: ask Razorpay what payments exist and act on
 * them. Covers delayed or missed webhooks, our site being down, and abandoned
 * checkouts (which become EXPIRED).
 */
export async function reconcileOrder(order: OrderRow, nowMs: number): Promise<ReconcileOutcome> {
  const pastGrace = nowMs > new Date(order.expires_at).getTime() + EXPIRY_GRACE_MS;

  if (!order.razorpay_order_id) {
    // Razorpay order creation failed; nobody could have paid.
    if (order.status === "PENDING_PAYMENT" && pastGrace) {
      await db().from("orders").update({ status: "EXPIRED", updated_at: new Date().toISOString() }).eq("id", order.id).eq("status", "PENDING_PAYMENT");
      return { ref: order.public_ref, result: "EXPIRED_NO_RAZORPAY_ORDER" };
    }
    return { ref: order.public_ref, result: "WAITING" };
  }

  const payments = await fetchOrderPayments(order.razorpay_order_id);
  const results: string[] = [];
  let current = order;

  for (const payment of payments.filter((p) => p.status === "captured")) {
    const r = await confirmCapturedPayment(current, payment);
    results.push(r);
    if (r === "ACTIVATED") current = { ...current, status: "PAID" };
  }

  if (!results.length && order.status === "PENDING_PAYMENT" && pastGrace) {
    await db().from("orders").update({ status: "EXPIRED", updated_at: new Date().toISOString() }).eq("id", order.id).eq("status", "PENDING_PAYMENT");
    results.push("EXPIRED");
  }

  await db().from("orders").update({ last_reconciled_at: new Date().toISOString() }).eq("id", order.id);
  return { ref: order.public_ref, result: results.join(",") || "NO_CAPTURED_PAYMENT" };
}
