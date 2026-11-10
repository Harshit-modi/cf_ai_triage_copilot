import { alertName, alertSummary, alertText, dedupeKey, extractService, fingerprintOf, parsePayload } from "../alerts";
import { REGISTRY_NAME } from "../do/registry-do";
import { fallbackClassify } from "../fallback";
import { badRequest, checkBearer, errorResponse, json, rateLimitKey, tooManyRequests, unauthorized } from "../http";
import { classifyAlert } from "../llm";
import { embed, querySimilar, upsertIncident } from "../memory";
import { mapLimit } from "../resilience";
import type { AMAlert, AppEnv, Severity, TriageResult, TriageSource } from "../types";

const CONCURRENCY = 4;
const MAX_BODY_BYTES = 1_000_000;

export interface AlertResult {
  service: string;
  fingerprint: string;
  status: AMAlert["status"];
  outcome: "classified" | "duplicate" | "resolved" | "error";
  severity?: Severity;
  source?: TriageSource;
  user_impact?: string;
  suggested_action?: string;
  hits?: number;
  error?: string;
}

function intVar(v: string, dflt: number): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** Alertmanager sends endsAt=0001-01-01T00:00:00Z for firing alerts. */
function realTime(t: string | undefined): string | undefined {
  return t && !t.startsWith("0001-") ? t : undefined;
}

export async function handleWebhook(req: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  if (!checkBearer(req.headers.get("authorization"), env.WEBHOOK_TOKEN)) return unauthorized();

  try {
    const { success } = await env.WEBHOOK_LIMITER.limit({ key: await rateLimitKey(req) });
    if (!success) return tooManyRequests(60);
  } catch (err) {
    // Fail open: losing rate limiting briefly is better than dropping alerts.
    console.warn(JSON.stringify({ event: "rate_limiter_error", reason: String(err) }));
  }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return errorResponse(413, "payload too large");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = parsePayload(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const { payload } = parsed;
  const windowMs = intVar(env.DEDUPE_WINDOW_SECONDS, 3600) * 1000;
  const llmBudget = intVar(env.MAX_LLM_PER_REQUEST, 10);
  let llmUsed = 0;
  const registry = env.REGISTRY_DO.getByName(REGISTRY_NAME);

  const results = await mapLimit(payload.alerts, CONCURRENCY, async (alert): Promise<AlertResult> => {
    const service = extractService(alert, payload.commonLabels);
    const fingerprint = fingerprintOf(alert);
    const base = { service, fingerprint, status: alert.status };
    try {
      const stub = env.SERVICE_DO.getByName(service);
      const now = Date.now();
      const reservation = await stub.reserve(dedupeKey(fingerprint, alert.status), fingerprint, now, windowMs);
      if (reservation.outcome === "duplicate") {
        return { ...base, outcome: "duplicate", hits: reservation.hits };
      }

      let triage: TriageResult;
      let related: string[] = [];
      if (alert.status === "resolved") {
        const prev = reservation.previous;
        triage = prev
          ? {
              ...prev,
              severity: "info",
              source: "inherited",
              user_impact: prev.user_impact.startsWith("Resolved") ? prev.user_impact : `Resolved: ${prev.user_impact}`,
            }
          : { ...fallbackClassify(alert, service), source: "fallback" };
      } else {
        const text = alertText(alert, service);
        const vector = await embed(env, text);
        const hits = vector.length > 0 ? await querySimilar(env, vector, 3) : [];
        related = hits.map((h) => h.id);
        if (llmUsed < llmBudget) {
          llmUsed++;
          triage = await classifyAlert(env, alert, service, hits);
        } else {
          triage = { ...fallbackClassify(alert, service), source: "fallback" };
        }
        const memo = [
          text,
          `severity: ${triage.severity}`,
          `likely cause: ${triage.likely_cause}`,
          `action: ${triage.suggested_action}`,
        ].join("\n");
        ctx.waitUntil(upsertIncident(env, fingerprint, service, `${alertName(alert)} on ${service}`, memo, vector));
      }

      await stub.record({
        ts: now,
        fingerprint,
        alertname: alertName(alert),
        status: alert.status,
        severity: triage.severity,
        source: triage.source,
        summary: alertSummary(alert),
        user_impact: triage.user_impact,
        likely_cause: triage.likely_cause,
        suggested_action: triage.suggested_action,
        confidence: triage.confidence,
        startsAt: realTime(alert.startsAt),
        endsAt: realTime(alert.endsAt),
        labels: alert.labels,
        related,
      });
      await registry.touch(service, triage.severity, now);

      return {
        ...base,
        outcome: alert.status === "resolved" ? "resolved" : "classified",
        severity: triage.severity,
        source: triage.source,
        user_impact: triage.user_impact,
        suggested_action: triage.suggested_action,
      };
    } catch (err) {
      console.error(JSON.stringify({ event: "alert_failed", service, fingerprint, reason: String(err) }));
      return { ...base, outcome: "error", error: "internal error processing alert" };
    }
  });

  // Any failure -> 500 so Alertmanager retries; alerts that did succeed come back as duplicates.
  const failed = results.some((r) => r.outcome === "error");
  return json({ received: payload.alerts.length, dropped: parsed.dropped, results }, failed ? 500 : 200);
}
