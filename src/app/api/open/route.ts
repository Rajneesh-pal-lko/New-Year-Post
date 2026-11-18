import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findPigeonByRecipientToken, firstName } from "@/lib/recipient";

// POST /api/open
//   { token, action: "opened" }                  record first open (when the envelope is opened)
//   { token, action: "release", showNames: bool } release into the Pigeon Universe
//
// Only the recipient (holder of the private link) can release. A release is
// PENDING until an admin approves it; nothing is public before that. Email
// addresses are never copied; names only if the recipient opts in, first names only.

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("opened"), token: z.string().max(100) }),
  z.object({ action: z.literal("release"), token: z.string().max(100), showNames: z.boolean() }),
]);

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;

  const pigeon = await findPigeonByRecipientToken(body.token);
  if (!pigeon) return NextResponse.json({ error: "This pigeon link isn't valid." }, { status: 404 });

  if (body.action === "opened") {
    if (!pigeon.opened_at) {
      await db().from("pigeons").update({ opened_at: new Date().toISOString() }).eq("id", pigeon.id).is("opened_at", null);
    }
    return NextResponse.json({ ok: true });
  }

  if (!pigeon.allow_public_release) {
    return NextResponse.json({ error: "The sender chose to keep this message private." }, { status: 403 });
  }
  if (pigeon.released) return NextResponse.json({ ok: true, alreadyReleased: true });

  const { error } = await db()
    .from("universe_releases")
    .insert({
      pigeon_id: pigeon.id,
      message: pigeon.message,
      from_name: body.showNames ? firstName(pigeon.sender_name) : null,
      to_name: body.showNames ? firstName(pigeon.recipient_name) : null,
    });
  if (error && error.code !== "23505") {
    console.error("release failed", pigeon.public_id, error.message);
    return NextResponse.json({ error: "Couldn't release the pigeon. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
