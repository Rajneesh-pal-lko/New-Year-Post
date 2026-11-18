"use client";

import { useEffect, useState } from "react";

// A real countdown to midnight, 1 January 2027 IST. It starts from the
// server's clock (passed in) and advances with the browser's monotonic timer,
// so a wrong phone clock can't change it. This counts down to the New Year
// itself, not to a sale ending: no urgency is implied.

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}

export function Countdown({ serverNowMs, targetMs, label }: { serverNowMs: number; targetMs: number; label: string }) {
  const [now, setNow] = useState(serverNowMs);

  useEffect(() => {
    const startPerf = performance.now();
    const id = setInterval(() => setNow(serverNowMs + (performance.now() - startPerf)), 1000);
    return () => clearInterval(id);
  }, [serverNowMs]);

  const left = targetMs - now;
  if (left <= 0) {
    return <p className="countdown countdown--done">Happy New Year! The pigeons are flying.</p>;
  }
  const p = parts(left);
  const units: [number, string][] = [
    [p.days, p.days === 1 ? "day" : "days"],
    [p.hours, "hrs"],
    [p.minutes, "min"],
    [p.seconds, "sec"],
  ];

  return (
    <div className="countdown" role="timer" aria-label={`${p.days} days, ${p.hours} hours and ${p.minutes} minutes until ${label}`}>
      <div className="countdown__units" aria-hidden>
        {units.map(([n, unit]) => (
          <span className="countdown__unit" key={unit}>
            <b>{String(n).padStart(2, "0")}</b>
            <small>{unit}</small>
          </span>
        ))}
      </div>
      <p className="countdown__label">until {label}</p>
    </div>
  );
}
