import { describe, expect, it } from "vitest";
import { countGraphemes, issuesToFieldErrors, messageSchema, orderInputSchema } from "@/lib/validation";

const pigeon = (overrides = {}) => ({
  recipientName: "Priya",
  recipientEmail: "priya@example.com",
  message: "Happy New Year!",
  slot: "00:00",
  ...overrides,
});

const order = (overrides = {}) => ({
  packageSize: 3,
  sender: { name: "Raj", email: "raj@example.com" },
  allowPublicRelease: true,
  acceptTerms: true,
  pigeons: [pigeon(), pigeon({ recipientName: "Amit" }), pigeon({ recipientName: "Neha" })],
  ...overrides,
});

describe("grapheme counting", () => {
  it("counts emoji and Indic clusters as one character each", () => {
    expect(countGraphemes("👨‍👩‍👧")).toBe(1);
    expect(countGraphemes("🇮🇳")).toBe(1);
    expect(countGraphemes("नमस्ते")).toBe(3); // न म स्ते
    expect(countGraphemes("abc")).toBe(3);
  });
});

describe("message rules", () => {
  it("accepts exactly 500 characters and rejects 501", () => {
    expect(messageSchema.safeParse("a".repeat(500)).success).toBe(true);
    expect(messageSchema.safeParse("a".repeat(501)).success).toBe(false);
  });

  it("counts 500 emoji as 500, not as UTF-16 units", () => {
    expect(messageSchema.safeParse("🕊️".repeat(500)).success).toBe(true);
  });

  it("rejects empty or whitespace-only messages", () => {
    expect(messageSchema.safeParse("").success).toBe(false);
    expect(messageSchema.safeParse("   \n\n ").success).toBe(false);
  });

  it("keeps line breaks, strips control characters and bidi overrides", () => {
    const r = messageSchema.safeParse("Line one\r\nLine two\u0007‮");
    expect(r.success && r.data).toBe("Line one\nLine two");
  });
});

describe("order input", () => {
  it("accepts a valid order and normalises emails", () => {
    const r = orderInputSchema.safeParse(order({ sender: { name: " Raj ", email: " RAJ@Example.COM " } }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sender.email).toBe("raj@example.com");
      expect(r.data.sender.name).toBe("Raj");
    }
  });

  it("requires exactly package-size pigeons", () => {
    const tooMany = orderInputSchema.safeParse(order({ pigeons: [pigeon(), pigeon(), pigeon(), pigeon()] }));
    const tooFew = orderInputSchema.safeParse(order({ pigeons: [pigeon()] }));
    expect(tooMany.success).toBe(false);
    expect(tooFew.success).toBe(false);
    if (!tooFew.success) expect(issuesToFieldErrors(tooFew.error).pigeons).toMatch(/exactly 3/);
  });

  it("rejects unknown package sizes, bad slots, bad emails and missing consent", () => {
    expect(orderInputSchema.safeParse(order({ packageSize: 4 })).success).toBe(false);
    expect(orderInputSchema.safeParse(order({ pigeons: [pigeon({ slot: "00:15" }), pigeon(), pigeon()] })).success).toBe(false);
    expect(orderInputSchema.safeParse(order({ pigeons: [pigeon({ recipientEmail: "nope" }), pigeon(), pigeon()] })).success).toBe(false);
    expect(orderInputSchema.safeParse(order({ acceptTerms: false })).success).toBe(false);
  });

  it("ignores any price the browser tries to send", () => {
    const r = orderInputSchema.safeParse({ ...order(), amountPaise: 100 });
    expect(r.success).toBe(true);
    if (r.success) expect("amountPaise" in r.data).toBe(false);
  });

  it("reports field paths the form can show", () => {
    const r = orderInputSchema.safeParse(order({ pigeons: [pigeon(), pigeon({ message: "" }), pigeon()] }));
    expect(r.success).toBe(false);
    if (!r.success) expect(issuesToFieldErrors(r.error)["pigeons.1.message"]).toBe("Write a message");
  });
});
