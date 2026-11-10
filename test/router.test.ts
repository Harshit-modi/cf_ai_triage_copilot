import { describe, expect, it } from "vitest";
import { matchRoute } from "../src/router";

describe("matchRoute", () => {
  it("matches each route with its method", () => {
    expect(matchRoute("POST", "/webhook/alertmanager")).toEqual({ name: "webhook" });
    expect(matchRoute("POST", "/api/chat")).toEqual({ name: "chat" });
    expect(matchRoute("GET", "/api/services")).toEqual({ name: "services" });
    expect(matchRoute("GET", "/api/services/checkout-api/timeline")).toEqual({ name: "timeline", service: "checkout-api" });
    expect(matchRoute("POST", "/admin/seed")).toEqual({ name: "seed" });
  });

  it("is case-insensitive on method", () => {
    expect(matchRoute("post", "/api/chat")).toEqual({ name: "chat" });
  });

  it("returns method_not_allowed with the allowed method", () => {
    expect(matchRoute("GET", "/webhook/alertmanager")).toEqual({ name: "method_not_allowed", allow: "POST" });
    expect(matchRoute("DELETE", "/api/services")).toEqual({ name: "method_not_allowed", allow: "GET" });
    expect(matchRoute("POST", "/api/services/payments/timeline")).toEqual({ name: "method_not_allowed", allow: "GET" });
    expect(matchRoute("GET", "/admin/seed")).toEqual({ name: "method_not_allowed", allow: "POST" });
  });

  it("returns null for unknown paths", () => {
    expect(matchRoute("GET", "/")).toBeNull();
    expect(matchRoute("GET", "/index.html")).toBeNull();
    expect(matchRoute("GET", "/api/unknown")).toBeNull();
    expect(matchRoute("GET", "/api/services/x/timeline/extra")).toBeNull();
    expect(matchRoute("GET", "/api/services//timeline")).toBeNull();
  });

  it("decodes the service name", () => {
    expect(matchRoute("GET", "/api/services/svc%2Dv2.prod/timeline")).toEqual({ name: "timeline", service: "svc-v2.prod" });
  });

  it("rejects invalid service names", () => {
    expect(matchRoute("GET", "/api/services/Checkout/timeline")).toBeNull();
    expect(matchRoute("GET", "/api/services/-lead/timeline")).toBeNull();
    expect(matchRoute("GET", "/api/services/a%20b/timeline")).toBeNull();
    expect(matchRoute("GET", "/api/services/%E0%A4%A/timeline")).toBeNull(); // malformed escape
    expect(matchRoute("GET", `/api/services/${"a".repeat(65)}/timeline`)).toBeNull();
    expect(matchRoute("GET", `/api/services/${"a".repeat(64)}/timeline`)).toEqual({ name: "timeline", service: "a".repeat(64) });
  });

  it("tolerates a trailing slash", () => {
    expect(matchRoute("POST", "/webhook/alertmanager/")).toEqual({ name: "webhook" });
    expect(matchRoute("GET", "/api/services/")).toEqual({ name: "services" });
    expect(matchRoute("GET", "/api/services/auth/timeline/")).toEqual({ name: "timeline", service: "auth" });
  });
});
