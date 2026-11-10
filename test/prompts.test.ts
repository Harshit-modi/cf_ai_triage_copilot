import { describe, expect, it } from "vitest";
import {
  buildChatMessages,
  buildClassifyMessages,
  buildFallbackDigest,
  CLASSIFY_SYSTEM,
  promptLabels,
  TRIAGE_JSON_SCHEMA,
} from "../src/prompts";
import type { AMAlert, ChatContext, MemoryHit, TimelineEntry } from "../src/types";

const alert: AMAlert = {
  status: "firing",
  labels: {
    alertname: "HighErrorRate",
    service: "checkout-api",
    severity: "critical",
    instance: "10.0.0.1:8080",
    pod: "checkout-7d9f",
    start_time: "2026-11-09T10:00:00Z",
  },
  annotations: { summary: "5xx above 5%", description: "checkout 5xx ratio 12%" },
  startsAt: "2026-11-09T10:00:00Z",
};

const hits: MemoryHit[] = [
  { id: "rb:high-5xx-rate", score: 0.8123, kind: "runbook", title: "Runbook: elevated 5xx", text: "Roll back recent deploys" },
  { id: "inc:abc", score: 0.71, kind: "incident", service: "checkout-api", title: "Past incident: bad deploy", text: "y".repeat(1000) },
];

const entry = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 1,
  ts: Date.UTC(2026, 10, 9, 10, 5, 0),
  fingerprint: "fp",
  alertname: "HighErrorRate",
  status: "firing",
  severity: "critical",
  source: "llm",
  summary: "5xx above 5%",
  user_impact: "Checkout failing",
  likely_cause: "Bad deploy",
  suggested_action: "Roll back",
  confidence: 0.8,
  labels: {},
  related: [],
  ...over,
});

describe("TRIAGE_JSON_SCHEMA", () => {
  it("requires all five fields with a severity enum", () => {
    expect([...TRIAGE_JSON_SCHEMA.required].sort()).toEqual(
      ["confidence", "likely_cause", "severity", "suggested_action", "user_impact"],
    );
    expect(TRIAGE_JSON_SCHEMA.properties.severity.enum).toEqual(["critical", "high", "medium", "low", "info"]);
    expect(TRIAGE_JSON_SCHEMA.properties.confidence.type).toBe("number");
  });
});

describe("buildClassifyMessages", () => {
  const [sys, user] = buildClassifyMessages(alert, "checkout-api", hits);

  it("uses the classify system prompt", () => {
    expect(sys!.role).toBe("system");
    expect(sys!.content).toBe(CLASSIFY_SYSTEM);
  });

  it("includes alert details and numbered hits", () => {
    expect(user!.content).toContain("Service: checkout-api");
    expect(user!.content).toContain("HighErrorRate");
    expect(user!.content).toContain("label severity: critical");
    expect(user!.content).toContain("Summary: 5xx above 5%");
    expect(user!.content).toContain("Description: checkout 5xx ratio 12%");
    expect(user!.content).toContain("1. [runbook] Runbook: elevated 5xx (similarity 0.81): Roll back recent deploys");
    expect(user!.content).toContain("2. [incident] Past incident: bad deploy (similarity 0.71)");
  });

  it("truncates hit text to 400 chars", () => {
    expect(user!.content).not.toContain("y".repeat(401));
  });

  it("excludes instance, pod and timestamps", () => {
    expect(user!.content).not.toContain("10.0.0.1");
    expect(user!.content).not.toContain("checkout-7d9f");
    expect(user!.content).not.toContain("2026");
  });

  it("says (none) when there are no hits", () => {
    const [, u] = buildClassifyMessages(alert, "checkout-api", []);
    expect(u!.content).toContain("(may be irrelevant):\n(none)");
  });

  it("sorts labels", () => {
    expect(promptLabels({ b: "2", a: "1" })).toBe("a=1, b=2");
  });
});

describe("buildChatMessages", () => {
  const contexts: ChatContext[] = [{ service: "checkout-api", entries: [entry()] }];
  const [sys, user] = buildChatMessages("what's up with checkout?", contexts, hits, "2026-11-09T10:10:00.000Z");

  it("puts the current time in the system prompt", () => {
    expect(sys!.content).toContain("Current time: 2026-11-09T10:10:00.000Z UTC");
    expect(sys!.content).toContain("Answer ONLY from the CONTEXT");
  });

  it("renders timeline lines and runbooks", () => {
    expect(user!.content).toContain("## Service checkout-api");
    expect(user!.content).toContain(
      "- 2026-11-09T10:05:00.000Z firing HighErrorRate [critical/llm] 5xx above 5% | action: Roll back",
    );
    expect(user!.content).toContain("## Runbooks/past incidents");
    expect(user!.content).toContain("- Runbook: elevated 5xx: Roll back recent deploys");
    expect(user!.content.endsWith("QUESTION: what's up with checkout?")).toBe(true);
  });

  it("notes when there are no alerts", () => {
    const [, u] = buildChatMessages("hi", [{ service: "x", entries: [] }], [], "now");
    expect(u!.content).toContain("(no recent alerts recorded)");
    expect(u!.content).not.toContain("## Runbooks");
  });
});

describe("buildFallbackDigest", () => {
  it("lists recent entries per service", () => {
    const d = buildFallbackDigest([{ service: "checkout-api", entries: [entry(), entry({ id: 2, alertname: "Other" })] }], hits);
    expect(d).toContain("checkout-api:");
    expect(d).toContain("HighErrorRate");
    expect(d).toContain("Other");
    expect(d).toContain("Runbook: elevated 5xx");
  });
  it("handles no data", () => {
    expect(buildFallbackDigest([], [])).toContain("No recent alerts");
  });
});
