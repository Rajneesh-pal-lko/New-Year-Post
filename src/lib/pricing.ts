import "server-only";
import { perPigeonPaise } from "@shared/money";
import { istToUtc, salesClosesAt, salesState, type SalesState } from "./campaign";
import { PACKAGE_SIZES, RECOMMENDED_PACKAGE, type PackageSize } from "./packages";

// THE central pricing configuration. Server-side only.
//
// Prices are experimental business assumptions, not market-validated.
// Amounts are integer paise and are shown inclusive of applicable taxes.
// To change prices: edit this table and deploy. Orders already created keep
// their own price snapshot, so a change never affects an open checkout.

export interface PriceTier {
  id: string;
  /** Human label for the window, IST. */
  label: string;
  /** Tier starts at this IST wall time and runs until the next tier starts. */
  startsAtIst: string;
  prices: Record<PackageSize, number>;
}

export const PRICE_TIERS: readonly PriceTier[] = [
  { id: "T1", label: "1–7 December", startsAtIst: "2026-12-01T00:00", prices: { 1: 4900, 3: 12900, 5: 19900, 10: 34900, 20: 59900 } },
  { id: "T2", label: "8–14 December", startsAtIst: "2026-12-08T00:00", prices: { 1: 5900, 3: 14900, 5: 22900, 10: 39900, 20: 67900 } },
  { id: "T3", label: "15–21 December", startsAtIst: "2026-12-15T00:00", prices: { 1: 6500, 3: 15900, 5: 24900, 10: 42900, 20: 72900 } },
  { id: "T4", label: "22–28 December", startsAtIst: "2026-12-22T00:00", prices: { 1: 6900, 3: 17900, 5: 26900, 10: 46900, 20: 79900 } },
  { id: "T5", label: "29–31 December", startsAtIst: "2026-12-29T00:00", prices: { 1: 7900, 3: 19900, 5: 29900, 10: 51900, 20: 89900 } },
];

export function tierStartsAt(tier: PriceTier): Date {
  return istToUtc(tier.startsAtIst);
}

/** Tier in force at `at`. Before sales open this is the first tier (shown as launch prices). */
export function tierAt(at: Date): PriceTier {
  let current = PRICE_TIERS[0];
  for (const tier of PRICE_TIERS) {
    if (at >= tierStartsAt(tier)) current = tier;
  }
  return current;
}

export function nextTier(tier: PriceTier): PriceTier | null {
  const i = PRICE_TIERS.findIndex((t) => t.id === tier.id);
  return PRICE_TIERS[i + 1] ?? null;
}

export interface Quote {
  tierId: string;
  tierLabel: string;
  packageSize: PackageSize;
  amountPaise: number;
  currency: "INR";
  /** Display only. Never charged. */
  approxPerPigeonPaise: number;
  quotedAt: string;
}

export function quote(packageSize: PackageSize, at: Date): Quote {
  const tier = tierAt(at);
  const amountPaise = tier.prices[packageSize];
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(`No valid price for package ${packageSize} in tier ${tier.id}`);
  }
  return {
    tierId: tier.id,
    tierLabel: tier.label,
    packageSize,
    amountPaise,
    currency: "INR",
    approxPerPigeonPaise: perPigeonPaise(amountPaise, packageSize),
    quotedAt: at.toISOString(),
  };
}

export interface PackageView {
  size: PackageSize;
  amountPaise: number;
  approxPerPigeonPaise: number;
  recommended: boolean;
}

export interface PricingView {
  state: SalesState;
  tier: { id: string; label: string };
  packages: PackageView[];
  /** The next scheduled increase, or null in the last tier. */
  nextChange: { atIso: string; label: string; packages: PackageView[] } | null;
  salesCloseIso: string;
}

function packagesFor(tier: PriceTier): PackageView[] {
  return PACKAGE_SIZES.map((size) => ({
    size,
    amountPaise: tier.prices[size],
    approxPerPigeonPaise: perPigeonPaise(tier.prices[size], size),
    recommended: size === RECOMMENDED_PACKAGE,
  }));
}

/** Everything the UI needs to show prices honestly. Plain JSON, safe to pass to client components. */
export function pricingView(at: Date): PricingView {
  const tier = tierAt(at);
  const next = nextTier(tier);
  return {
    state: salesState(at),
    tier: { id: tier.id, label: tier.label },
    packages: packagesFor(tier),
    nextChange: next ? { atIso: tierStartsAt(next).toISOString(), label: next.label, packages: packagesFor(next) } : null,
    salesCloseIso: salesClosesAt().toISOString(),
  };
}
