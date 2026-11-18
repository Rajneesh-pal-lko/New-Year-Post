// Indian New Year's Eve decorations, drawn in code: a string of fairy lights
// and a marigold garland, each hung in gentle swags.

const BULB_COLORS = ["#F3C969", "#FF7AA8", "#FF9F1C", "#FFF3D6"];

/** y offset (0..1) of a hanging swag at position t (0..1) within one swag */
const sag = (t: number) => Math.sin(Math.PI * t);

export function FairyLights({ swags = 3, bulbsPerSwag = 9, depth = 26 }: { swags?: number; bulbsPerSwag?: number; depth?: number }) {
  const bulbs: { x: number; y: number; color: string; delay: number }[] = [];
  const total = swags * bulbsPerSwag;
  for (let i = 0; i < total; i++) {
    const swag = Math.floor(i / bulbsPerSwag);
    const t = ((i % bulbsPerSwag) + 0.5) / bulbsPerSwag;
    bulbs.push({
      x: ((swag + t) / swags) * 100,
      y: sag(t) * depth,
      color: BULB_COLORS[i % BULB_COLORS.length],
      delay: (i * 0.37) % 2.4,
    });
  }
  // The wire, drawn as a path in a 0..100 x 0..depth box.
  const steps = swags * 20;
  const d = Array.from({ length: steps + 1 }, (_, i) => {
    const pos = i / steps;
    const local = (pos * swags) % 1;
    return `${i === 0 ? "M" : "L"}${(pos * 100).toFixed(2)} ${(sag(local) * depth).toFixed(2)}`;
  }).join(" ");

  return (
    <div className="lights" style={{ height: `${depth + 18}px` }} aria-hidden>
      <svg className="lights__wire" viewBox={`0 -2 100 ${depth + 4}`} preserveAspectRatio="none">
        <path d={d} vectorEffect="non-scaling-stroke" />
      </svg>
      {bulbs.map((b, i) => (
        <span
          key={i}
          className="lights__bulb"
          style={{ left: `${b.x}%`, top: `${b.y + 3}px`, color: b.color, animationDelay: `${b.delay}s` }}
        />
      ))}
    </div>
  );
}

export function MarigoldGarland({ swags = 4, flowersPerSwag = 11, depth = 22 }: { swags?: number; flowersPerSwag?: number; depth?: number }) {
  const flowers: { x: number; y: number; tone: number; size: number }[] = [];
  for (let i = 0; i < swags * flowersPerSwag; i++) {
    const swag = Math.floor(i / flowersPerSwag);
    const t = ((i % flowersPerSwag) + 0.5) / flowersPerSwag;
    flowers.push({ x: ((swag + t) / swags) * 100, y: sag(t) * depth, tone: i % 3, size: i % 4 === 0 ? 1.15 : 1 });
  }
  return (
    <div className="garland" style={{ height: `${depth + 26}px` }} aria-hidden>
      {flowers.map((f, i) => (
        <span
          key={i}
          className={`garland__flower garland__flower--${f.tone}`}
          style={{ left: `${f.x}%`, top: `${f.y}px`, transform: `translateX(-50%) scale(${f.size})` }}
        />
      ))}
    </div>
  );
}
