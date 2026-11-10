// PURE: Alertmanager payload parsing and alert helpers.
import type { AMAlert, AMPayload } from "./types";

export const MAX_ALERTS = 100;

export type ParseResult = { ok: true; payload: AMPayload; dropped: number } | { ok: false; error: string };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function stringMap(x: unknown): Record<string, string> | undefined {
  if (!isObject(x)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

function optString(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

/** Validates an Alertmanager webhook body. Keeps at most MAX_ALERTS alerts. */
export function parsePayload(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, error: "body must be a JSON object" };
  if (!Array.isArray(body.alerts)) return { ok: false, error: "missing alerts array" };
  if (body.alerts.length === 0) return { ok: false, error: "alerts array is empty" };

  const raw = body.alerts.slice(0, MAX_ALERTS);
  const alerts: AMAlert[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (!isObject(a)) return { ok: false, error: `alerts[${i}] must be an object` };
    if (a.status !== "firing" && a.status !== "resolved") {
      return { ok: false, error: `alerts[${i}].status must be "firing" or "resolved"` };
    }
    const labels = stringMap(a.labels);
    if (!labels) return { ok: false, error: `alerts[${i}].labels must be an object` };
    alerts.push({
      status: a.status,
      labels,
      annotations: stringMap(a.annotations),
      startsAt: optString(a.startsAt),
      endsAt: optString(a.endsAt),
      fingerprint: optString(a.fingerprint),
      generatorURL: optString(a.generatorURL),
    });
  }

  const payload: AMPayload = {
    version: optString(body.version),
    receiver: optString(body.receiver),
    status: optString(body.status),
    alerts,
    groupLabels: stringMap(body.groupLabels),
    commonLabels: stringMap(body.commonLabels),
    commonAnnotations: stringMap(body.commonAnnotations),
    externalURL: optString(body.externalURL),
  };
  return { ok: true, payload, dropped: body.alerts.length - alerts.length };
}

export function sanitizeServiceName(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 64);
  // Route validation requires an alphanumeric first character.
  const fixed = /^[a-z0-9]/.test(s) ? s : ("x" + s).slice(0, 64);
  return fixed.length > 0 ? fixed : "unknown";
}

/** Picks the owning service from the most specific label available. */
export function extractService(alert: AMAlert, commonLabels?: Record<string, string>): string {
  const l = alert.labels;
  const candidate =
    l.service ??
    l.app ??
    l["app.kubernetes.io/name"] ??
    l.job ??
    commonLabels?.service ??
    l.namespace ??
    "unknown";
  return candidate.trim() === "" ? "unknown" : sanitizeServiceName(candidate);
}

/** 32-bit FNV-1a, hex encoded. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Alertmanager's fingerprint if present, else a stable hash of the sorted label set. */
export function fingerprintOf(alert: AMAlert): string {
  if (alert.fingerprint) return alert.fingerprint;
  const canonical = Object.keys(alert.labels)
    .sort()
    .map((k) => `${k}=${alert.labels[k]}`)
    .join(",");
  return fnv1a(canonical);
}

export function dedupeKey(fingerprint: string, status: AMAlert["status"]): string {
  return `${fingerprint}:${status}`;
}

export function alertName(alert: AMAlert): string {
  return alert.labels.alertname ?? "UnnamedAlert";
}

export function alertSummary(alert: AMAlert): string {
  return alert.annotations?.summary ?? alert.annotations?.description ?? alertName(alert);
}

/**
 * Text used for embeddings. Deliberately excludes timestamps so the same alert
 * produces the same vector (and the same AI Gateway cache key) each time.
 */
export function alertText(alert: AMAlert, service: string): string {
  const parts = [`alert: ${alertName(alert)}`, `service: ${service}`];
  if (alert.annotations?.summary) parts.push(`summary: ${alert.annotations.summary}`);
  if (alert.annotations?.description) parts.push(`description: ${alert.annotations.description}`);
  return parts.join("\n");
}
