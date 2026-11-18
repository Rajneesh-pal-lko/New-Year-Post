import "server-only";
import { IST_OFFSET_MINUTES } from "@shared/slots";
import { appEnv } from "./env";

// The campaign calendar and the trusted clock.
//
// Every "now" in business logic comes from now() below: the server's clock,
// never the browser's. Dates are written in IST and converted to UTC instants.

export const CAMPAIGN = {
  /** First moment of sales (IST). */
  salesOpenIst: "2026-12-01T00:00",
  /** First moment AFTER sales (IST). Sales run until 31 Dec 23:59:59 IST. */
  salesCloseIst: "2027-01-01T00:00",
  /** Delivery day (IST calendar date). */
  deliveryDate: "2027-01-01",
} as const;

/** '2026-12-08T00:00' (IST wall time) -> UTC Date */
export function istToUtc(istLocal: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(istLocal);
  if (!m) throw new Error(`Bad IST datetime: ${istLocal}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * 60_000);
}

/**
 * Trusted current time. Outside production, CLOCK_OVERRIDE_IST pins the clock
 * so price tiers and the sales window can be tested before December.
 */
export function now(): Date {
  const override = process.env.CLOCK_OVERRIDE_IST;
  if (override && appEnv() !== "production") return istToUtc(override);
  return new Date();
}

/** Delivery date; DELIVERY_DATE_OVERRIDE allows staging rehearsals. */
export function deliveryDate(): string {
  const override = process.env.DELIVERY_DATE_OVERRIDE;
  if (override && appEnv() !== "production" && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return CAMPAIGN.deliveryDate;
}

export type SalesState = "BEFORE" | "OPEN" | "CLOSED";

export function salesOpensAt(): Date {
  return istToUtc(CAMPAIGN.salesOpenIst);
}

export function salesClosesAt(): Date {
  return istToUtc(CAMPAIGN.salesCloseIst);
}

export function salesState(at: Date = now()): SalesState {
  if (at < salesOpensAt()) return "BEFORE";
  if (at >= salesClosesAt()) return "CLOSED";
  return "OPEN";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC Date -> '8 Dec 2026, 12:00 AM IST' */
export function formatIst(at: Date): string {
  const d = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h12}:${mm} ${h < 12 ? "AM" : "PM"} IST`;
}

/** UTC Date -> '8 Dec' (IST calendar) */
export function formatIstDay(at: Date): string {
  const d = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
