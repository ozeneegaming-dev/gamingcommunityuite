import { getLocale } from "next-intl/server";
import { isSameOrigin } from "@/lib/actions";
import { clientIp, currentActor } from "@/lib/actor";
import { pluginHost, pluginKeyParam, pluginQuery, safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ plugin: string; path?: string[] }> };

const MAX_BODY = 64 * 1024;
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const json = (body: unknown, status: number) => Response.json(body, { status, headers: HEADERS });

/**
 * `/api/plugins/<cheie>/…` (etapa 6): rutele API ale pluginurilor. Doar JSON, corp ≤ 64 KB, CSRF (Origin) la metodele
 * care modifică, limită de rată pe IP și plugin. Pluginul primește vizitatorul ca jeton opac (citește cu drepturile lui).
 */
async function handle(request: Request, ctx: Ctx): Promise<Response> {
  const { plugin, path } = await ctx.params;
  const key = pluginKeyParam(plugin);
  if (!key) return json({ error: "not_found" }, 404);
  const method = request.method.toUpperCase();
  if (method !== "GET" && !isSameOrigin(request.headers)) return json({ error: "csrf" }, 403);

  const { rateLimiter } = services();
  const limit = await rateLimiter.consume(`plugin-api:${key}:${clientIp(request.headers)}`, { window: 60, max: 120 });
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...HEADERS, "Retry-After": String(limit.retryAfter) } });
  if (await safeModeActive()) return json({ error: "safe_mode" }, 503);

  let body: unknown = null;
  if (method !== "GET" && method !== "DELETE") {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413);
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
    }
  }
  const plugins = await pluginHost();
  const [actor, locale] = await Promise.all([currentActor(), getLocale()]);
  const result = await plugins.handleApi(key, {
    method,
    path: `/${(path ?? []).map(decodeURIComponent).join("/")}`,
    query: pluginQuery(new URL(request.url).searchParams),
    body,
    actor,
    locale,
  });
  return json(result.body, result.status);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
