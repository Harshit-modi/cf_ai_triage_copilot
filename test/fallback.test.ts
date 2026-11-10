import { describe, expect, it } from "vitest";
import { FALLBACK_CAUSE, FALLBACK_CONFIDENCE, fallbackClassify } from "../src/fallback";
import type { AMAlert } from "../src/types";

const mk = (labels: Record<string, string>, annotations?: Record<string, string>, status: AMAlert["status"] = "firing"): AMAlert => ({
  status,
  labels,
  annotations,
});

describe("fallbackClassify", () => {
  it("resolved alerts are info", () => {
    const r = fallbackClassify(mk({ alertname: "ServiceDown", severity: "critical" }, undefined, "resolved"), "s");
    expect(r.severity).toBe("info");
    expect(r.user_impact).toMatch(/^Resolved/);
  });

  it.each([
    ["critical", "critical"], ["page", "critical"], ["P1", "critical"], ["sev1", "critical"], ["emergency", "critical"],
    ["high", "high"], ["error", "high"], ["major", "high"], ["p2", "high"], ["sev2", "high"],
    ["warning", "medium"], ["warn", "medium"], ["p3", "medium"], ["sev3", "medium"],
    ["low", "low"], ["minor", "low"], ["p4", "low"],
    ["info", "info"], ["none", "info"], ["p5", "info"],
  ])("maps label severity %s -> %s", (label, expected) => {
    expect(fallbackClassify(mk({ alertname: "Something", severity: label }), "s").severity).toBe(expected);
  });

  it.each([
    ["ServiceDown", "high"],
    ["Outage", "high"],
    ["EndpointUnreachable", "high"],
    ["HTTP503Spike", "high"],
    ["HighErrorRate", "high"],
    ["Error_Rate_Budget", "high"],
    ["PodCrashLoop", "high"],
    ["ContainerOOM", "high"],
    ["HighLatency", "medium"],
    ["SlowQueries", "medium"],
    ["CpuSaturation", "medium"],
    ["DiskAlmostFull", "medium"],
    ["QueueBacklog", "medium"],
    ["Watchdog", "info"],
    ["HeartbeatMissing", "info"],
    ["TestAlert", "info"],
    ["SomethingOdd", "medium"],
  ])("keywords without label: %s -> %s", (name, expected) => {
    expect(fallbackClassify(mk({ alertname: name }), "s").severity).toBe(expected);
  });

  it("uses summary for keywords too", () => {
    expect(fallbackClassify(mk({ alertname: "X" }, { summary: "checkout is down" }), "s").severity).toBe("high");
  });

  it("bumps high to critical for down/outage", () => {
    expect(fallbackClassify(mk({ alertname: "CheckoutDown", severity: "high" }), "s").severity).toBe("critical");
    expect(fallbackClassify(mk({ alertname: "X", severity: "critical" }, { summary: "full outage" }), "s").severity).toBe("critical");
  });

  it("does not bump below high", () => {
    expect(fallbackClassify(mk({ alertname: "ReplicaDown", severity: "warning" }), "s").severity).toBe("medium");
  });

  it("unknown label value falls back to keywords", () => {
    expect(fallbackClassify(mk({ alertname: "HighLatency", severity: "weird" }), "s").severity).toBe("medium");
  });

  it("fills fields with defaults", () => {
    const r = fallbackClassify(mk({ alertname: "X" }, { summary: "Checkout errors" }), "checkout-api");
    expect(r.user_impact).toBe("Checkout errors");
    expect(r.likely_cause).toBe(FALLBACK_CAUSE);
    expect(r.suggested_action).toBe("Check dashboards/recent deploys for checkout-api");
    expect(r.confidence).toBe(FALLBACK_CONFIDENCE);
  });

  it("uses alertname when there is no summary", () => {
    expect(fallbackClassify(mk({ alertname: "X" }), "s").user_impact).toBe("X");
  });

  it("points at runbook_url when present", () => {
    const r = fallbackClassify(mk({ alertname: "X" }, { runbook_url: "https://runbooks/x" }), "s");
    expect(r.suggested_action).toContain("https://runbooks/x");
  });
});
