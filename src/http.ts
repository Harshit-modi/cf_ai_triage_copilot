// PURE: small HTTP helpers. Uses only web-standard APIs (Response, TextEncoder, crypto.subtle).

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(status: number, error: string, headers: Record<string, string> = {}): Response {
  return json({ error }, status, headers);
}

export const badRequest = (msg: string) => errorResponse(400, msg);
export const unauthorized = () => errorResponse(401, "unauthorized", { "www-authenticate": "Bearer" });
export const notFound = (msg = "not found") => errorResponse(404, msg);
export const methodNotAllowed = (allow: string) => errorResponse(405, "method not allowed", { allow });
export const tooManyRequests = (retryAfterSeconds = 60) =>
  errorResponse(429, "rate limited", { "retry-after": String(retryAfterSeconds) });

/** Constant-time string comparison (time depends only on the longer length). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Returns true when the Authorization header carries the expected bearer secret.
 * Fails closed: if no secret is configured (undefined or empty) this returns false.
 */
export function checkBearer(header: string | null | undefined, secret?: string): boolean {
  if (!secret) return false;
  const token = bearerToken(header);
  if (token === null) return false;
  return timingSafeEqual(token, secret);
}

export type WebhookAuthResult = "ok" | "unauthorized" | "not_configured";

/**
 * Webhook auth decision. With a token set, the bearer must match (constant time).
 * With no token (undefined or empty), requests are allowed only when ENVIRONMENT is
 * exactly "development"; anything else (including unset) is treated as production
 * and reported as "not_configured" so the handler can fail closed with a 503.
 */
export function webhookAuth(
  header: string | null | undefined,
  token: string | undefined,
  environment: string | undefined,
): WebhookAuthResult {
  if (token) return checkBearer(header, token) ? "ok" : "unauthorized";
  return environment?.trim() === "development" ? "ok" : "not_configured";
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Rate-limit key: hashed bearer token if present (per-sender), else client IP. */
export async function rateLimitKey(req: Request): Promise<string> {
  const token = bearerToken(req.headers.get("authorization"));
  if (token) return "tok:" + (await sha256Hex(token)).slice(0, 16);
  return "ip:" + (req.headers.get("cf-connecting-ip") ?? "unknown");
}

export function ipKey(req: Request): string {
  return "ip:" + (req.headers.get("cf-connecting-ip") ?? "unknown");
}
