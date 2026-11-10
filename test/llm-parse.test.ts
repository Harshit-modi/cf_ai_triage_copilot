import { describe, expect, it } from "vitest";
import { extractJson, MAX_FIELD_CHARS, normalizeSeverity, validateTriage } from "../src/llm-parse";

const good = {
  severity: "high",
  user_impact: "Checkout failing for 30% of users",
  likely_cause: "Bad deploy",
  suggested_action: "Roll back checkout-api",
  confidence: 0.8,
};

describe("extractJson", () => {
  it("passes objects through", () => {
    expect(extractJson(good)).toBe(good);
  });
  it("parses plain JSON strings", () => {
    expect(extractJson(JSON.stringify(good))).toEqual(good);
  });
  it("strips ```json fences", () => {
    expect(extractJson("```json\n" + JSON.stringify(good) + "\n```")).toEqual(good);
    expect(extractJson("```\n" + JSON.stringify(good) + "\n```")).toEqual(good);
  });
  it("finds the object inside prose", () => {
    const s = `Sure! Here is the triage: ${JSON.stringify({ ...good, user_impact: "uses {braces} and \"quotes\"" })} Hope it helps.`;
    expect(extractJson(s)?.user_impact).toBe('uses {braces} and "quotes"');
  });
  it("returns null on garbage", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{ broken")).toBeNull();
    expect(extractJson("[1,2]")).toBeNull();
    expect(extractJson(42)).toBeNull();
    expect(extractJson(null)).toBeNull();
    expect(extractJson(undefined)).toBeNull();
  });
});

describe("validateTriage", () => {
  it("accepts a well-formed triage", () => {
    expect(validateTriage(good)).toEqual(good);
  });

  it.each(["severity", "user_impact", "likely_cause", "suggested_action", "confidence"])("rejects missing %s", (k) => {
    const x: Record<string, unknown> = { ...good };
    delete x[k];
    expect(validateTriage(x)).toBeNull();
  });

  it("rejects empty strings and bad types", () => {
    expect(validateTriage({ ...good, user_impact: "   " })).toBeNull();
    expect(validateTriage({ ...good, likely_cause: 3 })).toBeNull();
    expect(validateTriage({ ...good, confidence: "high" })).toBeNull();
    expect(validateTriage({ ...good, severity: "catastrophic" })).toBeNull();
    expect(validateTriage(null)).toBeNull();
    expect(validateTriage("x")).toBeNull();
  });

  it.each([
    ["CRITICAL", "critical"], ["sev1", "critical"], ["P1", "critical"],
    ["error", "high"], ["major", "high"],
    ["warning", "medium"], ["Moderate", "medium"],
    ["minor", "low"],
    ["informational", "info"], ["none", "info"],
  ])("normalises severity %s -> %s", (input, expected) => {
    expect(validateTriage({ ...good, severity: input })?.severity).toBe(expected);
    expect(normalizeSeverity(` ${input} `)).toBe(expected);
  });

  it("scales percentage confidence", () => {
    expect(validateTriage({ ...good, confidence: 85 })?.confidence).toBeCloseTo(0.85);
    expect(validateTriage({ ...good, confidence: "70" })?.confidence).toBeCloseTo(0.7);
    expect(validateTriage({ ...good, confidence: 100 })?.confidence).toBe(1);
  });

  it("clamps confidence to 0..1", () => {
    expect(validateTriage({ ...good, confidence: -0.5 })?.confidence).toBe(0);
    expect(validateTriage({ ...good, confidence: 250 })?.confidence).toBe(1);
    expect(validateTriage({ ...good, confidence: 1 })?.confidence).toBe(1);
  });

  it("trims and truncates text fields", () => {
    const r = validateTriage({ ...good, likely_cause: "  spaced  ", user_impact: "x".repeat(2000) });
    expect(r?.likely_cause).toBe("spaced");
    expect(r?.user_impact.length).toBe(MAX_FIELD_CHARS);
  });

  it("composes with extractJson for a fenced string response", () => {
    const raw = "```json\n" + JSON.stringify({ ...good, severity: "Warning", confidence: 60 }) + "\n```";
    expect(validateTriage(extractJson(raw))).toEqual({ ...good, severity: "medium", confidence: 0.6 });
  });
});
