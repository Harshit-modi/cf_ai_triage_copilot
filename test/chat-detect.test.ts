import { describe, expect, it } from "vitest";
import { detectServices } from "../src/chat-detect";

const known = ["checkout-api", "payments", "auth", "search", "api-gateway", "svc-billing", "prod-db", "inventory"];

describe("detectServices", () => {
  it("matches exact service names", () => {
    expect(detectServices("what's happening with checkout-api?", known, [])).toEqual(["checkout-api"]);
    expect(detectServices("Any PAYMENTS alerts?", known, [])).toEqual(["payments"]);
  });

  it("matches the primary segment", () => {
    expect(detectServices("is checkout ok", known, [])).toEqual(["checkout-api"]);
  });

  it("matches multiple services, exact matches first", () => {
    expect(detectServices("checkout, payments and auth status", known, [])).toEqual(["payments", "auth", "checkout-api"]);
  });

  it("ignores generic and short primary segments", () => {
    // "api" (api-gateway), "svc" (svc-billing) and "prod" (prod-db) are generic
    expect(detectServices("the api is slow in prod, svc too", known, ["inventory"])).toEqual(["inventory"]);
  });

  it("does not match substrings of other words", () => {
    expect(detectServices("authentication is weird", ["auth"], [])).toEqual([]);
    expect(detectServices("research team", ["search"], [])).toEqual([]);
  });

  it("falls back to recent services", () => {
    expect(detectServices("what's going on?", known, ["search", "auth", "payments", "inventory"])).toEqual([
      "search",
      "auth",
      "payments",
    ]);
    expect(detectServices("hello", [], [])).toEqual([]);
  });

  it("caps at 3", () => {
    expect(detectServices("checkout-api payments auth search inventory", known, [])).toHaveLength(3);
  });
});
