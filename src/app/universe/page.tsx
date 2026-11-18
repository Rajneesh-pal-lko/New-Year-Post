import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteChrome";
import { UniverseSky } from "@/components/UniverseSky";
import { db } from "@/lib/db";

// The Pigeon Universe: real letters that recipients chose to release and we
// approved. Nothing is seeded. Before 1 January it is honestly empty.

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "The Pigeon Universe: Pigeon Post 2027",
  description: "A sky of real New Year letters, released by the people who received them.",
};

export default async function UniversePage() {
  const { count, error } = await db()
    .from("universe_releases")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "APPROVED");
  if (error) throw new Error(`Universe count failed: ${error.message}`);
  const approved = count ?? 0;

  return (
    <div className="universe">
      <SiteHeader />
      <main className="universe__inner">
        <h1 style={{ fontSize: "clamp(2.2rem, 8vw, 3.4rem)" }}>The Pigeon Universe</h1>
        <p className="universe__intro">
          Every pigeon here carried a real New Year letter. The people who received them chose to set them free.
          {approved > 0 && " Tap a pigeon to catch it and read its letter."}
        </p>
        <UniverseSky approvedCount={approved} />
      </main>
    </div>
  );
}
