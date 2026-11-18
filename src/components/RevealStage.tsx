"use client";

import { useEffect, useRef, useState } from "react";
import { Confetti } from "./Confetti";
import { Fireworks } from "./Fireworks";
import { Pigeon } from "./Pigeon";

// The recipient's moment: a pigeon flies in, lands on the parapet, drops an
// envelope, and the recipient taps it open to read the letter.
//
// Timers here are only for animation. Nothing about delivery depends on the
// browser: by the time this renders, the server has already decided the
// message may be shown.

type Stage = "idle" | "arriving" | "landed" | "opening" | "letter";

const FLY_MS = 2600;
const DROP_MS = 700;
const OPEN_MS = 650;

interface RevealStageProps {
  recipientName: string;
  senderName: string;
  message: string;
  /** Demo mode waits for a tap before the pigeon arrives, and can replay. */
  demo?: boolean;
  onOpened?: () => void;
  children?: React.ReactNode; // shown under the letter once it is open
}

export function RevealStage({ recipientName, senderName, message, demo = false, onOpened, children }: RevealStageProps) {
  const [stage, setStage] = useState<Stage>(demo ? "idle" : "arriving");
  const [dropped, setDropped] = useState(false);
  const [volley, setVolley] = useState(0);
  const [opens, setOpens] = useState(0);
  const reduced = useRef(false);
  const letterRef = useRef<HTMLElement>(null);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!demo && reduced.current) {
      setStage("landed");
      setDropped(true);
    }
  }, [demo]);

  useEffect(() => {
    if (stage === "arriving") {
      const t = setTimeout(() => setStage("landed"), reduced.current ? 0 : FLY_MS);
      return () => clearTimeout(t);
    }
    if (stage === "landed" && !dropped) {
      setVolley((v) => v + 1); // a little celebration as the pigeon touches down
      const t = setTimeout(() => setDropped(true), reduced.current ? 0 : DROP_MS);
      return () => clearTimeout(t);
    }
    if (stage === "opening") {
      const t = setTimeout(() => setStage("letter"), reduced.current ? 0 : OPEN_MS);
      return () => clearTimeout(t);
    }
    if (stage === "letter") {
      letterRef.current?.focus({ preventScroll: true });
      letterRef.current?.scrollIntoView({ behavior: reduced.current ? "auto" : "smooth", block: "nearest" });
    }
  }, [stage, dropped]);

  function start() {
    setDropped(false);
    setStage("arriving");
  }

  function open() {
    if (stage !== "landed" || !dropped) return;
    setStage("opening");
    setOpens((n) => n + 1);
    onOpened?.();
  }

  const landed = stage === "landed" || stage === "opening" || stage === "letter";
  const envelopeOpen = stage === "opening" || stage === "letter";

  return (
    <div className={`reveal reveal--${stage}`}>
      <div className="reveal__sky">
        <span className="clouds" aria-hidden />
        <Fireworks className="reveal__fireworks" auto={false} volley={volley} />

        {stage === "idle" && (
          <div className="reveal__start">
            <button type="button" className="button button--gold" onClick={start}>
              Watch a pigeon land
            </button>
          </div>
        )}

        <div className="reveal__landing">
          {stage === "arriving" && <Pigeon pose="fly" envelope className="reveal__flyer" />}
          {landed && <Pigeon pose="perch" envelope={false} className="reveal__percher" />}
          {landed && (
            <button
              type="button"
              className={`envelope${dropped ? " envelope--dropped" : ""}${envelopeOpen ? " envelope--open" : ""}`}
              onClick={open}
              disabled={!dropped || envelopeOpen}
              aria-label={envelopeOpen ? `Letter from ${senderName}, opened` : `Open the envelope from ${senderName}`}
            >
              <span className="envelope__back" />
              <span className="envelope__paper" />
              <span className="envelope__front" />
              <span className="envelope__flap" />
              <span className="envelope__seal" />
            </button>
          )}
        </div>
        <div className="reveal__parapet" aria-hidden />
      </div>

      <p className="reveal__hint" aria-live="polite">
        {stage === "arriving" && "A pigeon is flying in…"}
        {stage === "landed" && dropped && "Tap the envelope to open it."}
      </p>

      {opens > 0 && <Confetti key={opens} />}

      {stage === "letter" && (
        <article className="letter" ref={letterRef} tabIndex={-1} aria-label={`Letter from ${senderName}`}>
          <p className="letter__to">For {recipientName}</p>
          <div className="letter__body">{message}</div>
          <p className="letter__from">From {senderName}</p>
        </article>
      )}

      {stage === "letter" && children}

      {demo && stage === "letter" && (
        <p className="reveal__replay">
          <button type="button" className="link-button" onClick={start}>
            Watch it again
          </button>
        </p>
      )}
    </div>
  );
}
