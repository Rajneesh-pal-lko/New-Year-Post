import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { deriveToken, hashToken, looksLikeToken, randomNonce } from "@shared/tokens";
import { escapeHtml, orderConfirmationEmail, recipientPigeonEmail } from "@shared/templates";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/razorpay";
import { verifySvixSignature } from "@/lib/svix";
import { issueToken, secretMatches, tokenMatches } from "@/lib/tokens";

const SECRET = "test-token-secret-that-is-long-enough-1234567890";

beforeAll(() => {
  process.env.TOKEN_SECRET = SECRET;
});

describe("link tokens", () => {
  it("re-derives the same token from secret + nonce (so retried emails carry the same link)", async () => {
    const nonce = randomNonce();
    const a = await deriveToken(SECRET, "recipient", "pigeon-1", nonce);
    const b = await deriveToken(SECRET, "recipient", "pigeon-1", nonce);
    expect(a).toBe(b);
    expect(looksLikeToken(a)).toBe(true);
  });

  it("differs by purpose, id, nonce and secret", async () => {
    const nonce = randomNonce();
    const base = await deriveToken(SECRET, "recipient", "x", nonce);
    expect(await deriveToken(SECRET, "order", "x", nonce)).not.toBe(base);
    expect(await deriveToken(SECRET, "recipient", "y", nonce)).not.toBe(base);
    expect(await deriveToken(SECRET, "recipient", "x", randomNonce())).not.toBe(base);
    expect(await deriveToken(`${SECRET}!`, "recipient", "x", nonce)).not.toBe(base);
  });

  it("refuses a short secret", async () => {
    await expect(deriveToken("short", "recipient", "x", "n")).rejects.toThrow();
  });

  it("stores only a hash, and matches presented tokens against it", async () => {
    const issued = await issueToken("order", "PP-ABCDEFGHJK");
    expect(issued.hash).toBe(await hashToken(issued.token));
    expect(issued.hash).not.toContain(issued.token);
    expect(await tokenMatches(issued.token, issued.hash)).toBe(true);
    const last = issued.token.at(-1) === "A" ? "B" : "A";
    expect(await tokenMatches(issued.token.slice(0, -1) + last, issued.hash)).toBe(false);
    expect(await tokenMatches("", issued.hash)).toBe(false);
    expect(await tokenMatches(null, issued.hash)).toBe(false);
  });

  it("compares shared secrets safely", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("ab", "abc")).toBe(false);
    expect(secretMatches(null, "abc")).toBe(false);
  });
});

describe("Razorpay signatures", () => {
  const keySecret = "rzp_key_secret";
  const webhookSecret = "rzp_webhook_secret";

  it("verifies the checkout signature over order_id|payment_id", () => {
    const sig = createHmac("sha256", keySecret).update("order_ABC|pay_XYZ").digest("hex");
    expect(verifyCheckoutSignature("order_ABC", "pay_XYZ", sig, keySecret)).toBe(true);
    expect(verifyCheckoutSignature("order_ABC", "pay_OTHER", sig, keySecret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC", "pay_XYZ", sig, "wrong")).toBe(false);
    expect(verifyCheckoutSignature("order_ABC", "pay_XYZ", "", keySecret)).toBe(false);
  });

  it("verifies webhooks over the RAW body bytes", () => {
    const raw = Buffer.from('{"event":"payment.captured",  "payload":{"x":1}}');
    const sig = createHmac("sha256", webhookSecret).update(raw).digest("hex");
    expect(verifyWebhookSignature(raw, sig, webhookSecret)).toBe(true);
    // Re-serialising the parsed JSON changes the bytes and must fail.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString())));
    expect(verifyWebhookSignature(reserialised, sig, webhookSecret)).toBe(false);
    expect(verifyWebhookSignature(raw, null, webhookSecret)).toBe(false);
  });
});

describe("Resend (Svix) webhook signatures", () => {
  const key = Buffer.from("resend-test-signing-key-bytes!!").toString("base64");
  const secret = `whsec_${key}`;
  const body = '{"type":"email.delivered","data":{"email_id":"abc"}}';
  const ts = "1767225600";
  const sign = (content: string) => createHmac("sha256", Buffer.from(key, "base64")).update(content).digest("base64");

  it("accepts a valid signature, including when several are listed", () => {
    const sig = sign(`msg_1.${ts}.${body}`);
    expect(verifySvixSignature({ rawBody: body, id: "msg_1", timestamp: ts, signatureHeader: `v1,${sig}`, secret, nowSeconds: Number(ts) })).toBe(true);
    expect(
      verifySvixSignature({ rawBody: body, id: "msg_1", timestamp: ts, signatureHeader: `v1,bogus v1,${sig}`, secret, nowSeconds: Number(ts) }),
    ).toBe(true);
  });

  it("rejects tampering, wrong ids and stale timestamps", () => {
    const sig = sign(`msg_1.${ts}.${body}`);
    expect(verifySvixSignature({ rawBody: body + " ", id: "msg_1", timestamp: ts, signatureHeader: `v1,${sig}`, secret, nowSeconds: Number(ts) })).toBe(false);
    expect(verifySvixSignature({ rawBody: body, id: "msg_2", timestamp: ts, signatureHeader: `v1,${sig}`, secret, nowSeconds: Number(ts) })).toBe(false);
    expect(
      verifySvixSignature({ rawBody: body, id: "msg_1", timestamp: ts, signatureHeader: `v1,${sig}`, secret, nowSeconds: Number(ts) + 600 }),
    ).toBe(false);
  });
});

describe("email templates", () => {
  it("escapes user-supplied names and never includes the message", () => {
    const email = recipientPigeonEmail({
      recipientName: "<b>Priya</b>",
      senderName: 'Raj "<script>alert(1)</script>"',
      link: "https://example.com/open/abc",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("keeps subjects on one line", () => {
    const email = recipientPigeonEmail({ recipientName: "A", senderName: "Raj\r\nBcc: x@y.z", link: "https://e.com" });
    expect(email.subject).toBe("Raj Bcc: x@y.z sent you a New Year pigeon");
  });

  it("builds the order confirmation with every pigeon", () => {
    const email = orderConfirmationEmail({
      senderName: "Raj",
      orderRef: "PP-ABCDEFGHJK",
      orderLink: "https://e.com/order/PP-ABCDEFGHJK?k=t",
      amountRupees: "199",
      deliveryDate: "2027-01-01",
      pigeons: [
        { publicId: "PGN-AAAAAAAA", recipientName: "Priya", slot: "00:00" },
        { publicId: "PGN-BBBBBBBB", recipientName: "Amit", slot: "08:30" },
      ],
    });
    expect(email.subject).toBe("Your 2 pigeons are booked for 1 January 2027");
    expect(email.text).toContain("Priya: 12:00 AM (midnight) IST");
    expect(email.text).toContain("Amit: 8:30 AM IST");
  });

  it("escapeHtml covers the five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
