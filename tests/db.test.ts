// Integration tests for the SQL layer, against a real Postgres.
//
//   DATABASE_URL=postgres://user:pass@localhost:5432/postgres npm run test:db
//
// The URL must be a superuser on a DISPOSABLE server: the suite creates a
// fresh database, mimics Supabase's roles and default grants, applies the
// migration, and drops the database afterwards. Skipped if DATABASE_URL is unset.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { slotToUtc } from "@shared/slots";

const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATION = path.resolve(__dirname, "../supabase/migrations/20261118000000_init.sql");

function istDate(offsetDays: number): string {
  return new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!ADMIN_URL)("database (SQL functions, triggers, permissions)", () => {
  const dbName = `pp_test_${Date.now()}`;
  let dbUrl: string;
  let pool: Pool; // runs as service_role, like the app and Edge Function
  let su: Client; // superuser, for setup and peeking

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0];

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
    }
    await admin.query("alter role service_role bypassrls");
    await admin.end();

    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    dbUrl = url.toString();

    su = new Client({ connectionString: dbUrl });
    await su.connect();
    // What Supabase does for the public schema: everyone gets everything by default.
    await su.query(`
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    `);
    await su.query(readFileSync(MIGRATION, "utf8"));

    pool = new Pool({ connectionString: dbUrl, max: 4 });
    pool.on("connect", (client) => {
      client.query("set role service_role");
    });
  });

  afterAll(async () => {
    await pool?.end();
    await su?.end();
    if (ADMIN_URL) {
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await su.query(
      "truncate orders, pigeons, payments, webhook_events, delivery_events, email_outbox, universe_releases, admin_alerts, scheduler_runs cascade",
    );
  });

  // ---------------------------------------------------------------- helpers

  async function createOrder(opts: { size?: number; day?: string; slot?: string; email?: string; amount?: number } = {}) {
    const size = opts.size ?? 1;
    const day = opts.day ?? istDate(-1); // yesterday IST: already due
    const slot = opts.slot ?? "00:00";
    const ref = `PP-${randomUUID().slice(0, 10)}`;
    const res = await one<{ r: { order_id: string } }>("select create_order_with_pigeons($1, $2, 15) as r", [
      {
        public_ref: ref,
        sender_name: "Raj",
        sender_email: opts.email ?? `raj+${ref}@example.com`,
        package_size: size,
        tier_id: "T1",
        amount_paise: opts.amount ?? 4900,
        price_snapshot: { tierId: "T1" },
        allow_public_release: true,
        access_token_nonce: "nonce",
        access_token_hash: `hash-${ref}`,
      },
      // node-pg sends JS arrays as Postgres arrays, so JSON arrays are stringified.
      JSON.stringify(
        Array.from({ length: size }, (_, i) => ({
          position: i + 1,
          public_id: `PGN-${randomUUID().slice(0, 8)}`,
          recipient_name: `R${i + 1}`,
          recipient_email: `r${i + 1}@example.com`,
          message: "Happy New Year",
          slot_local: slot,
          scheduled_at_utc: slotToUtc(day, slot).toISOString(),
        })),
      ),
    ]);
    const orderId = res.r.order_id;
    const rzp = `order_${ref}`;
    await q("update orders set razorpay_order_id = $2 where id = $1", [orderId, rzp]);
    const pigeonIds = (await q<{ id: string }>("select id from pigeons where order_id = $1 order by position", [orderId])).map((r) => r.id);
    return { orderId, ref, rzp, pigeonIds, amount: opts.amount ?? 4900 };
  }

  function payment(o: { rzp: string; amount: number }, overrides: Record<string, unknown> = {}) {
    return { id: `pay_${randomUUID().slice(0, 8)}`, order_id: o.rzp, amount: o.amount, currency: "INR", status: "captured", method: "upi", raw: {}, ...overrides };
  }

  async function confirm(o: { orderId: string; pigeonIds: string[] }, pay: Record<string, unknown>) {
    const tokens = o.pigeonIds.map((id) => ({ pigeon_id: id, nonce: `n-${id}`, hash: `h-${id}-${randomUUID()}` }));
    return (await one<{ r: string }>("select confirm_order_payment($1, $2, $3) as r", [o.orderId, pay, JSON.stringify(tokens)])).r;
  }

  const claim = (limit = 50) => q<{ pigeon_id: string; claim_id: string; attempt: number; sender_name: string }>("select * from claim_due_pigeons($1, 120)", [limit]);
  const status = async (pigeonId: string) => (await one<{ status: string }>("select status from pigeons where id = $1", [pigeonId])).status;

  // ---------------------------------------------------------------- checkout

  it("creates an order with exactly package_size pigeons, or nothing", async () => {
    const o = await createOrder({ size: 3 });
    expect(o.pigeonIds).toHaveLength(3);

    await expect(
      one("select create_order_with_pigeons($1, $2, 15)", [
        { public_ref: "PP-MISMATCH1", sender_name: "x", sender_email: "x@e.com", package_size: 3, tier_id: "T1", amount_paise: 12900, price_snapshot: {}, access_token_nonce: "n", access_token_hash: "h-mm" },
        JSON.stringify([{ position: 1, public_id: "PGN-MISMATCH", recipient_name: "a", recipient_email: "a@e.com", message: "m", slot_local: "00:00", scheduled_at_utc: slotToUtc("2027-01-01", "00:00").toISOString() }]),
      ]),
    ).rejects.toThrow(/PIGEON_COUNT_MISMATCH/);
    expect((await one<{ n: string }>("select count(*) as n from orders where public_ref = 'PP-MISMATCH1'")).n).toBe("0");
  });

  it("rejects a scheduled time that does not match the IST slot", async () => {
    await expect(
      one("select create_order_with_pigeons($1, $2, 15)", [
        { public_ref: "PP-BADSLOT01", sender_name: "x", sender_email: "x@e.com", package_size: 1, tier_id: "T1", amount_paise: 4900, price_snapshot: {}, access_token_nonce: "n", access_token_hash: "h-bs" },
        JSON.stringify([{ position: 1, public_id: "PGN-BADSLOT1", recipient_name: "a", recipient_email: "a@e.com", message: "m", slot_local: "00:30", scheduled_at_utc: slotToUtc("2027-01-01", "00:00").toISOString() }]),
      ]),
    ).rejects.toThrow(/pigeons_slot_matches_utc/);
  });

  it("rate-limits orders per sender email", async () => {
    for (let i = 0; i < 10; i++) await createOrder({ email: "busy@example.com" });
    await expect(createOrder({ email: "busy@example.com" })).rejects.toThrow(/RATE_LIMITED/);
  });

  // ---------------------------------------------------------------- payments

  it("never activates pigeons of an unpaid order, even with a direct update", async () => {
    const o = await createOrder();
    await expect(q("update pigeons set status = 'SCHEDULED' where id = $1", [o.pigeonIds[0]])).rejects.toThrow(/UNPAID_ACTIVATION/);
  });

  it("refuses non-captured payments", async () => {
    const o = await createOrder();
    await expect(confirm(o, payment(o, { status: "authorized" }))).rejects.toThrow(/PAYMENT_NOT_CAPTURED/);
    expect(await status(o.pigeonIds[0])).toBe("PENDING_PAYMENT");
  });

  it("activates on a matching captured payment, exactly once", async () => {
    const o = await createOrder({ size: 3, amount: 12900 });
    const pay = payment(o);
    expect(await confirm(o, pay)).toBe("ACTIVATED");

    const order = await one<{ status: string; paid_payment_id: string }>("select status, paid_payment_id from orders where id = $1", [o.orderId]);
    expect(order).toMatchObject({ status: "PAID", paid_payment_id: pay.id });
    const pigeons = await q<{ status: string; recipient_token_hash: string; next_attempt_at: Date; scheduled_at_utc: Date }>(
      "select status, recipient_token_hash, next_attempt_at, scheduled_at_utc from pigeons where order_id = $1",
      [o.orderId],
    );
    expect(pigeons.every((p) => p.status === "SCHEDULED" && p.recipient_token_hash && +p.next_attempt_at === +p.scheduled_at_utc)).toBe(true);
    expect((await one<{ n: string }>("select count(*) as n from email_outbox where order_id = $1", [o.orderId])).n).toBe("1");

    // Webhook + callback + reconciliation all arriving: no double effects.
    expect(await confirm(o, pay)).toBe("ALREADY_PAID");
    expect(await confirm(o, pay)).toBe("ALREADY_PAID");
    expect((await one<{ n: string }>("select count(*) as n from email_outbox where order_id = $1", [o.orderId])).n).toBe("1");
    expect((await one<{ n: string }>("select count(*) as n from payments where order_id = $1", [o.orderId])).n).toBe("1");
  });

  it("flags a second captured payment for the same order", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const second = payment(o);
    expect(await confirm(o, second)).toBe("DUPLICATE_PAYMENT");
    expect((await one<{ flag: string }>("select flag from payments where razorpay_payment_id = $1", [second.id])).flag).toBe("DUPLICATE_PAYMENT");
    expect((await one<{ n: string }>("select count(*) as n from admin_alerts where kind = 'DUPLICATE_PAYMENT'")).n).toBe("1");
  });

  it("does not activate on an amount or currency mismatch", async () => {
    const o = await createOrder({ amount: 19900, size: 5 });
    expect(await confirm(o, payment(o, { amount: 100 }))).toBe("AMOUNT_MISMATCH");
    expect(await status(o.pigeonIds[0])).toBe("PENDING_PAYMENT");
    expect((await one<{ status: string }>("select status from orders where id = $1", [o.orderId])).status).toBe("PENDING_PAYMENT");
    expect((await one<{ n: string }>("select count(*) as n from admin_alerts where kind = 'AMOUNT_MISMATCH'")).n).toBe("1");
  });

  it("rejects a payment that belongs to a different Razorpay order", async () => {
    const o = await createOrder();
    await expect(confirm(o, payment(o, { order_id: "order_someone_else" }))).rejects.toThrow(/RAZORPAY_ORDER_MISMATCH/);
  });

  it("honours a capture that arrives after the checkout expired", async () => {
    const o = await createOrder();
    await q("update orders set status = 'EXPIRED' where id = $1", [o.orderId]);
    expect(await confirm(o, payment(o))).toBe("ACTIVATED");
  });

  it("never moves an order backwards from PAID", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    await expect(q("update orders set status = 'EXPIRED' where id = $1", [o.orderId])).rejects.toThrow(/ORDER_FORWARD_ONLY/);
    await expect(q("update orders set status = 'PENDING_PAYMENT' where id = $1", [o.orderId])).rejects.toThrow(/ORDER_FORWARD_ONLY/);
  });

  it("a late payment.failed never downgrades a captured payment", async () => {
    const o = await createOrder();
    const pay = payment(o);
    await confirm(o, pay);
    await q("select record_payment_failure($1)", [{ ...pay, error_description: "late failure" }]);
    expect((await one<{ status: string }>("select status from payments where razorpay_payment_id = $1", [pay.id])).status).toBe("captured");
  });

  // ---------------------------------------------------------------- delivery

  it("claims only paid, due pigeons", async () => {
    const unpaid = await createOrder();
    const future = await createOrder({ day: istDate(2) });
    await confirm(future, payment(future));
    const due = await createOrder({ size: 3, amount: 12900 });
    await confirm(due, payment(due));

    const claimed = await claim();
    expect(claimed.map((c) => c.pigeon_id).sort()).toEqual([...due.pigeonIds].sort());
    expect(claimed[0].sender_name).toBe("Raj");
    expect(claimed.every((c) => c.attempt === 1)).toBe(true);
    expect(await status(unpaid.pigeonIds[0])).toBe("PENDING_PAYMENT");
    expect(await status(future.pigeonIds[0])).toBe("SCHEDULED");
    expect(await claim()).toHaveLength(0); // nothing claimed twice
  });

  it("never gives the same pigeon to two concurrent runs", async () => {
    const o = await createOrder({ size: 20, amount: 59900 });
    await confirm(o, payment(o));
    const runs = await Promise.all([claim(6), claim(6), claim(6), claim(6)]);
    const ids = runs.flat().map((c) => c.pigeon_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
  });

  it("records an accepted send honestly as EMAIL_ACCEPTED, not delivered", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const [job] = await claim();
    const r = await one<{ r: string }>("select record_pigeon_attempt($1, $2, 'ACCEPTED', 'em_1') as r", [job.pigeon_id, job.claim_id]);
    expect(r.r).toBe("EMAIL_ACCEPTED");
    const p = await one<{ status: string; provider_message_id: string; locked_until: Date | null }>(
      "select status, provider_message_id, locked_until from pigeons where id = $1",
      [job.pigeon_id],
    );
    expect(p).toMatchObject({ status: "EMAIL_ACCEPTED", provider_message_id: "em_1", locked_until: null });
  });

  it("retries with exponential backoff, then dead-letters with an alert", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    let [job] = await claim();
    expect(await one<{ r: string }>("select record_pigeon_attempt($1, $2, 'RETRY', null, 'HTTP 500', 3) as r", [job.pigeon_id, job.claim_id])).toEqual({ r: "SCHEDULED" });
    const after1 = await one<{ secs: number }>("select extract(epoch from next_attempt_at - now())::int as secs from pigeons where id = $1", [job.pigeon_id]);
    expect(after1.secs).toBeGreaterThanOrEqual(28);
    expect(after1.secs).toBeLessThanOrEqual(31);

    // Make it due again and fail twice more (max 3 attempts).
    for (const expected of ["SCHEDULED", "FAILED"]) {
      await su.query("update pigeons set next_attempt_at = now() - interval '1 second' where id = $1", [job.pigeon_id]);
      [job] = await claim();
      const r = await one<{ r: string }>("select record_pigeon_attempt($1, $2, 'RETRY', null, 'HTTP 500', 3) as r", [job.pigeon_id, job.claim_id]);
      expect(r.r).toBe(expected);
    }
    expect(job.attempt).toBe(3);
    expect(await status(job.pigeon_id)).toBe("FAILED");
    expect((await one<{ n: string }>("select count(*) as n from admin_alerts where kind = 'DELIVERY_FAILED'")).n).toBe("1");
    expect((await one<{ n: string }>("select count(*) as n from delivery_events where pigeon_id = $1", [job.pigeon_id])).n).toBe("4"); // SCHEDULED + 3 attempts
  });

  it("does not count provider throttling as an attempt", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const [job] = await claim();
    await q("select record_pigeon_attempt($1, $2, 'THROTTLED', null, '429', 8, 3)", [job.pigeon_id, job.claim_id]);
    const p = await one<{ status: string; attempts: number }>("select status, attempts from pigeons where id = $1", [job.pigeon_id]);
    expect(p).toEqual({ status: "SCHEDULED", attempts: 0 });
  });

  it("reclaims a pigeon whose run crashed mid-send, and ignores the stale result", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const [first] = await claim();
    expect(await claim()).toHaveLength(0); // still leased

    await su.query("update pigeons set locked_until = now() - interval '1 second' where id = $1", [first.pigeon_id]);
    const [second] = await claim();
    expect(second.pigeon_id).toBe(first.pigeon_id);
    expect(second.attempt).toBe(2);
    expect(second.claim_id).not.toBe(first.claim_id);

    // The crashed run's late result is ignored; the live claim's result wins.
    expect((await one<{ r: string }>("select record_pigeon_attempt($1, $2, 'ACCEPTED', 'em_old') as r", [first.pigeon_id, first.claim_id])).r).toBe("STALE");
    expect((await one<{ r: string }>("select record_pigeon_attempt($1, $2, 'ACCEPTED', 'em_new') as r", [second.pigeon_id, second.claim_id])).r).toBe("EMAIL_ACCEPTED");
  });

  it("applies provider events: delivered, then a later bounce wins", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const [job] = await claim();
    await q("select record_pigeon_attempt($1, $2, 'ACCEPTED', 'em_42')", [job.pigeon_id, job.claim_id]);

    expect((await one<{ r: string }>("select apply_email_event('em_42', 'email.delivered', '{}') as r")).r).toBe("APPLIED");
    expect(await status(job.pigeon_id)).toBe("DELIVERED_BY_PROVIDER");
    await q("select apply_email_event('em_42', 'email.delivery_delayed', '{}')");
    expect(await status(job.pigeon_id)).toBe("DELIVERED_BY_PROVIDER");
    await q("select apply_email_event('em_42', 'email.bounced', '{}')");
    expect(await status(job.pigeon_id)).toBe("FAILED");
    // A delivered event arriving late does not resurrect it.
    await q("select apply_email_event('em_42', 'email.delivered', '{}')");
    expect(await status(job.pigeon_id)).toBe("FAILED");
    expect((await one<{ r: string }>("select apply_email_event('em_unknown', 'email.delivered', '{}') as r")).r).toBe("NOT_FOUND");
  });

  it("re-queues a failed pigeon with a new idempotency generation and corrected email", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const [job] = await claim();
    await q("select record_pigeon_attempt($1, $2, 'PERMANENT_FAILURE', null, '422 invalid to')", [job.pigeon_id, job.claim_id]);
    expect(await status(job.pigeon_id)).toBe("FAILED");

    expect((await one<{ r: string }>("select requeue_pigeon($1, 'fixed@example.com') as r", [job.pigeon_id])).r).toBe("SCHEDULED");
    const p = await one<{ send_generation: number; recipient_email: string; attempts: number }>(
      "select send_generation, recipient_email, attempts from pigeons where id = $1",
      [job.pigeon_id],
    );
    expect(p).toEqual({ send_generation: 2, recipient_email: "fixed@example.com", attempts: 0 });
    const [again] = await claim();
    expect(again.pigeon_id).toBe(job.pigeon_id);
  });

  it("cancels only pigeons that are not in flight or sent", async () => {
    const o = await createOrder({ size: 3, amount: 12900 });
    await confirm(o, payment(o));
    expect((await one<{ r: string }>("select cancel_pigeon($1, 'abuse') as r", [o.pigeonIds[0]])).r).toBe("CANCELLED");
    const jobs = await claim();
    expect(jobs.map((j) => j.pigeon_id)).not.toContain(o.pigeonIds[0]);
    expect((await one<{ r: string }>("select cancel_pigeon($1) as r", [jobs[0].pigeon_id])).r).toBe("NOT_CANCELLABLE");
  });

  it("sends each order confirmation through the outbox once", async () => {
    const o = await createOrder();
    await confirm(o, payment(o));
    const jobs = await q<{ outbox_id: string; claim_id: string; idempotency_key: string }>("select * from claim_due_outbox(10, 120)");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`order-confirmation/${o.orderId}`);
    expect((await one<{ r: string }>("select record_outbox_attempt($1, $2, 'ACCEPTED', 'em_c1') as r", [jobs[0].outbox_id, jobs[0].claim_id])).r).toBe("SENT");
    expect(await q("select * from claim_due_outbox(10, 120)")).toHaveLength(0);
  });

  // ---------------------------------------------------------------- universe & admin

  it("only approved releases are ever served publicly", async () => {
    const o = await createOrder({ size: 3, amount: 12900 });
    await confirm(o, payment(o));
    await q("insert into universe_releases (pigeon_id, message, moderation_status) values ($1, 'pending one', 'PENDING'), ($2, 'rejected one', 'REJECTED'), ($3, 'approved one', 'APPROVED')", o.pigeonIds);
    for (let i = 0; i < 5; i++) {
      const rows = await q<{ message: string }>("select * from random_universe_pigeon()");
      expect(rows.map((r) => r.message)).toEqual(["approved one"]);
    }
  });

  it("admin_stats summarises the system", async () => {
    const o = await createOrder({ size: 3, amount: 12900, slot: "00:00" });
    await confirm(o, payment(o));
    const s = (await one<{ s: { orders: Record<string, number>; slots: Record<string, number>; paid_revenue_paise: number; due_now: number } }>("select admin_stats() as s")).s;
    expect(s.orders.PAID).toBe(1);
    expect(s.slots["00:00"]).toBe(3);
    expect(s.paid_revenue_paise).toBe(12900);
    expect(s.due_now).toBe(3);
  });

  // ---------------------------------------------------------------- lockdown

  it("the public (anon) role cannot read tables or call functions", async () => {
    const o = await createOrder();
    const client = await pool.connect();
    try {
      await client.query("set role anon");
      await expect(client.query("select * from orders")).rejects.toThrow(/permission denied/);
      await expect(client.query("select * from pigeons")).rejects.toThrow(/permission denied/);
      await expect(client.query("select * from claim_due_pigeons(10, 60)")).rejects.toThrow(/permission denied/);
      await expect(client.query("select confirm_order_payment($1, '{}', '[]')", [o.orderId])).rejects.toThrow(/permission denied/);
      await client.query("set role authenticated");
      await expect(client.query("select * from orders")).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("reset role");
      await client.query("set role service_role");
      client.release();
    }
  });
});
