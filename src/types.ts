// Shared data shapes. Type-only: safe to import from pure modules and tests.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export interface AMAlert {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  fingerprint?: string;
  generatorURL?: string;
}

export interface AMPayload {
  version?: string;
  receiver?: string;
  status?: string;
  alerts: AMAlert[];
  groupLabels?: Record<string, string>;
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  externalURL?: string;
}

export interface Triage {
  severity: Severity;
  user_impact: string;
  likely_cause: string;
  suggested_action: string;
  confidence: number;
}

export type TriageSource = "llm" | "fallback" | "inherited";

export interface TriageResult extends Triage {
  source: TriageSource;
}

export interface MemoryHit {
  id: string;
  score: number;
  kind: "runbook" | "incident";
  service?: string;
  title: string;
  text: string;
}

export interface TimelineEntry {
  id: number;
  ts: number;
  fingerprint: string;
  alertname: string;
  status: "firing" | "resolved";
  severity: Severity;
  source: TriageSource;
  summary: string;
  user_impact: string;
  likely_cause: string;
  suggested_action: string;
  confidence: number;
  startsAt?: string;
  endsAt?: string;
  labels: Record<string, string>;
  related: string[];
}

/** Timeline entry before the DO assigns an id. */
export type NewTimelineEntry = Omit<TimelineEntry, "id">;

export type ReserveResult =
  | { outcome: "new"; previous?: TriageResult }
  | { outcome: "duplicate"; hits: number };

export interface ServiceSummary {
  name: string;
  first_seen: number;
  last_seen: number;
  last_severity: Severity;
  alert_count: number;
}

export interface ChatContext {
  service: string;
  entries: TimelineEntry[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Secrets are not visible to `wrangler types` unless a .dev.vars file exists when it runs.
// Use an intersection (not a global augmentation) so this compiles either way.
export interface Secrets {
  WEBHOOK_TOKEN?: string;
  ADMIN_TOKEN?: string;
}

export type AppEnv = Env & Secrets;
