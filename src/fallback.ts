// PURE: deterministic rule-based triage used when the LLM is unavailable.
import { alertName, alertSummary } from "./alerts";
import type { AMAlert, Severity, Triage } from "./types";

const LABEL_MAP: Record<string, Severity> = {
  critical: "critical", page: "critical", p1: "critical", sev1: "critical", emergency: "critical",
  high: "high", error: "high", major: "high", p2: "high", sev2: "high",
  warning: "medium", warn: "medium", p3: "medium", sev3: "medium",
  low: "low", minor: "low", p4: "low",
  info: "info", none: "info", p5: "info",
};

const RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const BY_RANK: Severity[] = ["info", "low", "medium", "high", "critical"];

const OUTAGE_RE = /down|outage/i;
const HIGH_RE = /down|outage|unavailable|unreachable|5\d\d|error.?rate|crashloop|oom/i;
const MEDIUM_RE = /latency|slow|saturation|disk|queue|backlog/i;
const INFO_RE = /watchdog|heartbeat|test|info/i;

export const FALLBACK_CONFIDENCE = 0.3;
export const FALLBACK_CAUSE = "Unknown (rule-based fallback)";

export function labelSeverity(alert: AMAlert): Severity | undefined {
  const raw = alert.labels.severity ?? alert.labels.priority;
  if (!raw) return undefined;
  return LABEL_MAP[raw.trim().toLowerCase()];
}

function keywordSeverity(text: string): Severity {
  if (HIGH_RE.test(text)) return "high";
  if (MEDIUM_RE.test(text)) return "medium";
  if (INFO_RE.test(text)) return "info";
  return "medium";
}

function clip(s: string, n = 500): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function fallbackClassify(alert: AMAlert, service: string): Triage {
  const summary = alertSummary(alert);
  const text = `${alertName(alert)} ${summary}`;
  const runbook = alert.annotations?.runbook_url;
  const suggested_action = runbook
    ? `Follow the runbook: ${runbook}`
    : `Check dashboards/recent deploys for ${service}`;

  let severity: Severity;
  if (alert.status === "resolved") {
    severity = "info";
  } else {
    const fromLabel = labelSeverity(alert);
    if (fromLabel) {
      severity = fromLabel;
      if (OUTAGE_RE.test(text) && RANK[fromLabel] >= RANK.high) {
        severity = BY_RANK[Math.min(RANK[fromLabel] + 1, RANK.critical)]!;
      }
    } else {
      severity = keywordSeverity(text);
    }
  }

  return {
    severity,
    user_impact: clip(alert.status === "resolved" ? `Resolved: ${summary}` : summary),
    likely_cause: FALLBACK_CAUSE,
    suggested_action: clip(suggested_action),
    confidence: FALLBACK_CONFIDENCE,
  };
}
