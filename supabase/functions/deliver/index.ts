// Supabase Edge Function: deliver
//
// Called every minute by Supabase Cron (pg_cron + pg_net), see
// supabase/setup/cron.sql. Works with nobody on the website.
//
// One run:
//   1. Claim due pigeons atomically (claim_due_pigeons: FOR UPDATE SKIP LOCKED,
//      short transaction, lease). No transaction is open after this returns.
//   2. For each claimed pigeon: derive its private link, send the email with a
//      stable idempotency key, then record the outcome in its own short
//      transaction (record_pigeon_attempt). Retries back off exponentially;
//      after the last attempt the pigeon is FAILED and an admin alert is raised.
//   3. Same pattern for order-confirmation emails (email_outbox).
//   4. Email any new admin alerts as one digest.
//   5. Write a heartbeat row to scheduler_runs.
//
// Concurrency: if a run overruns into the next minute, both runs are safe
// because a row can only be claimed by one of them (SKIP LOCKED + lease).

import { createClient } from "npm:@supabase/supabase-js@2";
import { deriveToken } from "../_shared/tokens.ts";
import { sendEmail, type SendResult } from "../_shared/resend.ts";
import { alertDigestEmail, orderConfirmationEmail, recipientPigeonEmail } from "../_shared/templates.ts";
import { formatRupeesPlain } from "../_shared/money.ts";
import { IST_OFFSET_MINUTES } from "../_shared/slots.ts";

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = env("CRON_SECRET");
const TOKEN_SECRET = env("TOKEN_SECRET");
const RESEND_API_KEY = env("RESEND_API_KEY");
const EMAIL_FROM = env("EMAIL_FROM");
const APP_BASE_URL = env("APP_BASE_URL").replace(/\/+$/, "");
const EMAIL_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") || undefined;
const ADMIN_ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL") || "";
// Only for staging tests against a mock email API. Leave unset in production.
const RESEND_API_URL = Deno.env.get("RESEND_API_URL") || undefined;

// Keep sends under the provider's per-second limit (Resend's default is per
// team; check your dashboard and raise this once Resend raises your limit).
const SENDS_PER_SECOND = envInt("EMAIL_MAX_SENDS_PER_SECOND", 4);
const MAX_BATCH = envInt("DELIVERY_BATCH_SIZE", 100);
const MAX_ATTEMPTS = envInt("DELIVERY_MAX_ATTEMPTS", 8);
const TIME_BUDGET_MS = envInt("DELIVERY_TIME_BUDGET_MS", 50_000);
const LEASE_SECONDS = 180;
const CONCURRENCY = Math.max(1, Math.min(10, SENDS_PER_SECOND * 2));

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------

