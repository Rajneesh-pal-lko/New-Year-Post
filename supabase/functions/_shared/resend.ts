// Minimal Resend client: one function, plain fetch, runs in Node and Deno.
// Swapping email providers means rewriting this file (and the webhook route)
// while keeping the SendResult contract the scheduler depends on.

export type SendResult =
  | { outcome: "ACCEPTED"; id: string }
  | { outcome: "THROTTLED"; retryAfterSeconds: number; error: string }
  | { outcome: "RETRY"; error: string }
  | { outcome: "PERMANENT_FAILURE"; error: string };

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Stable per logical email. Resend drops repeats of the same key within 24h. */
  idempotencyKey: string;
  tags?: { name: string; value: string }[];
}

const RESEND_URL = "https://api.resend.com/emails";

export async function sendEmail(
  apiKey: string,
  email: OutgoingEmail,
  options: { timeoutMs?: number; url?: string } = {},
): Promise<SendResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  let res: Response;
  try {
    res = await fetch(options.url || RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
        "User-Agent": "pigeon-post-2027/1.0",
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo ? [email.replyTo] : undefined,
        tags: email.tags,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Network error or timeout. The request may or may not have reached
    // Resend; retrying with the same idempotency key is safe either way.
    return { outcome: "RETRY", error: `network: ${err instanceof Error ? err.message : String(err)}` };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body; keep going with the status code.
  }
  const detail = `${res.status} ${String(body.name ?? "")} ${String(body.message ?? "")}`.trim();

  if (res.ok && typeof body.id === "string") {
    return { outcome: "ACCEPTED", id: body.id };
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    return { outcome: "THROTTLED", retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2, error: detail };
  }
  if (res.status === 409 && body.name === "invalid_idempotent_request") {
    // Same key, different payload. Retrying cannot fix it.
    return { outcome: "PERMANENT_FAILURE", error: detail };
  }
  if (res.status === 400 || res.status === 422) {
    // Invalid request or recipient address. Retrying cannot fix it.
    return { outcome: "PERMANENT_FAILURE", error: detail };
  }
  // 401/403 (key or domain misconfigured), 409 concurrent request, 5xx, or an
  // unexpected success body: retry with backoff. Misconfiguration shows up as
  // admin alerts while there is still time to fix it.
  return { outcome: "RETRY", error: detail || `HTTP ${res.status}` };
}
