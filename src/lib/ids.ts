// Short, friendly public identifiers. They are NOT secrets: anything private
// is behind a separate high-entropy token. The alphabet drops look-alikes
// (0/O, 1/I/L) so IDs survive being read aloud or retyped.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 symbols

function randomString(length: number): string {
  const out: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // Rejection sampling keeps every symbol equally likely.
      if (b < 248 && out.length < length) out.push(ALPHABET[b % 31]);
    }
  }
  return out.join("");
}

/** e.g. PP-7KQ2XM9D4R */
export function newOrderRef(): string {
  return `PP-${randomString(10)}`;
}

/** e.g. PGN-H4TQ8ZKM (31^8 ≈ 8.5 × 10^11 combinations) */
export function newPigeonId(): string {
  return `PGN-${randomString(8)}`;
}

export function looksLikeOrderRef(value: string): boolean {
  return /^PP-[A-HJKMNP-Z2-9]{10}$/.test(value);
}

export function looksLikePigeonId(value: string): boolean {
  return /^PGN-[A-HJKMNP-Z2-9]{8}$/.test(value);
}