type Tally = { accepted: number; retrying: number; throttled: number; failed: number; stale: number; recordErrors: number };
const tally = (): Tally => ({ accepted: 0, retrying: 0, throttled: 0, failed: 0, stale: 0, recordErrors: 0 });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spaces sends evenly so we never burst past the provider's per-second limit. */
function createRateLimiter(perSecond: number) {
  const interval = 1000 / perSecond;
  let next = Date.now();
  return {
    async acquire() {
      const now = Date.now();
      const slot = Math.max(now, next);
      next = slot + interval;
      if (slot > now) await sleep(slot - now);
    },
    pause(ms: number) {
      next = Math.max(next, Date.now() + ms);
    },
  };
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function errorText(result: SendResult): string | null {
  return "error" in result ? result.error : null;
}

function istDateOf(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + IST_OFFSET_MINUTES * 60_000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

interface PigeonJob {
  pigeon_id: string;
  claim_id: string;
  attempt: number;
  send_generation: number;
  public_id: string;
  recipient_name: string;
  recipient_email: string;
  slot_local: string;
  recipient_token_nonce: string;
  sender_name: string;
}

interface OutboxJob {
  outbox_id: string;
  claim_id: string;
  attempt: number;
  kind: string;
  order_id: string;
  idempotency_key: string;
}

async function deliverPigeon(job: PigeonJob, limiter: ReturnType<typeof createRateLimiter>, t: Tally) {
  let result: SendResult;
  try {
    const token = await deriveToken(TOKEN_SECRET, "recipient", job.pigeon_id, job.recipient_token_nonce);
    const email = recipientPigeonEmail({
      recipientName: job.recipient_name,
      senderName: job.sender_name,
      link: `${APP_BASE_URL}/open/${token}`,
    });
    await limiter.acquire();
    result = await sendEmail(RESEND_API_KEY, {
      from: EMAIL_FROM,
      to: job.recipient_email,
      replyTo: EMAIL_REPLY_TO,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `pigeon/${job.pigeon_id}/v${job.send_generation}`,
      tags: [{ name: "type", value: "pigeon" }],
    }, { url: RESEND_API_URL });
  } catch (err) {
    result = { outcome: "RETRY", error: `internal: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (result.outcome === "THROTTLED") limiter.pause(result.retryAfterSeconds * 1000);

  const { data, error } = await db.rpc("record_pigeon_attempt", {
    p_pigeon_id: job.pigeon_id,
    p_claim_id: job.claim_id,
    p_outcome: result.outcome,
    p_provider_message_id: result.outcome === "ACCEPTED" ? result.id : null,
    p_error: errorText(result),
    p_max_attempts: MAX_ATTEMPTS,
    p_retry_after_seconds: result.outcome === "THROTTLED" ? Math.ceil(result.retryAfterSeconds) : null,
  });

  if (error) {
    // The email may have gone out but we couldn't record it. The lease will
    // expire, the pigeon will be reclaimed, and the idempotency key makes the
    // provider return the original email instead of sending a second one.
    t.recordErrors++;
    console.error("record_pigeon_attempt failed", job.public_id, error.message);
    return;
  }
  if (data === "EMAIL_ACCEPTED") t.accepted++;
  else if (data === "FAILED") t.failed++;
  else if (data === "STALE") t.stale++;
  else if (result.outcome === "THROTTLED") t.throttled++;
  else t.retrying++;
}

async function deliverOutbox(job: OutboxJob, limiter: ReturnType<typeof createRateLimiter>, t: Tally) {
  let result: SendResult;
  try {
    if (job.kind !== "ORDER_CONFIRMATION") throw new Error(`unknown outbox kind ${job.kind}`);

    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, public_ref, sender_name, sender_email, amount_paise, access_token_nonce")
      .eq("id", job.order_id)
      .single();
    if (orderErr || !order) throw new Error(`order lookup failed: ${orderErr?.message}`);

    const { data: pigeons, error: pigeonErr } = await db
      .from("pigeons")
      .select("public_id, recipient_name, slot_local, scheduled_at_utc")
      .eq("order_id", job.order_id)
      .order("position");
    if (pigeonErr || !pigeons?.length) throw new Error(`pigeon lookup failed: ${pigeonErr?.message}`);

    // Order links are derived from the public ref (see src/app/api/orders/route.ts).
    const token = await deriveToken(TOKEN_SECRET, "order", order.public_ref, order.access_token_nonce);
    const email = orderConfirmationEmail({
      senderName: order.sender_name,
      orderRef: order.public_ref,
      orderLink: `${APP_BASE_URL}/order/${order.public_ref}?k=${token}`,
      amountRupees: formatRupeesPlain(order.amount_paise),
      deliveryDate: istDateOf(pigeons[0].scheduled_at_utc),
      pigeons: pigeons.map((p) => ({ publicId: p.public_id, recipientName: p.recipient_name, slot: p.slot_local })),
    });

    await limiter.acquire();
    result = await sendEmail(RESEND_API_KEY, {
      from: EMAIL_FROM,
      to: order.sender_email,
      replyTo: EMAIL_REPLY_TO,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: job.idempotency_key,
      tags: [{ name: "type", value: "order_confirmation" }],
    }, { url: RESEND_API_URL });
  } catch (err) {
    result = { outcome: "RETRY", error: `internal: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (result.outcome === "THROTTLED") limiter.pause(result.retryAfterSeconds * 1000);

  const { data, error } = await db.rpc("record_outbox_attempt", {
    p_outbox_id: job.outbox_id,
    p_claim_id: job.claim_id,
    p_outcome: result.outcome,
    p_provider_message_id: result.outcome === "ACCEPTED" ? result.id : null,
    p_error: errorText(result),
    p_max_attempts: MAX_ATTEMPTS,
    p_retry_after_seconds: result.outcome === "THROTTLED" ? Math.ceil(result.retryAfterSeconds) : null,
  });
  if (error) {
    t.recordErrors++;
    console.error("record_outbox_attempt failed", job.outbox_id, error.message);
    return;
  }
  if (data === "SENT") t.accepted++;
  else if (data === "FAILED") t.failed++;
  else if (data === "STALE") t.stale++;
  else if (result.outcome === "THROTTLED") t.throttled++;
  else t.retrying++;
}

/** Claims and processes batches until nothing is due or the time budget runs out. */
async function drain<J>(
  rpcName: "claim_due_pigeons" | "claim_due_outbox",
  deadline: number,
  handle: (job: J) => Promise<void>,
): Promise<void> {
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 5_000) return;
    // Never claim more than we can send before the deadline; anything we claim
    // and don't finish waits for its lease to expire.
    const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(((remainingMs - 3_000) / 1000) * SENDS_PER_SECOND)));
    const { data: jobs, error } = await db.rpc(rpcName, { p_limit: limit, p_lease_seconds: LEASE_SECONDS });
    if (error) throw new Error(`${rpcName} failed: ${error.message}`);
    if (!jobs || jobs.length === 0) return;
    await runPool(jobs as J[], CONCURRENCY, handle);
    if (jobs.length < limit) return;
  }
}

