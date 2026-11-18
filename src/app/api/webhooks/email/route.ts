import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifySvixSignature } from "@/lib/svix";

// POST /api/webhooks/email   (Resend)
//
// Subscribe in Resend to: email.delivered, email.bounced, email.delivery_delayed,
// email.complained, email.failed.
//
// This is where "Delivered" comes from. The scheduler only ever marks a pigeon
// EMAIL_ACCEPTED (the provider took the request); DELIVERED_BY_PROVIDER and
// bounces are set here, from signed provider events.

export const dynamic = "force-dynamic";

const HANDLED = new Set(["email.delivered", "email.bounced", "email.delivery_delayed", "email.complained", "email.failed"]);

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: unknown; [key: string]: unknown };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const ok = verifySvixSignature({
    rawBody,
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signatureHeader: req.headers.get("svix-signature"),
    secret: env.resendWebhookSecret,
  });
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventId = req.headers.get("svix-id")!;
  if (!HANDLED.has(event.type) || !event.data?.email_id) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { error: insertErr } = await db()
    .from("webhook_events")
    .insert({ source: "resend", event_id: eventId, event_type: event.type, payload: event });
  if (insertErr) {
    if (insertErr.code !== "23505") return NextResponse.json({ error: "storage error" }, { status: 500 });
    const { data: existing } = await db()
      .from("webhook_events")
      .select("processed_at")
      .eq("source", "resend")
      .eq("event_id", eventId)
      .single();
    if (existing?.processed_at) return NextResponse.json({ ok: true, duplicate: true });
  }

  const detail = {
    type: event.type,
    created_at: event.created_at ?? null,
    bounce: event.data.bounce ?? null,
  };
  const { data: result, error } = await db().rpc("apply_email_event", {
    p_message_id: event.data.email_id,
    p_event_type: event.type,
    p_detail: detail,
  });
  if (error) {
    await db().from("webhook_events").update({ last_error: error.message }).eq("source", "resend").eq("event_id", eventId);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  if (result === "NOT_FOUND") {
    // The event can beat us to recording the provider message id (we record
    // it right after the send call returns). Ask the provider to retry for a
    // few minutes; after that, accept and drop it (e.g. alert-digest emails).
    const ageMs = event.created_at ? Date.now() - new Date(event.created_at).getTime() : Infinity;
    if (ageMs < 10 * 60_000) {
      await db().from("webhook_events").update({ last_error: "message id not found yet" }).eq("source", "resend").eq("event_id", eventId);
      return NextResponse.json({ error: "not found yet, retry" }, { status: 503 });
    }
  }

  await db()
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString(), last_error: null })
    .eq("source", "resend")
    .eq("event_id", eventId);
  return NextResponse.json({ ok: true, result });
}
