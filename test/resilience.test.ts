import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, mapLimit, TimeoutError, withRetry, withTimeout } from "../src/resilience";

const noSleep = () => Promise.resolve();

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
  });

  it("rejects with TimeoutError when too slow", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 50, "slow op");
    const assertion = expect(p).rejects.toThrow(/slow op timed out after 50ms/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propagates the original rejection", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });

  it("clears its timer", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("withRetry", () => {
  it("succeeds on the third attempt", async () => {
    const attempts: number[] = [];
    const r = await withRetry(
      async (n) => {
        attempts.push(n);
        if (n < 2) throw new Error(`fail ${n}`);
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(attempts).toEqual([0, 1, 2]);
  });

  it("throws the last error after 2 retries", async () => {
    const fn = vi.fn(async (n: number) => {
      throw new Error(`fail ${n}`);
    });
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow("fail 2");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("sleeps with exponential backoff", async () => {
    const sleeps: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new Error("x");
        },
        { retries: 3, baseMs: 100, random: () => 0, sleep: async (ms) => void sleeps.push(ms) },
      ),
    ).rejects.toThrow();
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it("adds bounded jitter", () => {
    expect(backoffDelay(0, 300, () => 0)).toBe(300);
    expect(backoffDelay(1, 300, () => 0.999)).toBeLessThanOrEqual(600 + 150);
    expect(backoffDelay(2, 300, () => 1)).toBe(1200 + 150);
  });

  it("stops early when shouldRetry says no", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(withRetry(fn, { sleep: noSleep, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries=0 means a single attempt", async () => {
    const fn = vi.fn(async () => {
      throw new Error("once");
    });
    await expect(withRetry(fn, { retries: 0, sleep: noSleep })).rejects.toThrow("once");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("mapLimit", () => {
  it("preserves order and bounds concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (x) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, x));
      inFlight--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBeLessThanOrEqual(2);
  });
  it("handles empty input", async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });
});
