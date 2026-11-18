import "server-only";
import { now } from "./campaign";
import { db } from "./db";
import { hashToken, looksLikeToken } from "./tokens";

// Looks up the pigeon behind a recipient link. The token itself is never
// stored; we hash what was presented and look the hash up (unique index).

export interface RecipientPigeon {
  id: string;
  public_id: string;
  recipient_name: string;
  message: string;
  slot_local: string;
  scheduled_at_utc: string;
  status: string;
  opened_at: string | null;
  sender_name: string;
  allow_public_release: boolean;
  released: boolean;
}

export async function findPigeonByRecipientToken(token: string): Promise<RecipientPigeon | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token);
  const { data, error } = await db()
    .from("pigeons")
    .select(
      "id, public_id, recipient_name, message, slot_local, scheduled_at_utc, status, opened_at, orders!inner(sender_name, allow_public_release, status), universe_releases(id)",
    )
    .eq("recipient_token_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`Recipient lookup failed: ${error.message}`);
  if (!data) return null;

  const order = (Array.isArray(data.orders) ? data.orders[0] : data.orders) as {
    sender_name: string;
    allow_public_release: boolean;
    status: string;
  };
  const releases = data.universe_releases as unknown;
  const released = Array.isArray(releases) ? releases.length > 0 : Boolean(releases);

  // Defence in depth: the link only exists after sending, but never reveal a
  // message for an unpaid order, a cancelled pigeon, or before its slot.
  if (order.status !== "PAID" || data.status === "CANCELLED" || data.status === "PENDING_PAYMENT") return null;
  if (new Date(data.scheduled_at_utc) > now()) return null;

  return {
    id: data.id,
    public_id: data.public_id,
    recipient_name: data.recipient_name,
    message: data.message,
    slot_local: data.slot_local,
    scheduled_at_utc: data.scheduled_at_utc,
    status: data.status,
    opened_at: data.opened_at,
    sender_name: order.sender_name,
    allow_public_release: order.allow_public_release,
    released,
  };
}

/** First word of a display name, for the public Universe. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.slice(0, 30) ?? "";
}
