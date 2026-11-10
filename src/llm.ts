// Workers AI calls (through AI Gateway) with timeout, retry and fallback.
import { fallbackClassify } from "./fallback";
import { extractJson, validateTriage } from "./llm-parse";
import { buildChatMessages, buildClassifyMessages, buildFallbackDigest, TRIAGE_JSON_SCHEMA } from "./prompts";
import { withRetry, withTimeout } from "./resilience";
import type { AMAlert, ChatContext, MemoryHit, TriageResult } from "./types";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function timeoutMs(env: Env): number {
  const n = Number.parseInt(env.LLM_TIMEOUT_MS, 10);
  return Number.isFinite(n) && n > 0 ? n : 12000;
}

/** Workers AI may return a string, or an object whose `response` is a string or already-parsed JSON. */
function rawResponse(res: unknown): unknown {
  if (typeof res === "string") return res;
  if (res && typeof res === "object" && "response" in res) return (res as { response: unknown }).response;
  return null;
}

function reason(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export async function classifyAlert(env: Env, alert: AMAlert, service: string, hits: MemoryHit[]): Promise<TriageResult> {
  const messages = buildClassifyMessages(alert, service, hits);
  const ms = timeoutMs(env);
  try {
    const triage = await withRetry(async (attempt) => {
      const res = await withTimeout(
        env.AI.run(
          MODEL,
          {
            messages,
            response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA },
            temperature: 0.1,
            max_tokens: 400,
          },
          // Identical prompts (same alert text + same retrieved context) are served from the gateway cache.
          { gateway: { id: env.AI_GATEWAY_ID, cacheTtl: 3600 } },
        ),
        ms,
        `classify attempt ${attempt + 1}`,
      );
      const parsed = validateTriage(extractJson(rawResponse(res)));
      if (!parsed) throw new Error("model returned invalid triage JSON");
      return parsed;
    });
    return { ...triage, source: "llm" };
  } catch (err) {
    console.warn(JSON.stringify({ event: "classify_fallback", service, reason: reason(err) }));
    return { ...fallbackClassify(alert, service), source: "fallback" };
  }
}

export interface ChatAnswer {
  answer: string;
  source: "llm" | "fallback";
}

export async function answerChat(
  env: Env,
  question: string,
  contexts: ChatContext[],
  hits: MemoryHit[],
  now = new Date(),
): Promise<ChatAnswer> {
  const messages = buildChatMessages(question, contexts, hits, now.toISOString());
  const ms = timeoutMs(env);
  try {
    const answer = await withRetry(async (attempt) => {
      const res = await withTimeout(
        env.AI.run(
          MODEL,
          { messages, temperature: 0.3, max_tokens: 600 },
          // Chat context changes constantly; never serve a cached answer.
          { gateway: { id: env.AI_GATEWAY_ID, skipCache: true } },
        ),
        ms,
        `chat attempt ${attempt + 1}`,
      );
      const raw = rawResponse(res);
      const text = typeof raw === "string" ? raw.trim() : raw ? JSON.stringify(raw) : "";
      if (!text) throw new Error("model returned an empty answer");
      return text;
    });
    return { answer, source: "llm" };
  } catch (err) {
    console.warn(JSON.stringify({ event: "chat_fallback", reason: reason(err) }));
    return { answer: buildFallbackDigest(contexts, hits), source: "fallback" };
  }
}
