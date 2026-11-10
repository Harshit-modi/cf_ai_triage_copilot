import { detectServices } from "../chat-detect";
import { REGISTRY_NAME } from "../do/registry-do";
import { badRequest, ipKey, json, tooManyRequests } from "../http";
import { answerChat } from "../llm";
import { embed, querySimilar } from "../memory";
import type { ChatContext } from "../types";

const MAX_MESSAGE_CHARS = 1000;
const TIMELINE_ENTRIES = 20;

export async function handleChat(req: Request, env: Env): Promise<Response> {
  try {
    const { success } = await env.CHAT_LIMITER.limit({ key: ipKey(req) });
    if (!success) return tooManyRequests(60);
  } catch (err) {
    console.warn(JSON.stringify({ event: "rate_limiter_error", reason: String(err) }));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const raw = (body as { message?: unknown } | null)?.message;
  if (typeof raw !== "string") return badRequest("message must be a string");
  const message = raw.trim();
  if (message.length < 1 || message.length > MAX_MESSAGE_CHARS) {
    return badRequest(`message must be 1-${MAX_MESSAGE_CHARS} characters`);
  }

  const services = await env.REGISTRY_DO.getByName(REGISTRY_NAME).list();
  const names = services.map((s) => s.name); // already sorted by last_seen DESC
  const targets = detectServices(message, names, names);

  const [contexts, hits] = await Promise.all([
    Promise.all(
      targets.map(
        async (service): Promise<ChatContext> => ({
          service,
          entries: await env.SERVICE_DO.getByName(service).timeline(TIMELINE_ENTRIES),
        }),
      ),
    ),
    embed(env, message).then((v) => querySimilar(env, v, 3)),
  ]);

  const { answer, source } = await answerChat(env, message, contexts, hits);
  return json({
    answer,
    services: targets,
    sources: hits.map((h) => ({ id: h.id, title: h.title, score: h.score })),
    source,
  });
}
