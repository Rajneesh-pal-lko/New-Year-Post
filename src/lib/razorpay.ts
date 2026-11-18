import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Razorpay server-side integration (Orders API + signature checks).
// Plain fetch instead of the SDK: we use four endpoints and want to see
// exactly what is sent and checked.
//
// Docs: https://razorpay.com/docs/payments/server-integration/
//       https://razorpay.com/docs/webhooks/validate-test/

const API = "https://api.razorpay.com/v1";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed" | string;
  method?: string;
  error_description?: string | null;
  captured?: boolean;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) {
    throw new RazorpayError(`Razorpay ${path} failed: ${res.status} ${body?.error?.description ?? ""}`.trim(), res.status);
  }
  return body;
}

/** Creates the Razorpay order. The amount comes from our price snapshot, never the browser. */
export function createRazorpayOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
    throw new Error(`Refusing to create Razorpay order with amount ${input.amountPaise}`);
  }
  return call<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({ amount: input.amountPaise, currency: "INR", receipt: input.receipt, notes: input.notes }),
  });
}

export function fetchPayment(paymentId: string) {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function fetchOrderPayments(razorpayOrderId: string): Promise<RazorpayPayment[]> {
  const res = await call<{ items: RazorpayPayment[] }>(`/orders/${encodeURIComponent(razorpayOrderId)}/payments`);
  return res.items ?? [];
}

function hmacHex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
 * Proves the three values came from Razorpay, but says nothing about capture;
 * we still fetch the payment before activating anything.
 */
export function verifyCheckoutSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string, secret = env.razorpayKeySecret): boolean {
  if (!signature) return false;
  return safeEqualHex(hmacHex(secret, `${razorpayOrderId}|${razorpayPaymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret). Must use the raw bytes. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | null, secret = env.razorpayWebhookSecret): boolean {
  if (!signature) return false;
  return safeEqualHex(hmacHex(secret, rawBody), signature);
}
