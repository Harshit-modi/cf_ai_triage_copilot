// PURE: turn a model response into a validated Triage object.
import type { Severity, Triage } from "./types";

export const MAX_FIELD_CHARS = 500;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Returns the first balanced {...} substring, respecting JSON strings. */
function firstBalancedObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Workers AI JSON mode may hand back an already-parsed object or a string
 * (sometimes fenced or wrapped in prose). Normalise to an object or null.
 */
export function extractJson(raw: unknown): Record<string, unknown> | null {
  if (isObject(raw)) return raw;
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1]!.trim();
  const direct = tryParse(s);
  if (direct) return direct;
  const inner = firstBalancedObject(s);
  return inner ? tryParse(inner) : null;
}

const SEVERITY_SYNONYMS: Record<string, Severity> = {
  critical: "critical", crit: "critical", sev1: "critical", p1: "critical", emergency: "critical", page: "critical", fatal: "critical",
  high: "high", error: "high", major: "high", sev2: "high", p2: "high", severe: "high",
  medium: "medium", moderate: "medium", warning: "medium", warn: "medium", sev3: "medium", p3: "medium",
  low: "low", minor: "low", sev4: "low", p4: "low",
  info: "info", informational: "info", none: "info", ok: "info", sev5: "info", p5: "info",
};

export function normalizeSeverity(x: unknown): Severity | null {
  if (typeof x !== "string") return null;
  return SEVERITY_SYNONYMS[x.trim().toLowerCase()] ?? null;
}

function normalizeText(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  if (t.length === 0) return null;
  return t.length > MAX_FIELD_CHARS ? t.slice(0, MAX_FIELD_CHARS - 1) + "…" : t;
}

function normalizeConfidence(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number.parseFloat(x) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}

export function validateTriage(x: unknown): Triage | null {
  if (!isObject(x)) return null;
  const severity = normalizeSeverity(x.severity);
  const user_impact = normalizeText(x.user_impact);
  const likely_cause = normalizeText(x.likely_cause);
  const suggested_action = normalizeText(x.suggested_action);
  const confidence = normalizeConfidence(x.confidence);
  if (!severity || !user_impact || !likely_cause || !suggested_action || confidence === null) return null;
  return { severity, user_impact, likely_cause, suggested_action, confidence };
}
