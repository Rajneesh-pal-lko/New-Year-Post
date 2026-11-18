import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { reconcileOrder, type OrderRow } from "@/lib/payments";
import { secretMatches } from "@/lib/tokens";

// POST /api/cron/reconcile   (Supabase Cron, every 5 minutes, x-cron-secret header)
//
// The safety net under the checkout callback and the webhook:
//   * pending orders: ask Razorpay for the order's payments; activate on a
//     captured one; mark EXPIRED once the checkout window + grace has passed
//   * recently expired orders (24h): a late capture is still honoured
// Orders are processed least-recently-checked first, in a bounded batch, so a
// pile of abandoned checkouts can't starve newer ones.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 40;

export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-cron-secret"), env.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowMs = Date.now();
  const minAge = new Date(nowMs - 2 * 60_000).toISOString(); // give the callback and webhook a head start
  const expiredWindow = new Date(nowMs - 24 * 3_600_000).toISOString();

  const columns = "id, public_ref, status, razorpay_order_id, amount_paise, expires_at";
  const [pending, expired] = await Promise.all([
    db()
      .from("orders")
      .select(columns)
      .eq("status", "PENDING_PAYMENT")
      .lt("created_at", minAge)
      .order("last_reconciled_at", { ascending: true, nullsFirst: true })
      .limit(BATCH),
    db()
      .from("orders")
      .select(columns)
      .eq("status", "EXPIRED")
      .not("razorpay_order_id", "is", null)
      .gt("expires_at", expiredWindow)
      .order("last_reconciled_at", { ascending: true, nullsFirst: true })
      .limit(Math.floor(BATCH / 2)),
  ]);
  if (pending.error || expired.error) {
    return NextResponse.json({ error: pending.error?.message ?? expired.error?.message }, { status: 500 });
  }

  const orders = [...(pending.data ?? []), ...(expired.data ?? [])] as OrderRow[];
  const results = [];
  for (const order of orders) {
    try {
      results.push(await reconcileOrder(order, nowMs));
    } catch (err) {
      results.push({ ref: order.public_ref, result: `ERROR: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const errors = results.filter((r) => r.result.startsWith("ERROR"));
  if (errors.length) console.error("reconcile errors", errors);
  return NextResponse.json({ checked: results.length, results });
}
