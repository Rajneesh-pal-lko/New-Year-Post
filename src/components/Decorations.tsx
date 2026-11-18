// Festive decoration drawn in code: a string of paper bunting (jhandi), the
// triangle flags strung across Indian streets and rooftops for every festival.
// Static on purpose; the hero's one moving moment is the pigeon landing.

const FLAG_COLORS = ["#FFB627", "#FFFFFF", "#A9DBFF", "#19B36B", "#FF6B2C"];

/** y offset (0..1) of a hanging swag at position t (0..1) within one swag */
const sag = (t: number) => Math.sin(Math.PI * t);

export function Bunting({ swags = 2, flagsPerSwag = 11, depth = 14 }: { swags?: number; flagsPerSwag?: number; depth?: number }) {
  const total = swags * flagsPerSwag;
  const flags = Array.from({ length: total }, (_, i) => {
    const swag = Math.floor(i / flagsPerSwag);
    const t = ((i % flagsPerSwag) + 0.5) / flagsPerSwag;
    return { x: ((swag + t) / swags) * 100, y: sag(t) * depth, color: FLAG_COLORS[i % FLAG_COLORS.length] };
  });

  // The string, drawn as a path in a 0..100 x 0..depth box.
  const steps = swags * 20;
  const d = Array.from({ length: steps + 1 }, (_, i) => {
    const pos = i / steps;
    const local = (pos * swags) % 1;
    return `${i === 0 ? "M" : "L"}${(pos * 100).toFixed(2)} ${(sag(local) * depth).toFixed(2)}`;
  }).join(" ");

  return (
    <div className="bunting" style={{ height: `${depth + 26}px` }} aria-hidden>
      <svg className="bunting__string" viewBox={`0 -2 100 ${depth + 4}`} preserveAspectRatio="none">
        <path d={d} vectorEffect="non-scaling-stroke" />
      </svg>
      {flags.map((f, i) => (
        <span
          key={i}
          className="bunting__flag"
          style={{ left: `${f.x}%`, top: `${f.y + 2}px`, background: f.color, width: `calc(${100 / total}% - 3px)` }}
        />
      ))}
    </div>
  );
}
