// PURE: figure out which services a chat message is asking about.

const GENERIC = new Set(["api", "svc", "service", "prod"]);
export const MAX_TARGETS = 3;

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9_.-]+/).flatMap((t) => {
    const trimmed = t.replace(/^[._-]+|[._-]+$/g, "");
    return trimmed ? [trimmed] : [];
  });
}

/**
 * Returns up to 3 known service names mentioned in `message`. Exact name matches
 * win over primary-segment matches ("checkout" -> "checkout-api"). If nothing
 * matches, falls back to the most recently active services.
 */
export function detectServices(message: string, known: string[], recent: string[]): string[] {
  const lower = message.toLowerCase();
  const tokens = new Set(tokenize(message));
  const exact: string[] = [];
  const segment: string[] = [];

  for (const name of known) {
    const n = name.toLowerCase();
    if (tokens.has(n) || (n.length >= 3 && containsWord(lower, n))) {
      exact.push(name);
      continue;
    }
    const primary = n.split(/[-_.]/)[0] ?? "";
    if (primary.length >= 3 && !GENERIC.has(primary) && tokens.has(primary)) {
      segment.push(name);
    }
  }

  const out = [...new Set([...exact, ...segment])].slice(0, MAX_TARGETS);
  return out.length > 0 ? out : recent.slice(0, MAX_TARGETS);
}

function containsWord(haystack: string, needle: string): boolean {
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : haystack[i - 1]!;
    const after = haystack[i + needle.length] ?? "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = i + 1;
  }
}
