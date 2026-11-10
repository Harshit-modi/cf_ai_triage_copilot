import { DurableObject } from "cloudflare:workers";
import type { ServiceSummary, Severity } from "../types";

export const REGISTRY_NAME = "global";

/**
 * Singleton (addressed by name "global") listing every service that has
 * received an alert. Replaces a KV namespace so there is nothing extra to provision.
 */
export class RegistryDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS services (
        name TEXT PRIMARY KEY,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        last_severity TEXT NOT NULL,
        alert_count INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  touch(name: string, severity: Severity, now: number): void {
    this.sql.exec(
      `INSERT INTO services (name, first_seen, last_seen, last_severity, alert_count) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(name) DO UPDATE SET
         last_seen = excluded.last_seen,
         last_severity = excluded.last_severity,
         alert_count = alert_count + 1`,
      name,
      now,
      now,
      severity,
    );
  }

  list(): ServiceSummary[] {
    return this.sql
      .exec<{ name: string; first_seen: number; last_seen: number; last_severity: string; alert_count: number }>(
        "SELECT name, first_seen, last_seen, last_severity, alert_count FROM services ORDER BY last_seen DESC",
      )
      .toArray()
      .map((r) => ({ ...r, last_severity: r.last_severity as Severity }));
  }

  has(name: string): boolean {
    return this.sql.exec("SELECT 1 FROM services WHERE name = ?", name).toArray().length > 0;
  }
}
