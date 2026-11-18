import { describe, expect, it } from "vitest";
import { formatRupees, formatRupeesPlain, perPigeonPaise } from "@shared/money";
import { SLOTS, formatIstDate, isValidSlot, slotLabel, slotToUtc } from "@shared/slots";

describe("delivery slots", () => {
  it("has 48 half-hour slots from 00:00 to 23:30", () => {
    expect(SLOTS).toHaveLength(48);
    expect(SLOTS[0]).toBe("00:00");
    expect(SLOTS[1]).toBe("00:30");
    expect(SLOTS[47]).toBe("23:30");
  });

  it("rejects anything that is not on the half hour", () => {
    expect(isValidSlot("00:15")).toBe(false);
    expect(isValidSlot("24:00")).toBe(false);
    expect(isValidSlot("9:30")).toBe(false);
    expect(isValidSlot("09:30")).toBe(true);
  });

  it("converts IST slots on 1 Jan 2027 to UTC", () => {
    expect(slotToUtc("2027-01-01", "00:00").toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(slotToUtc("2027-01-01", "05:30").toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(slotToUtc("2027-01-01", "23:30").toISOString()).toBe("2027-01-01T18:00:00.000Z");
  });

  it("labels slots for people", () => {
    expect(slotLabel("00:00")).toBe("12:00 AM (midnight)");
    expect(slotLabel("00:30")).toBe("12:30 AM");
    expect(slotLabel("12:00")).toBe("12:00 PM (noon)");
    expect(slotLabel("13:30")).toBe("1:30 PM");
    expect(formatIstDate("2027-01-01")).toBe("1 January 2027");
  });
});

describe("money formatting", () => {
  it("formats integer paise", () => {
    expect(formatRupees(19900)).toBe("₹199");
    expect(formatRupees(3980)).toBe("₹39.80");
    expect(formatRupeesPlain(89900)).toBe("899");
    expect(formatRupees(12345600)).toBe("₹1,23,456");
  });

  it("refuses non-integer paise", () => {
    expect(() => formatRupees(199.5)).toThrow();
  });

  it("per-pigeon is display-only rounding", () => {
    expect(perPigeonPaise(59900, 20)).toBe(2995);
    expect(perPigeonPaise(12900, 3)).toBe(4300);
  });
});
