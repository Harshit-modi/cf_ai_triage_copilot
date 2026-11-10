import { describe, expect, it } from "vitest";
import { bearerToken, checkBearer, json, rateLimitKey, timingSafeEqual, tooManyRequests, webhookAuth } from "../src/http";

describe("checkBearer", () => {
  it("fails closed when no secret is configured", () => {
    expect(checkBearer(null, undefined)).toBe(false);
    expect(checkBearer("Bearer whatever", undefined)).toBe(false);
    expect(checkBearer("Bearer whatever", "")).toBe(false);
    expect(checkBearer("Bearer ", "")).toBe(false);
  });
  it("accepts the right token", () => {
    expect(checkBearer("Bearer s3cret", "s3cret")).toBe(true);
    expect(checkBearer("bearer   s3cret ", "s3cret")).toBe(true);
  });
  it("rejects missing, malformed or wrong tokens", () => {
    expect(checkBearer(null, "s3cret")).toBe(false);
    expect(checkBearer("", "s3cret")).toBe(false);
    expect(checkBearer("s3cret", "s3cret")).toBe(false);
    expect(checkBearer("Basic s3cret", "s3cret")).toBe(false);
    expect(checkBearer("Bearer s3cre", "s3cret")).toBe(false);
    expect(checkBearer("Bearer s3cretx", "s3cret")).toBe(false);
    expect(checkBearer("Bearer S3CRET", "s3cret")).toBe(false);
  });
});

describe("webhookAuth", () => {
  it("with a token, accepts only the matching bearer", () => {
    expect(webhookAuth("Bearer s3cret", "s3cret", "production")).toBe("ok");
    expect(webhookAuth("Bearer wrong", "s3cret", "production")).toBe("unauthorized");
    expect(webhookAuth(null, "s3cret", "production")).toBe("unauthorized");
    expect(webhookAuth(undefined, "s3cret", undefined)).toBe("unauthorized");
  });
  it("with a token, development does not bypass auth", () => {
    expect(webhookAuth(null, "s3cret", "development")).toBe("unauthorized");
    expect(webhookAuth("Bearer s3cret", "s3cret", "development")).toBe("ok");
  });
  it("without a token, fails closed outside development", () => {
    for (const env of ["production", undefined, "Development", "staging", "", "dev"]) {
      expect(webhookAuth("Bearer anything", undefined, env)).toBe("not_configured");
      expect(webhookAuth(null, undefined, env)).toBe("not_configured");
    }
  });
  it("without a token, allows requests only in development", () => {
    expect(webhookAuth(null, undefined, "development")).toBe("ok");
    expect(webhookAuth("Bearer anything", undefined, " development ")).toBe("ok");
  });
  it("treats an empty-string token as unset", () => {
    expect(webhookAuth("Bearer ", "", "production")).toBe("not_configured");
    expect(webhookAuth(null, "", undefined)).toBe("not_configured");
    expect(webhookAuth(null, "", "development")).toBe("ok");
  });
});

describe("timingSafeEqual / bearerToken", () => {
  it("compares strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
  it("extracts bearer tokens", () => {
    expect(bearerToken("Bearer x.y")).toBe("x.y");
    expect(bearerToken("Token x")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("rateLimitKey", () => {
  it("prefers a hashed token over the IP", async () => {
    const req = new Request("https://x/webhook/alertmanager", {
      headers: { authorization: "Bearer abc", "cf-connecting-ip": "1.2.3.4" },
    });
    const key = await rateLimitKey(req);
    expect(key).toMatch(/^tok:[0-9a-f]{16}$/);
    // sha256("abc") = ba7816bf8f01cfea...
    expect(key).toBe("tok:ba7816bf8f01cfea");
    expect(key).not.toContain("abc");
  });
  it("falls back to the client IP", async () => {
    const req = new Request("https://x/", { headers: { "cf-connecting-ip": "1.2.3.4" } });
    expect(await rateLimitKey(req)).toBe("ip:1.2.3.4");
  });
  it("uses 'unknown' with no IP", async () => {
    expect(await rateLimitKey(new Request("https://x/"))).toBe("ip:unknown");
  });
});

describe("json helpers", () => {
  it("serialises with status and content type", async () => {
    const r = json({ a: 1 }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toEqual({ a: 1 });
  });
  it("429 carries Retry-After", () => {
    const r = tooManyRequests(60);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });
});
