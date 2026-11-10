import { checkBearer, errorResponse, json, unauthorized } from "../http";
import { seedMemory } from "../memory";
import { SEED_DOCS } from "../seed-data";
import type { AppEnv } from "../types";

export async function handleSeed(req: Request, env: AppEnv): Promise<Response> {
  if (!env.ADMIN_TOKEN) return errorResponse(503, "admin disabled: ADMIN_TOKEN is not set");
  if (!checkBearer(req.headers.get("authorization"), env.ADMIN_TOKEN)) return unauthorized();
  const seeded = await seedMemory(env);
  if (seeded === 0) return errorResponse(502, "seeding failed (check Vectorize index and AI binding)");
  return json({ seeded, total: SEED_DOCS.length });
}
