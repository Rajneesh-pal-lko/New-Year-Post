"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { emailSchema } from "@/lib/validation";

// Admin server actions. The /admin route is behind Basic auth in proxy.ts;
// each action re-checks the credentials too, so an action can't be invoked
// from anywhere else.

async function assertAdmin() {
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER || "admin";
  const header = (await headers()).get("authorization") ?? "";
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  if (!password || password.length < 12 || header !== expected) throw new Error("Unauthorized");
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function requeuePigeon(form: FormData) {
  await assertAdmin();
  const id = str(form, "pigeonId");
  const newEmail = str(form, "newEmail");
  if (newEmail && !emailSchema.safeParse(newEmail).success) throw new Error("Invalid email");
  const { error } = await db().rpc("requeue_pigeon", { p_pigeon_id: id, p_new_email: newEmail || null });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function cancelPigeon(form: FormData) {
  await assertAdmin();
  const { error } = await db().rpc("cancel_pigeon", { p_pigeon_id: str(form, "pigeonId"), p_reason: str(form, "reason") || "Cancelled by admin" });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function moderateRelease(form: FormData) {
  await assertAdmin();
  const decision = str(form, "decision");
  if (decision !== "APPROVED" && decision !== "REJECTED") throw new Error("Bad decision");
  const { error } = await db()
    .from("universe_releases")
    .update({ moderation_status: decision, moderated_at: new Date().toISOString() })
    .eq("id", str(form, "releaseId"));
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function resolveAlert(form: FormData) {
  await assertAdmin();
  const id = str(form, "alertId");
  const query = db().from("admin_alerts").update({ resolved_at: new Date().toISOString() }).is("resolved_at", null);
  const { error } = id === "all" ? await query.not("id", "is", null) : await query.eq("id", Number(id));
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

/** Manually trigger one scheduler run (the "drain the queue" button). */
export async function runDeliveryNow() {
  await assertAdmin();
  const res = await fetch(`${env.supabaseFunctionsUrl}/deliver`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": env.cronSecret },
    body: "{}",
    cache: "no-store",
  });
  if (!res.ok) console.error("manual deliver run failed", res.status, await res.text().catch(() => ""));
  revalidatePath("/admin");
}
