import { describe, expect, it } from "vitest";
import { alertText, dedupeKey, extractService, fingerprintOf, fnv1a, MAX_ALERTS, parsePayload } from "../src/alerts";
import type { AMAlert } from "../src/types";

const alert = (labels: Record<string, string>, extra: Partial<AMAlert> = {}): AMAlert => ({
  status: "firing",
  labels,
  ...extra,
});

describe("parsePayload", () => {
  const valid = {
    version: "4",
    status: "firing",
    receiver: "copilot",
    alerts: [
      {
        status: "firing",
        labels: { alertname: "HighErrorRate", service: "checkout-api", replicas: 3 },
        annotations: { summary: "5xx > 5%" },
        startsAt: "2026-11-09T10:00:00Z",
        endsAt: "0001-01-01T00:00:00Z",
        fingerprint: "abc123",
      },
    ],
    commonLabels: { service: "checkout-api" },
  };

  it("accepts a valid Alertmanager payload", () => {
    const r = parsePayload(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.alerts).toHaveLength(1);
    expect(r.payload.alerts[0]!.fingerprint).toBe("abc123");
    expect(r.payload.alerts[0]!.labels.replicas).toBe("3"); // numbers coerced
    expect(r.payload.commonLabels).toEqual({ service: "checkout-api" });
    expect(r.dropped).toBe(0);
  });

  it.each([
    [null, "object"],
    [[], "object"],
    ["str", "object"],
    [{}, "alerts"],
    [{ alerts: {} }, "alerts"],
    [{ alerts: [] }, "empty"],
    [{ alerts: [1] }, "alerts[0]"],
    [{ alerts: [{ status: "pending", labels: {} }] }, "status"],
    [{ alerts: [{ status: "firing" }] }, "labels"],
    [{ alerts: [{ status: "firing", labels: [] }] }, "labels"],
  ])("rejects %j", (body, msg) => {
    const r = parsePayload(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it(`caps at ${MAX_ALERTS} alerts`, () => {
    const alerts = Array.from({ length: 130 }, (_, i) => ({ status: "firing", labels: { alertname: `A${i}` } }));
    const r = parsePayload({ alerts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.alerts).toHaveLength(MAX_ALERTS);
    expect(r.dropped).toBe(30);
  });
});

describe("extractService", () => {
  it("follows label precedence", () => {
    const all = { service: "s", app: "a", "app.kubernetes.io/name": "k", job: "j", namespace: "n" };
    expect(extractService(alert(all))).toBe("s");
    const { service: _s, ...noService } = all;
    expect(extractService(alert(noService))).toBe("a");
    const { app: _a, ...noApp } = noService;
    expect(extractService(alert(noApp))).toBe("k");
    const { "app.kubernetes.io/name": _k, ...noK8s } = noApp;
    expect(extractService(alert(noK8s))).toBe("j");
    expect(extractService(alert({ namespace: "n" }))).toBe("n");
  });

  it("uses commonLabels.service before namespace", () => {
    expect(extractService(alert({ namespace: "shop" }), { service: "payments" })).toBe("payments");
    expect(extractService(alert({ job: "node" }), { service: "payments" })).toBe("node");
  });

  it("defaults to unknown", () => {
    expect(extractService(alert({ alertname: "X" }))).toBe("unknown");
    expect(extractService(alert({ service: "  " }))).toBe("unknown");
  });

  it("lowercases, sanitises and truncates", () => {
    expect(extractService(alert({ service: "Checkout API" }))).toBe("checkout-api");
    expect(extractService(alert({ service: "team/payments:v2" }))).toBe("team-payments-v2");
    expect(extractService(alert({ service: "x".repeat(100) }))).toHaveLength(64);
    expect(extractService(alert({ service: "_internal" }))).toMatch(/^[a-z0-9]/);
  });
});

describe("fingerprintOf / dedupeKey", () => {
  it("prefers Alertmanager's fingerprint", () => {
    expect(fingerprintOf(alert({ a: "1" }, { fingerprint: "fp1" }))).toBe("fp1");
  });
  it("is stable regardless of label order", () => {
    const a = fingerprintOf(alert({ alertname: "X", service: "s", env: "prod" }));
    const b = fingerprintOf(alert({ env: "prod", service: "s", alertname: "X" }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
  it("differs for different labels", () => {
    expect(fingerprintOf(alert({ alertname: "X" }))).not.toBe(fingerprintOf(alert({ alertname: "Y" })));
  });
  it("fnv1a matches the reference value", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
  });
  it("dedupeKey includes status", () => {
    expect(dedupeKey("fp", "firing")).toBe("fp:firing");
    expect(dedupeKey("fp", "resolved")).not.toBe(dedupeKey("fp", "firing"));
  });
});

describe("alertText", () => {
  it("includes name, service, summary, description but no timestamps", () => {
    const a = alert(
      { alertname: "HighLatency", service: "search" },
      {
        annotations: { summary: "p99 > 2s", description: "search p99 high" },
        startsAt: "2026-11-09T10:00:00Z",
        endsAt: "2026-11-09T11:00:00Z",
      },
    );
    const t = alertText(a, "search");
    expect(t).toContain("HighLatency");
    expect(t).toContain("search");
    expect(t).toContain("p99 > 2s");
    expect(t).toContain("search p99 high");
    expect(t).not.toMatch(/2026|T10:00/);
  });
  it("is identical for repeats with different timestamps", () => {
    const a = alert({ alertname: "X" }, { startsAt: "2026-01-01T00:00:00Z" });
    const b = alert({ alertname: "X" }, { startsAt: "2026-02-01T00:00:00Z" });
    expect(alertText(a, "s")).toBe(alertText(b, "s"));
  });
});
