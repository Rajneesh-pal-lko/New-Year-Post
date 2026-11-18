"use client";

import Link from "next/link";
import { useState } from "react";
import { Fireworks } from "./Fireworks";
import { Pigeon } from "./Pigeon";

interface Caught {
  id: string;
  message: string;
  from_name: string | null;
  to_name: string | null;
}

// Flight lanes for the visible pigeons: vertical position, speed, start offset.
const LANES = [
  { top: 8, dur: 22, delay: -3, scale: 1 },
  { top: 30, dur: 27, delay: -14, scale: 0.8 },
  { top: 52, dur: 19, delay: -8, scale: 1.1 },
  { top: 18, dur: 31, delay: -22, scale: 0.7 },
  { top: 66, dur: 24, delay: -17, scale: 0.9 },
  { top: 42, dur: 29, delay: -5, scale: 0.75 },
];

export function UniverseSky({ approvedCount }: { approvedCount: number }) {
  const [caught, setCaught] = useState<Caught | null>(null);
  const [state, setState] = useState<"idle" | "catching" | "error" | "reported">("idle");

  async function catchOne() {
    setState("catching");
    try {
      const res = await fetch(`/api/universe${caught ? `?exclude=${caught.id}` : ""}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error();
      setCaught(body.pigeon);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  async function report() {
    if (!caught) return;
    await fetch("/api/universe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: caught.id }),
    }).catch(() => {});
    setCaught(null);
    setState("reported");
  }

  const birds = LANES.slice(0, Math.min(LANES.length, Math.max(approvedCount, 0)));

  return (
    <>
      <div className="universe__sky">
        <span className="stars" aria-hidden />
        <Fireworks className="reveal__fireworks" every={3.4} />
        {approvedCount === 0 ? (
          <div className="universe__empty">
            <div>
              <p className="universe__empty-title">The sky is still empty.</p>
              <p style={{ maxWidth: "26rem" }}>
                Pigeons appear here after they land on 1 January 2027, if their recipients choose to release them.
              </p>
              <p>
                <Link href="/send" className="button button--gold">
                  Send Your First Pigeon
                </Link>
              </p>
            </div>
          </div>
        ) : (
          birds.map((lane, i) => (
            <button
              type="button"
              key={i}
              className="universe__bird"
              aria-label="Catch a pigeon and read its letter"
              onClick={catchOne}
              style={
                {
                  top: `${lane.top}%`,
                  left: `${(i * 17) % 80}%`,
                  "--dur": `${lane.dur}s`,
                  "--delay": `${lane.delay}s`,
                  width: `${6.5 * lane.scale}rem`,
                } as React.CSSProperties
              }
            >
              <Pigeon pose="fly" envelope />
            </button>
          ))
        )}
      </div>

      <div className="universe__caught" aria-live="polite">
        {state === "catching" && <p>Catching a pigeon…</p>}
        {state === "error" && <p>That pigeon got away. Try another.</p>}
        {state === "reported" && <p>Thanks. That letter is hidden until we review it again.</p>}
        {caught && (
          <>
            <article className="letter">
              {caught.to_name && <p className="letter__to">For {caught.to_name}</p>}
              <div className="letter__body">{caught.message}</div>
              {caught.from_name && <p className="letter__from">From {caught.from_name}</p>}
            </article>
            <p className="universe__report">
              <button type="button" className="link-button" onClick={catchOne}>
                Catch another
              </button>
              {"  "}or{"  "}
              <button type="button" className="link-button" onClick={report}>
                report this letter
              </button>
            </p>
          </>
        )}
        {approvedCount > 0 && !caught && state === "idle" && (
          <p style={{ textAlign: "center" }}>
            {approvedCount} {approvedCount === 1 ? "letter has" : "letters have"} been released so far.
          </p>
        )}
      </div>
    </>
  );
}
