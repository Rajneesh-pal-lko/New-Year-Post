// Money is always integer paise. These helpers only format for display.
// No imports on purpose (runs in Node and Deno).

/** 19900 -> '199', 3980 -> '39.80' */
export function formatRupeesPlain(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error(`paise must be an integer, got ${paise}`);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = rupees.toLocaleString("en-IN");
  return rest === 0 ? `${sign}${grouped}` : `${sign}${grouped}.${String(rest).padStart(2, "0")}`;
}

/** 19900 -> '₹199' */
export function formatRupees(paise: number): string {
  return `₹${formatRupeesPlain(paise)}`;
}

/** Display-only per-pigeon price, rounded to the nearest paisa. Never charged. */
export function perPigeonPaise(totalPaise: number, count: number): number {
  return Math.round(totalPaise / count);
}
