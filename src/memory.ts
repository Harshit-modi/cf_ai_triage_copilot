// Vectorize-backed memory of runbooks and past incidents. Every function degrades
// to an empty result on failure so retrieval can never break triage.
import { SEED_DOCS } from "./seed-data";
import type { MemoryHit } from "./types";

export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_META_TEXT = 1000;

function warn(event: string, err: unknown): void {
  console.warn(JSON.stringify({ event, reason: err instanceof Error ? err.message : String(err) }));
}

async function embedMany(env: Env, texts: string[]): Promise<number[][]> {
  const res = await env.AI.run(EMBED_MODEL, { text: texts });
  if (!res || typeof res !== "object" || !("data" in res) || !Array.isArray(res.data)) {
    throw new Error("embedding response missing data");
  }
  return res.data;
}

/** Returns a 768-dim vector, or [] if embedding failed. */
export async function embed(env: Env, text: string): Promise<number[]> {
  try {
    const [vec] = await embedMany(env, [text]);
    return vec ?? [];
  } catch (err) {
    warn("embed_failed", err);
    return [];
  }
}

export async function querySimilar(env: Env, vector: number[], topK = 3): Promise<MemoryHit[]> {
  if (vector.length === 0) return [];
  try {
    const res = await env.MEMORY.query(vector, { topK, returnMetadata: "all" });
    return res.matches.map((m) => {
      const md = (m.metadata ?? {}) as Record<string, unknown>;
      return {
        id: m.id,
        score: m.score,
        kind: md.kind === "incident" ? "incident" : "runbook",
        service: typeof md.service === "string" ? md.service : undefined,
        title: typeof md.title === "string" ? md.title : m.id,
        text: typeof md.text === "string" ? md.text : "",
      } satisfies MemoryHit;
    });
  } catch (err) {
    warn("vectorize_query_failed", err);
    return [];
  }
}

/** Stores a classified alert as a past incident, reusing the vector already computed. */
export async function upsertIncident(
  env: Env,
  fingerprint: string,
  service: string,
  title: string,
  text: string,
  vector: number[],
): Promise<number> {
  if (vector.length === 0) return 0;
  try {
    await env.MEMORY.upsert([
      {
        id: `inc:${fingerprint}`,
        values: vector,
        metadata: { kind: "incident", service, title, text: text.slice(0, MAX_META_TEXT) },
      },
    ]);
    return 1;
  } catch (err) {
    warn("vectorize_upsert_failed", err);
    return 0;
  }
}

/** Embeds and upserts the bundled runbooks/past incidents. Idempotent (stable ids). */
export async function seedMemory(env: Env): Promise<number> {
  try {
    const vectors = await embedMany(
      env,
      SEED_DOCS.map((d) => `${d.title}\n${d.text}`),
    );
    if (vectors.length !== SEED_DOCS.length) throw new Error("embedding count mismatch");
    await env.MEMORY.upsert(
      SEED_DOCS.map((d, i) => ({
        id: `rb:${d.slug}`,
        values: vectors[i]!,
        metadata: { kind: d.kind, service: d.service, title: d.title, text: d.text.slice(0, MAX_META_TEXT) },
      })),
    );
    return SEED_DOCS.length;
  } catch (err) {
    warn("seed_failed", err);
    return 0;
  }
}
