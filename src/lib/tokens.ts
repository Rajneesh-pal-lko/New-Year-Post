import "server-only";
import { timingSafeEqual } from "node:crypto";
import { deriveToken, hashToken, looksLikeToken, randomNonce, type TokenPurpose } from "@shared/tokens";
import { env } from "./env";

export { hashToken, looksLikeToken };

export interface IssuedToken {
  token: string;
  nonce: string;
  hash: string;
}

/** New link secret for an order or pigeon. Store nonce + hash; hand out token. */
export async function issueToken(purpose: TokenPurpose, id: string): Promise<IssuedToken> {
  const nonce = randomNonce();
  const token = await deriveToken(env.tokenSecret, purpose, id, nonce);
  return { token, nonce, hash: await hashToken(token) };
}

/** Constant-time comparison of a presented token with a stored hash. */
export async function tokenMatches(token: string | null | undefined, storedHash: string): Promise<boolean> {
  if (!token || !looksLikeToken(token)) return false;
  const a = Buffer.from(await hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time string comparison for shared secrets in headers. */
export function secretMatches(presented: string | null | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
