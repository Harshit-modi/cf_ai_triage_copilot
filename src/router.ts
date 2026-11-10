// PURE: maps (method, pathname) to a route. No Workers imports.

export type Route =
  | { name: "webhook" }
  | { name: "chat" }
  | { name: "services" }
  | { name: "timeline"; service: string }
  | { name: "seed" };

export type RouteMatch = Route | { name: "method_not_allowed"; allow: string } | null;

export const SERVICE_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

const STATIC: Record<string, { method: string; route: Route }> = {
  "/webhook/alertmanager": { method: "POST", route: { name: "webhook" } },
  "/api/chat": { method: "POST", route: { name: "chat" } },
  "/api/services": { method: "GET", route: { name: "services" } },
  "/admin/seed": { method: "POST", route: { name: "seed" } },
};

const TIMELINE_RE = /^\/api\/services\/([^/]+)\/timeline$/;

export function matchRoute(method: string, pathname: string): RouteMatch {
  const m = method.toUpperCase();
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  const fixed = STATIC[path];
  if (fixed) {
    return m === fixed.method ? fixed.route : { name: "method_not_allowed", allow: fixed.method };
  }

  const tm = TIMELINE_RE.exec(path);
  if (tm) {
    let service: string;
    try {
      service = decodeURIComponent(tm[1]!);
    } catch {
      return null;
    }
    if (!SERVICE_NAME_RE.test(service)) return null;
    return m === "GET" ? { name: "timeline", service } : { name: "method_not_allowed", allow: "GET" };
  }

  return null;
}
