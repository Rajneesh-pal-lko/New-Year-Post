import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies Resend webhooks, which are signed with the Svix scheme:
//   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
//   key            = base64-decoded part of the secret after "whsec_"
//   svix-signature = space-separated "v1,<base64 HMAC-SHA256>" entries
// We also reject timestamps more than 5 minutes off, to stop replays.

const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(input: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const { rawBody, id, timestamp, signatureHeader, secret } = input;
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
