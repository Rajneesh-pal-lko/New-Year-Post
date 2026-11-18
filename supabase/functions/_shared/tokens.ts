// Secret links without storing secrets.
//
// Shared by the Next.js app (Node) and the `deliver` Edge Function (Deno).
// Uses only Web Crypto, so it runs unchanged in both. No imports on purpose.
//
// How it works
//   token = base64url( HMAC-SHA256( TOKEN_SECRET, "<purpose>:<id>:<nonce>" ) )
//   hash  = hex( SHA-256( token ) )
//
// The database stores only the nonce and the hash. To build a link (in an
// email) we re-derive the token from TOKEN_SECRET + nonce. To check a link we
// hash the presented token and look the hash up. A database leak alone does
// not reveal any working link, and the email can be retried and still carry
// the same link, which matters for idempotent sends.

export type TokenPurpose = "recipient" | "order";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 16 random bytes, base64url. Stored in the database next to the hash. */
export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function deriveToken(secret: string, purpose: TokenPurpose, id: string, nonce: string): Promise<string> {
  if (!secret || secret.length < 32) {
    throw new Error("TOKEN_SECRET is missing or shorter than 32 characters");
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}:${id}:${nonce}`));
  return toBase64Url(new Uint8Array(sig));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toHex(new Uint8Array(digest));
}

/** Cheap shape check before touching the database. Tokens are 43 base64url chars. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
