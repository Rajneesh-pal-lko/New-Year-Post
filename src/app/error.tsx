"use client";

import Link from "next/link";

// Shown when a page fails (for example the database is briefly unreachable).
// Deliberately different from "not found": the link is fine, try again.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <h1>A gust of wind</h1>
      <p className="lede">Something went wrong on our side. Your link is fine; please try again in a moment.</p>
      <p style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        <button type="button" className="button button--gold" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="button button--ghost">
          Go to the home page
        </Link>
      </p>
    </main>
  );
}
