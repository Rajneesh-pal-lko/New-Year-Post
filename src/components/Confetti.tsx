"use client";

import { useEffect, useRef } from "react";

// One celebratory shower of paper confetti over the whole screen, then gone.
// Used when a payment is confirmed and when a letter is opened.
// `onceKey` stops it repeating on refresh (sessionStorage). Respects reduced motion.

const COLORS = ["#F3C969", "#FFE29A", "#FF7AA8", "#FF9F1C", "#FFF7E8", "#8FE9DC"];

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  sway: number;
  phase: number;
  color: string;
}

export function Confetti({ fire = true, onceKey }: { fire?: boolean; onceKey?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (onceKey) {
      try {
        if (sessionStorage.getItem(`pp:confetti:${onceKey}`)) return;
        sessionStorage.setItem(`pp:confetti:${onceKey}`, "1");
      } catch {}
    }
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = width < 500 ? 110 : 170;
    const pieces: Piece[] = Array.from({ length: count }, () => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height * 0.35 + (Math.random() - 0.5) * 60,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 13,
      vy: -6 - Math.random() * 9,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      sway: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    const started = performance.now();
    let raf = 0;
    function frame(now: number) {
      const t = (now - started) / 1000;
      ctx!.clearRect(0, 0, width, height);
      let alive = 0;
      for (const p of pieces) {
        p.vx *= 0.985;
        p.vy = Math.min(p.vy + 0.32, 4.2);
        p.x += p.vx + Math.sin(t * 3 + p.phase) * p.sway;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y < height + 20) alive++;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        ctx!.scale(1, Math.cos(t * 6 + p.phase)); // the flip of real paper
        ctx!.fillStyle = p.color;
        ctx!.globalAlpha = t > 3.2 ? Math.max(0, 1 - (t - 3.2) / 0.8) : 1;
        ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx!.restore();
      }
      if (alive > 0 && t < 4) raf = requestAnimationFrame(frame);
      else ctx!.clearRect(0, 0, width, height);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fire, onceKey]);

  return <canvas ref={ref} className="confetti" aria-hidden />;
}
