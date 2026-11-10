import { REGISTRY_NAME } from "../do/registry-do";
import { json, notFound } from "../http";

export async function handleServices(env: Env): Promise<Response> {
  const services = await env.REGISTRY_DO.getByName(REGISTRY_NAME).list();
  return json({ services });
}

export async function handleTimeline(req: Request, env: Env, service: string): Promise<Response> {
  // Only address DOs for services we have seen, so random names don't create objects.
  const known = await env.REGISTRY_DO.getByName(REGISTRY_NAME).has(service);
  if (!known) return notFound(`unknown service: ${service}`);
  const limit = Number.parseInt(new URL(req.url).searchParams.get("limit") ?? "50", 10);
  const entries = await env.SERVICE_DO.getByName(service).timeline(Number.isFinite(limit) ? limit : 50);
  return json({ service, entries });
}
