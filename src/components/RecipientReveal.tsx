"use client";

import Link from "next/link";
import { useState } from "react";
import { RevealStage } from "./RevealStage";

interface Props {
  token: string;
  recipientName: string;
  senderName: string;
  message: string;
  canRelease: boolean;
  alreadyReleased: boolean;
}

export function RecipientReveal({ token, recipientName, senderName, message, canRelease, alreadyReleased }: Props) {
  const [released, setReleased] = useState(alreadyReleased);
  const [showNames, setShowNames] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function markOpened() {
    fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "opened" }),
      keepalive: true,
    }).catch(() => {});
  }

  async function release() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "release", showNames }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't release the pigeon.");
      setReleased(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't release the pigeon.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RevealStage recipientName={recipientName} senderName={senderName} message={message} onOpened={markOpened}>
      <section className="card" style={{ marginTop: "1.5rem" }} aria-labelledby="release">
        {released ? (
          <>
            <h2 id="release" style={{ fontSize: "1.3rem" }}>
              Your pigeon is on its way to the Universe
            </h2>
            <p>It will appear in the Pigeon Universe once we&rsquo;ve reviewed it. Thank you for sharing it.</p>
            <p>
              <Link href="/universe">Explore the Pigeon Universe</Link>
            </p>
          </>
        ) : canRelease ? (
          <>
            <h2 id="release" style={{ fontSize: "1.3rem" }}>
              Release this pigeon into the Pigeon Universe?
            </h2>
            <p>
              The Universe is a public sky of real New Year letters. If you release this one, anyone can read the letter there
              after we review it. Your email address is never shown.
            </p>
            <label className="check">
              <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              <span>Show first names with it (from {senderName.split(/\s+/)[0]} to {recipientName.split(/\s+/)[0]})</span>
            </label>
            {error && <p className="field__error">{error}</p>}
            <p className="flow__actions" style={{ marginTop: 0 }}>
              <button type="button" className="button button--primary" onClick={release} disabled={busy}>
                {busy ? "Releasing…" : "Release my pigeon"}
              </button>
              <span className="field__hint">Or keep it just for you. Nothing is shared unless you choose to.</span>
            </p>
          </>
        ) : (
          <>
            <h2 id="release" style={{ fontSize: "1.3rem" }}>
              This letter is just for you
            </h2>
            <p>
              {senderName} chose to keep it private. You can still <Link href="/universe">explore the Pigeon Universe</Link>.
            </p>
          </>
        )}
        <p className="field__hint">
          Is this letter unwelcome or abusive? Reply to the email it came in, or <Link href="/contact">contact us</Link>.
        </p>
      </section>
    </RevealStage>
  );
}
