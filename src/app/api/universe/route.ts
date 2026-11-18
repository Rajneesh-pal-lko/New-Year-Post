import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// GET  /api/universe?exclude=<id>   catch a random approved pigeon
// POST /api/universe { id }         report a public pigeon: it is hidden
//                                   (back to PENDING) until an admin re-reviews

export const dynamic = "force-dynamic";

const uuid = z.uuid();

export async function GET(req: Request) {
  const exclude = new URL(req.url).searchParams.get("exclude");
  const { data, error } = await db().rpc("random_universe_pigeon", {
    p_exclude: exclude && uuid.safeParse(exclude).success ? exclude : null,
  });
  if (error) return NextResponse.json({ error: "Please try again." }, { status: 500 });
  const pigeon = Array.isArray(data) ? data[0] : null;
  return NextResponse.json(
    { pigeon: pigeon ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const parsed = z.object({ id: uuid }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { data: row } = await db().from("universe_releases").select("id, report_count").eq("id", parsed.data.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await db()
    .from("universe_releases")
    .update({ moderation_status: "PENDING", report_count: row.report_count + 1 })
    .eq("id", row.id);
  await db().from("admin_alerts").insert({
    kind: "UNIVERSE_REPORT",
    message: "A public pigeon was reported and hidden until it is reviewed again.",
    detail: { release_id: row.id },
  });
  return NextResponse.json({ ok: true });
}
