import { afterEach, describe, expect, it, vi } from "vitest";
import { istToUtc, salesState } from "@/lib/campaign";
import { PACKAGE_SIZES } from "@/lib/packages";
import { PRICE_TIERS, pricingView, quote, tierAt } from "@/lib/pricing";

describe("price tiers", () => {
  it("every price is a positive integer number of paise", () => {
    for (const tier of PRICE_TIERS) {
      for (const size of PACKAGE_SIZES) {
        const p = tier.prices[size];
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThan(0);
      }
    }
  });

  it("matches the brief's prices", () => {
    expect(PRICE_TIERS.map((t) => t.prices[1])).toEqual([4900, 5900, 6500, 6900, 7900]);
    expect(PRICE_TIERS.map((t) => t.prices[5])).toEqual([19900, 22900, 24900, 26900, 29900]);
    expect(PRICE_TIERS.map((t) => t.prices[20])).toEqual([59900, 67900, 72900, 79900, 89900]);
  });

  it("switches tier exactly at IST midnight", () => {
    // 7 Dec 23:59 IST is still tier 1; 8 Dec 00:00 IST is tier 2.
    expect(tierAt(istToUtc("2026-12-07T23:59")).id).toBe("T1");
    expect(tierAt(istToUtc("2026-12-08T00:00")).id).toBe("T2");
    // 8 Dec 00:00 IST is 7 Dec 18:30 UTC.
    expect(istToUtc("2026-12-08T00:00").toISOString()).toBe("2026-12-07T18:30:00.000Z");
    expect(tierAt(new Date("2026-12-07T18:29:59Z")).id).toBe("T1");
    expect(tierAt(new Date("2026-12-07T18:30:00Z")).id).toBe("T2");
    expect(tierAt(istToUtc("2026-12-31T23:59")).id).toBe("T5");
  });

  it("quotes server-side amounts and a display-only per-pigeon figure", () => {
    const q = quote(5, istToUtc("2026-12-01T10:00"));
    expect(q).toMatchObject({ tierId: "T1", amountPaise: 19900, currency: "INR", approxPerPigeonPaise: 3980 });
    expect(quote(3, istToUtc("2026-12-09T10:00")).approxPerPigeonPaise).toBe(4967); // 149/3 ≈ 49.67
  });

  it("shows the next increase honestly, and none in the last window", () => {
    const v = pricingView(istToUtc("2026-12-03T12:00"));
    expect(v.nextChange?.label).toBe("8–14 December");
    expect(v.nextChange?.atIso).toBe("2026-12-07T18:30:00.000Z");
    expect(v.packages.find((p) => p.size === 5)?.recommended).toBe(true);
    expect(pricingView(istToUtc("2026-12-30T12:00")).nextChange).toBeNull();
  });
});

describe("sales window", () => {
  it("opens 1 Dec 00:00 IST and closes after 31 Dec 23:59:59 IST", () => {
    expect(salesState(new Date("2026-11-30T18:29:59Z"))).toBe("BEFORE");
    expect(salesState(new Date("2026-11-30T18:30:00Z"))).toBe("OPEN");
    expect(salesState(new Date("2026-12-31T18:29:59Z"))).toBe("OPEN");
    expect(salesState(new Date("2026-12-31T18:30:00Z"))).toBe("CLOSED");
  });
});

describe("clock override", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is ignored in production", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("CLOCK_OVERRIDE_IST", "2026-12-10T10:00");
    const { now } = await import("@/lib/campaign");
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("is ignored when APP_ENV is missing", async () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("CLOCK_OVERRIDE_IST", "2026-12-10T10:00");
    const { now } = await import("@/lib/campaign");
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("works in staging", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("CLOCK_OVERRIDE_IST", "2026-12-10T10:00");
    const { now } = await import("@/lib/campaign");
    expect(now().toISOString()).toBe("2026-12-10T04:30:00.000Z");
  });
});
