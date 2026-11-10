import { handleSeed } from "./handlers/admin";
import { handleChat } from "./handlers/chat";
import { handleServices, handleTimeline } from "./handlers/services";
import { handleWebhook } from "./handlers/webhook";
import { errorResponse, methodNotAllowed } from "./http";
import { matchRoute } from "./router";

export { RegistryDO } from "./do/registry-do";
export { ServiceDO } from "./do/service-do";

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const route = matchRoute(req.method, url.pathname);
    if (route === null) {
      // Unknown API-ish paths get a JSON 404; everything else is a static asset.
      if (/^\/(api|webhook|admin)(\/|$)/.test(url.pathname)) return errorResponse(404, "not found");
      return env.ASSETS.fetch(req);
    }
    try {
      switch (route.name) {
        case "method_not_allowed":
          return methodNotAllowed(route.allow);
        case "webhook":
          return await handleWebhook(req, env, ctx);
        case "chat":
          return await handleChat(req, env);
        case "services":
          return await handleServices(env);
        case "timeline":
          return await handleTimeline(req, env, route.service);
        case "seed":
          return await handleSeed(req, env);
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "unhandled", route: route.name, reason: String(err) }));
      return errorResponse(500, "internal error");
    }
  },
} satisfies ExportedHandler<Env>;
