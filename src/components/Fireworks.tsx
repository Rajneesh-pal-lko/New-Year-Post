"use client";

import { useEffect, useRef } from "react";

// A small hand-rolled fireworks canvas (no library). Gold, rose and marigold
// bursts with short trails. Tapping the sky launches a burst where you tap.
//
// Performance: one canvas, capped particle count, device-pixel-ratio capped at
// 2, and the loop stops whenever nothing is moving or the canvas is off-screen.
// With prefers-reduced-motion nothing animates.

const PALETTES = [
  ["#F3C969", "#FFE29A", "#FFF3D6"], // champagne gold
  ["#FF7AA8", "#FFB3CD", "#FFF3D6"], // sparkler rose
  ["#FF9F1C", "#FFC46B", "#FFE29A"], // marigold
  ["#F3C969", "#FF7AA8", "#FFF3D6"], // mixed
  ["#8FE9DC", "#FFF3D6", "#F3C969"], // a rare cool one
];

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  width: number;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  targetY: number;
  palette: string[];
}

interface FireworksProps {
  className?: string;
  /** Launch rockets on a gentle loop. */
  auto?: boolean;
  /** Seconds between automatic launches (randomised ±40%). */
  every?: number;
  /** Change this number to fire a short volley (e.g. when the pigeon lands). */
  volley?: number;
  /** Let people tap the canvas area to launch a burst. */
  interactive?: boolean;
}

export function Fireworks({ className = "", auto = true, every = 2.2, volley = 0, interactive = true }: FireworksProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ burst: (x: number, y: number) => void; launch: () => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let rockets: Rocket[] = [];
    let raf = 0;
    let running = false;
    let visible = true;
    let nextAuto = performance.now() + 600;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.max(1, Math.round(width * dpr));
      canvas!.height = Math.max(1, Math.round(height * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function burst(x: number, y: number, palette = PALETTES[Math.floor(Math.random() * PALETTES.length)]) {
      const count = width < 500 ? 46 : 64;
      const power = (width < 500 ? 2.6 : 3.4) * (0.85 + Math.random() * 0.3);
      for (let i = 0; i < count && particles.length < 600; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.15;
        const speed = power * (0.55 + Math.random() * 0.45);
        particles.push({
          x,
          y,
          px: x,
          py: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          decay: 0.011 + Math.random() * 0.011,
          color: palette[Math.floor(Math.random() * palette.length)],
          width: 1.4 + Math.random() * 1.2,
        });
      }
      start();
    }

    function launch() {
      if (rockets.length > 3) return;
      rockets.push({
        x: width * (0.15 + Math.random() * 0.7),
        y: height + 4,
        vy: -(height / 55) * (0.9 + Math.random() * 0.25),
        targetY: height * (0.14 + Math.random() * 0.3),
        palette: PALETTES[Math.floor(Math.random() * PALETTES.length)],
      });
      start();
    }

    function frame(now: number) {
      ctx!.clearRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";

      if (auto && visible && now > nextAuto) {
        launch();
        nextAuto = now + every * 1000 * (0.6 + Math.random() * 0.8);
      }

      rockets = rockets.filter((r) => {
        const prevY = r.y;
        r.y += r.vy;
        r.vy *= 0.985;
        ctx!.strokeStyle = "rgba(255, 233, 176, 0.85)";
        ctx!.lineWidth = 1.6;
        ctx!.beginPath();
        ctx!.moveTo(r.x, prevY + 10);
        ctx!.lineTo(r.x, r.y);
        ctx!.stroke();
        if (r.y <= r.targetY) {
          burst(r.x, r.y, r.palette);
          return false;
        }
        return true;
      });

      particles = particles.filter((p) => {
        p.px = p.x;
        p.py = p.y;
        p.vx *= 0.975;
        p.vy = p.vy * 0.975 + 0.035; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) return false;
        ctx!.globalAlpha = Math.max(0, p.life);
        ctx!.strokeStyle = p.color;
        ctx!.lineWidth = p.width;
        ctx!.beginPath();
        ctx!.moveTo(p.px - p.vx * 2.5, p.py - p.vy * 2.5);
        ctx!.lineTo(p.x, p.y);
        ctx!.stroke();
        return true;
      });
      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";

      const idle = particles.length === 0 && rockets.length === 0;
      if ((idle && !auto) || !visible) {
        running = false;
        if (idle) ctx!.clearRect(0, 0, width, height);
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || !visible) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && document.visibilityState === "visible";
      if (visible && auto) start();
    });
    io.observe(canvas);
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible && auto) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    api.current = { burst: (x, y) => burst(x, y), launch };
    if (auto) start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      api.current = null;
    };
  }, [auto, every]);

  // A short volley whenever `volley` changes (skipped on first render).
  const firstVolley = useRef(true);
  useEffect(() => {
    if (firstVolley.current) {
      firstVolley.current = false;
      if (!volley) return;
    }
    const c = canvasRef.current;
    if (!c || !api.current) return;
    const { width, height } = c.getBoundingClientRect();
    const timers = [0, 260, 620].map((delay, i) =>
      setTimeout(() => api.current?.burst(width * [0.3, 0.7, 0.5][i], height * [0.28, 0.22, 0.16][i]), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [volley]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!interactive || !api.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    api.current.burst(e.clientX - rect.left, e.clientY - rect.top);
  }

  return (
    <canvas
      ref={canvasRef}
      className={`fireworks ${className}`}
      onPointerDown={interactive ? onPointerDown : undefined}
      aria-hidden
    />
  );
}
