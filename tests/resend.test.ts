import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@shared/resend";

const email = {
  from: "Pigeon Post <p@example.com>",
  to: "r@example.com",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  idempotencyKey: "pigeon/123/v1",
};

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("sendEmail outcome classification", () => {
  it("sends the idempotency key and a User-Agent, and returns the provider id", async () => {
    const fn = mockFetch(200, { id: "em_1" });
    expect(await sendEmail("key", email)).toEqual({ outcome: "ACCEPTED", id: "em_1" });
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("pigeon/123/v1");
    expect(headers["User-Agent"]).toBeTruthy();
  });

  it("treats 429 as throttled and reads retry-after", async () => {
    mockFetch(429, { name: "rate_limit_exceeded" }, { "retry-after": "3" });
    expect(await sendEmail("key", email)).toMatchObject({ outcome: "THROTTLED", retryAfterSeconds: 3 });
  });

  it("does not retry invalid requests", async () => {
    mockFetch(422, { name: "validation_error", message: "Invalid `to` field" });
    expect((await sendEmail("key", email)).outcome).toBe("PERMANENT_FAILURE");
    mockFetch(409, { name: "invalid_idempotent_request" });
    expect((await sendEmail("key", email)).outcome).toBe("PERMANENT_FAILURE");
  });

  it("retries server errors, auth/config errors and concurrent idempotent requests", async () => {
    mockFetch(500, {});
    expect((await sendEmail("key", email)).outcome).toBe("RETRY");
    mockFetch(403, { name: "validation_error", message: "domain not verified" });
    expect((await sendEmail("key", email)).outcome).toBe("RETRY");
    mockFetch(409, { name: "concurrent_idempotent_requests" });
    expect((await sendEmail("key", email)).outcome).toBe("RETRY");
  });

  it("retries network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await sendEmail("key", email)).outcome).toBe("RETRY");
  });
});
