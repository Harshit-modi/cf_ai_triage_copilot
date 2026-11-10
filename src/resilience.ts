// PURE: timeout and retry helpers. `sleep` and `random` are injectable for tests.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Rejects if `p` does not settle within `ms`. Note: Promise.race does not cancel
 * the underlying work; the losing promise keeps running until it settles.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay before retry n (0-based): baseMs * 2^n plus up to baseMs/2 of jitter. */
export function backoffDelay(n: number, baseMs: number, random: () => number = Math.random): number {
  return Math.round(baseMs * 2 ** n + random() * (baseMs / 2));
}

/** Calls fn(attempt) up to retries+1 times, sleeping with exponential backoff between attempts. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseMs = 300, sleep = defaultSleep, random = Math.random, shouldRetry } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      if (shouldRetry && !shouldRetry(err, attempt)) break;
      await sleep(backoffDelay(attempt, baseMs, random));
    }
  }
  throw lastErr;
}

/** Maps items with at most `limit` promises in flight; preserves input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
