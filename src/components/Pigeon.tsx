// The carrier pigeon. One hand-drawn SVG reused everywhere so the illustration
// style stays consistent: slate body, iridescent neck, marigold eye, two dark
// wing bars, and (optionally) an airmail envelope in its beak.
//
// Faces left. Poses: "fly" (wings raised, flapping via CSS) or "perch".

import type { CSSProperties } from "react";

interface PigeonProps {
  pose?: "fly" | "perch";
  envelope?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Pigeon({ pose = "fly", envelope = true, className = "", style, title }: PigeonProps) {
  const flying = pose === "fly";
  return (
    <svg
      viewBox="0 0 240 180"
      className={`pigeon ${flying ? "pigeon--fly" : "pigeon--perch"} ${className}`}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id="pg-neck" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3F9A8F" />
          <stop offset="0.55" stopColor="#5B6FA8" />
          <stop offset="1" stopColor="#7A5A93" />
        </linearGradient>
        <linearGradient id="pg-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A7B0C2" />
          <stop offset="1" stopColor="#8994AA" />
        </linearGradient>
      </defs>

      {flying && (
        // Far wing, behind the body.
        <g className="pigeon__wing pigeon__wing--far">
          <path d="M112 78 C 118 50 140 26 178 14 C 174 38 160 62 138 84 Z" fill="#6F7A92" />
        </g>
      )}

      {/* Tail with dark terminal band */}
      <path d="M166 90 L 214 82 C 221 89 222 101 217 108 L 164 110 Z" fill="#8D97AC" />
      <path d="M206 83.4 L 214 82 C 221 89 222 101 217 108 L 208 108.4 C 211 100 211 91 206 83.4 Z" fill="#3A4256" />

      {/* Body */}
      <path d="M74 88 C 74 70 98 62 124 66 C 150 70 168 84 178 98 C 168 114 142 125 114 125 C 90 125 74 110 74 88 Z" fill="url(#pg-body)" />
      {/* Paler belly */}
      <path d="M80 100 C 88 116 104 123 122 123 C 108 117 96 108 90 96 Z" fill="#C3CAD7" />

      {!flying && (
        <g className="pigeon__legs" stroke="#D2607A" strokeWidth="3.2" strokeLinecap="round" fill="none">
          <path d="M108 122 L 105 140 M105 140 L 97 143 M105 140 L 104 145" />
          <path d="M122 121 L 124 140 M124 140 L 116 143 M124 140 L 124 145" />
        </g>
      )}

      {/* Neck sheen */}
      <path d="M56 68 C 58 88 74 101 96 101 C 90 92 86 80 88 69 C 76 62 64 62 56 68 Z" fill="url(#pg-neck)" />

      {/* Near wing */}
      {flying ? (
        <g className="pigeon__wing pigeon__wing--near">
          <path d="M98 80 C 100 46 124 18 168 4 C 166 30 152 60 128 88 Z" fill="#9AA4B8" />
          <path d="M108 66 C 118 52 132 42 150 34" stroke="#2F3648" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M112 78 C 122 66 136 56 154 50" stroke="#2F3648" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M150 12 C 158 10 164 7 168 4 C 167 14 163 24 158 32 Z" fill="#4A536A" />
        </g>
      ) : (
        <g className="pigeon__wing pigeon__wing--folded">
          <path d="M96 78 C 120 68 152 74 176 96 C 154 104 122 106 100 98 Z" fill="#9AA4B8" />
          <path d="M126 83 C 136 83 146 87 154 92" stroke="#2F3648" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M130 92 C 140 92 150 95 160 99" stroke="#2F3648" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        </g>
      )}

      {envelope && (
        <g className="pigeon__envelope" transform="rotate(-14 36 62)">
          <rect x="6" y="60" width="32" height="21" rx="1.5" fill="#FBFCFE" stroke="#1E2B4F" strokeWidth="1.3" />
          <path d="M6.6 60.6 L 22 72 L 37.4 60.6" stroke="#1E2B4F" strokeWidth="1.2" fill="none" />
          <g strokeWidth="2.2">
            <path d="M8 79.5 l3 -3 M14 79.5 l3 -3 M20 79.5 l3 -3 M26 79.5 l3 -3 M32 79.5 l3 -3" stroke="#C42B2B" />
            <path d="M11 79.5 l3 -3 M17 79.5 l3 -3 M23 79.5 l3 -3 M29 79.5 l3 -3" stroke="#2F5DA8" />
          </g>
          <circle cx="22" cy="71.5" r="2.6" fill="#C42B2B" />
        </g>
      )}

      {/* Head */}
      <circle cx="62" cy="62" r="17" fill="#7C869C" />
      {/* Beak + cere */}
      <path d="M47 59 L 33 65 L 47 68 Z" fill="#3A3F4D" />
      <ellipse cx="48.5" cy="60" rx="3.6" ry="2.6" fill="#E9E6DE" />
      {/* Eye: pigeons really do have orange eyes */}
      <circle cx="58" cy="57" r="4.4" fill="#F2A93B" />
      <circle cx="57.6" cy="57.2" r="2.1" fill="#1E2B4F" />
      <circle cx="56.8" cy="56.3" r="0.8" fill="#FFFFFF" />

    </svg>
  );
}