async function emailAlertDigest(limiter: ReturnType<typeof createRateLimiter>): Promise<number> {
  if (!ADMIN_ALERT_EMAIL) return 0;
  const { data: alerts, error } = await db
    .from("admin_alerts")
    .select("id, kind, message, created_at")
    .is("emailed_at", null)
    .order("id")
    .limit(50);
  if (error || !alerts?.length) return 0;

  const email = alertDigestEmail(alerts);
  await limiter.acquire();
  const result = await sendEmail(RESEND_API_KEY, {
    from: EMAIL_FROM,
    to: ADMIN_ALERT_EMAIL,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `alerts/${alerts[0].id}-${alerts[alerts.length - 1].id}`,
    tags: [{ name: "type", value: "admin_alert" }],
  }, { url: RESEND_API_URL });
  if (result.outcome !== "ACCEPTED") {
    console.error("alert digest failed", errorText(result));
    return 0;
  }
  await db
    .from("admin_alerts")
    .update({ emailed_at: new Date().toISOString() })
    .in("id", alerts.map((a) => a.id));
  return alerts.length;
}

/** One alert (at most every 10 minutes) when sends are failing across the board. */
async function raiseSystemicAlertIfNeeded(p: Tally, errors: string[]) {
  const failing = p.retrying + p.failed + p.recordErrors;
  if (p.accepted > 0 || (failing < 5 && errors.length === 0)) return;
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db
    .from("admin_alerts")
    .select("id", { count: "exact", head: true })
    .eq("kind", "SCHEDULER_UNHEALTHY")
    .gte("created_at", since);
  if ((count ?? 0) > 0) return;
  await db.from("admin_alerts").insert({
    kind: "SCHEDULER_UNHEALTHY",
    message: `Scheduler run had ${failing} failing sends and ${errors.length} errors, 0 accepted. Check the provider and the function logs.`,
    detail: { tally: p, errors: errors.slice(0, 5) },
  });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const startedAt = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const limiter = createRateLimiter(SENDS_PER_SECOND);
  const pigeons = tally();
  const confirmations = tally();
  const errors: string[] = [];
  let alertsEmailed = 0;

  try {
    // Pigeons first: they are the time-critical work.
    await drain<PigeonJob>("claim_due_pigeons", deadline, (job) => deliverPigeon(job, limiter, pigeons));
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  try {
    await drain<OutboxJob>("claim_due_outbox", deadline, (job) => deliverOutbox(job, limiter, confirmations));
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  try {
    await raiseSystemicAlertIfNeeded(pigeons, errors);
    alertsEmailed = await emailAlertDigest(limiter);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const summary = { pigeons, confirmations, alertsEmailed, errors, durationMs: Date.now() - startedAt.getTime() };
  const { error: runErr } = await db.from("scheduler_runs").insert({ started_at: startedAt.toISOString(), summary });
  if (runErr) console.error("scheduler_runs insert failed", runErr.message);

  // Keep the heartbeat table small.
  if (startedAt.getUTCMinutes() === 0) {
    await db.from("scheduler_runs").delete().lt("started_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  }

  return Response.json(summary, { status: errors.length ? 500 : 200 });
});
