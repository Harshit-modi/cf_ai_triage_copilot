import { DurableObject } from "cloudflare:workers";
import type { NewTimelineEntry, ReserveResult, Severity, TimelineEntry, TriageResult, TriageSource } from "../types";

export const TIMELINE_MAX_ROWS = 200;

type TimelineRow = {
  id: number;
  ts: number;
  fingerprint: string;
  alertname: string;
  status: string;
  severity: string;
  source: string;
  summary: string;
  user_impact: string;
  likely_cause: string;
  suggested_action: string;
  confidence: number;
  starts_at: string | null;
  ends_at: string | null;
  labels: string;
  related: string;
};

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToEntry(r: TimelineRow): TimelineEntry {
  return {
    id: r.id,
    ts: r.ts,
    fingerprint: r.fingerprint,
    alertname: r.alertname,
    status: r.status === "resolved" ? "resolved" : "firing",
    severity: r.severity as Severity,
    source: r.source as TriageSource,
    summary: r.summary,
    user_impact: r.user_impact,
    likely_cause: r.likely_cause,
    suggested_action: r.suggested_action,
    confidence: r.confidence,
    startsAt: r.starts_at ?? undefined,
    endsAt: r.ends_at ?? undefined,
    labels: parseJson<Record<string, string>>(r.labels, {}),
    related: parseJson<string[]>(r.related, []),
  };
}

/**
 * One instance per service (keyed by name). Owns dedupe state and the rolling
 * incident timeline. All RPC methods run synchronous SQL with no awaits, so each
 * call is atomic with respect to other requests hitting the same object.
 */
export class ServiceDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        alertname TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT NOT NULL,
        user_impact TEXT NOT NULL,
        likely_cause TEXT NOT NULL,
        suggested_action TEXT NOT NULL,
        confidence REAL NOT NULL,
        starts_at TEXT,
        ends_at TEXT,
        labels TEXT NOT NULL,
        related TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS timeline_fp_id ON timeline (fingerprint, id);
      CREATE TABLE IF NOT EXISTS dedupe (
        key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  /**
   * Atomically claims `key` (fingerprint:status). A repeat within the window is a
   * duplicate. A new claim clears the opposite status for the same fingerprint so
   * firing -> resolved -> firing is processed each time.
   */
  reserve(key: string, fingerprint: string, now: number, windowMs: number): ReserveResult {
    this.sql.exec("DELETE FROM dedupe WHERE last_seen < ?", now - windowMs);

    const existing = this.sql
      .exec<{ hits: number }>("UPDATE dedupe SET hits = hits + 1, last_seen = ? WHERE key = ? RETURNING hits", now, key)
      .toArray();
    if (existing.length > 0) return { outcome: "duplicate", hits: existing[0]!.hits };

    this.sql.exec("DELETE FROM dedupe WHERE fingerprint = ? AND key != ?", fingerprint, key);
    this.sql.exec(
      "INSERT INTO dedupe (key, fingerprint, first_seen, last_seen, hits) VALUES (?, ?, ?, ?, 1)",
      key,
      fingerprint,
      now,
      now,
    );

    const prev = this.sql
      .exec<Pick<TimelineRow, "severity" | "source" | "user_impact" | "likely_cause" | "suggested_action" | "confidence">>(
        `SELECT severity, source, user_impact, likely_cause, suggested_action, confidence
         FROM timeline WHERE fingerprint = ? ORDER BY id DESC LIMIT 1`,
        fingerprint,
      )
      .toArray()[0];
    if (!prev) return { outcome: "new" };
    const previous: TriageResult = {
      severity: prev.severity as Severity,
      source: prev.source as TriageSource,
      user_impact: prev.user_impact,
      likely_cause: prev.likely_cause,
      suggested_action: prev.suggested_action,
      confidence: prev.confidence,
    };
    return { outcome: "new", previous };
  }

  record(e: NewTimelineEntry): number {
    const row = this.sql
      .exec<{ id: number }>(
        `INSERT INTO timeline (ts, fingerprint, alertname, status, severity, source, summary, user_impact,
           likely_cause, suggested_action, confidence, starts_at, ends_at, labels, related)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        e.ts,
        e.fingerprint,
        e.alertname,
        e.status,
        e.severity,
        e.source,
        e.summary,
        e.user_impact,
        e.likely_cause,
        e.suggested_action,
        e.confidence,
        e.startsAt ?? null,
        e.endsAt ?? null,
        JSON.stringify(e.labels),
        JSON.stringify(e.related),
      )
      .one();
    this.sql.exec(
      "DELETE FROM timeline WHERE id NOT IN (SELECT id FROM timeline ORDER BY id DESC LIMIT ?)",
      TIMELINE_MAX_ROWS,
    );
    return row.id;
  }

  timeline(limit = 50): TimelineEntry[] {
    const n = Math.min(Math.max(Math.trunc(limit) || 50, 1), TIMELINE_MAX_ROWS);
    return this.sql
      .exec<TimelineRow>("SELECT * FROM timeline ORDER BY id DESC LIMIT ?", n)
      .toArray()
      .map(rowToEntry);
  }
}
