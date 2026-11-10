// PURE: prompt/message builders and the JSON schema for structured triage output.
import { alertName } from "./alerts";
import { labelSeverity } from "./fallback";
import type { AMAlert, ChatContext, ChatMessage, MemoryHit } from "./types";

export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
    user_impact: { type: "string" },
    likely_cause: { type: "string" },
    suggested_action: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["severity", "user_impact", "likely_cause", "suggested_action", "confidence"],
} as const;

export const CLASSIFY_SYSTEM =
  "You are an SRE triage assistant. Classify ONE production alert. Reply ONLY with JSON matching the schema. " +
  "Severity: critical = customer-facing outage or data loss now; high = major degradation or imminent outage; " +
  "medium = partial/limited impact, act within hours; low = no current user impact; info = informational/test/resolved. " +
  "confidence 0-1. Use related history/runbooks only if relevant. Never invent facts not in the alert or context. " +
  "Keep each text field < 240 chars; suggested_action must be a concrete first step.";

export function chatSystem(nowIso: string): string {
  return (
    `You are an on-call copilot. Current time: ${nowIso} UTC. Answer ONLY from the CONTEXT (service timelines and runbooks). ` +
    "If the context doesn't contain the answer, say so. Be concise: 1-2 line status, then bullets. " +
    "Cite alert names and UTC times; recommend next steps from runbooks when applicable."
  );
}

// Labels that vary per replica or per firing; they add noise and break gateway caching.
const EXCLUDED_LABELS = new Set(["instance", "pod", "pod_name", "pod_ip", "container_id", "endpoint", "uid"]);
const TIMESTAMP_LABEL_RE = /time|timestamp|_at$|date/i;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function promptLabels(labels: Record<string, string>): string {
  return Object.keys(labels)
    .filter((k) => !EXCLUDED_LABELS.has(k) && !TIMESTAMP_LABEL_RE.test(k))
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(", ");
}

export function formatHits(hits: MemoryHit[]): string {
  if (hits.length === 0) return "(none)";
  return hits
    .map((h, i) => `${i + 1}. [${h.kind}] ${h.title} (similarity ${h.score.toFixed(2)}): ${clip(h.text, 400)}`)
    .join("\n");
}

export function buildClassifyMessages(alert: AMAlert, service: string, hits: MemoryHit[]): ChatMessage[] {
  const user = [
    `Service: ${service}`,
    `Alert: ${alertName(alert)} (status: ${alert.status}, label severity: ${alert.labels.severity ?? labelSeverity(alert) ?? "none"})`,
    `Labels: ${promptLabels(alert.labels) || "(none)"}`,
    `Summary: ${alert.annotations?.summary ?? "(none)"}`,
    `Description: ${alert.annotations?.description ?? "(none)"}`,
    "",
    "Related history / runbooks (may be irrelevant):",
    formatHits(hits),
  ].join("\n");
  return [
    { role: "system", content: CLASSIFY_SYSTEM },
    { role: "user", content: user },
  ];
}

export function formatTimelineLine(e: ChatContext["entries"][number]): string {
  return `- ${new Date(e.ts).toISOString()} ${e.status} ${e.alertname} [${e.severity}/${e.source}] ${e.summary} | action: ${e.suggested_action}`;
}

export function buildChatContext(contexts: ChatContext[], hits: MemoryHit[]): string {
  const lines: string[] = ["CONTEXT"];
  const withEntries = contexts.filter((c) => c.entries.length > 0);
  if (withEntries.length === 0) {
    lines.push("(no recent alerts recorded)");
  } else {
    for (const c of withEntries) {
      lines.push(`## Service ${c.service}`);
      for (const e of c.entries) lines.push(formatTimelineLine(e));
    }
  }
  if (hits.length > 0) {
    lines.push("## Runbooks/past incidents");
    for (const h of hits) lines.push(`- ${h.title}: ${clip(h.text, 400)}`);
  }
  return lines.join("\n");
}

export function buildChatMessages(
  question: string,
  contexts: ChatContext[],
  hits: MemoryHit[],
  nowIso: string,
): ChatMessage[] {
  return [
    { role: "system", content: chatSystem(nowIso) },
    { role: "user", content: `${buildChatContext(contexts, hits)}\n\nQUESTION: ${question}` },
  ];
}

/** Templated answer used when the chat model is unavailable. */
export function buildFallbackDigest(contexts: ChatContext[], hits: MemoryHit[], perService = 5): string {
  const withEntries = contexts.filter((c) => c.entries.length > 0);
  const lines: string[] = ["The AI model is unavailable right now, so here is the raw recent activity."];
  if (withEntries.length === 0) {
    lines.push("", "No recent alerts recorded for the services you asked about.");
  }
  for (const c of withEntries) {
    lines.push("", `${c.service}:`);
    for (const e of c.entries.slice(0, perService)) lines.push(formatTimelineLine(e));
  }
  if (hits.length > 0) {
    lines.push("", "Possibly relevant runbooks:");
    for (const h of hits) lines.push(`- ${h.title}`);
  }
  return lines.join("\n");
}
