import {
  GcsRateLimited,
  GcsValidationError,
  isPluginFormField,
  PLUGIN_FORM_MAX_BYTES,
  PLUGIN_FORM_MAX_FILES,
  pluginAcpSection,
  pluginFormBody,
  pluginFormReturn,
  pluginMediaMaxBytes,
  type GcsActor,
  type GcsPluginMediaDecl,
} from "@gcs/core";
import { getLocale } from "next-intl/server";
import { getAcpContext } from "@/lib/acp";
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
const seeOther = (location: string) => new Response(null, { status: 303, headers: { ...HEADERS, Location: location } });

/** Un formular `multipart`: câmpurile text și fișierele, verificate și salvate de nucleu (capabilitatea `media`). */
async function multipartBody(request: Request, key: string, decl: GcsPluginMediaDecl, actor: GcsActor): Promise<Record<string, unknown> | Response> {
  const length = Number(request.headers.get("content-length"));
  const max = pluginMediaMaxBytes(decl) + (decl.image ? decl.image.maxMb * 1024 * 1024 : 0) + MAX_BODY;
  if (!Number.isFinite(length) || length <= 0) return json({ error: "length_required" }, 411);
  if (length > max) return json({ error: "too_large" }, 413);
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }
  const plugins = await pluginHost();
  const entries: [string, unknown][] = [];
  let files = 0;
  for (const [name, value] of data.entries()) {
    if (!isPluginFormField(name)) continue;
    if (typeof value === "string") {
      entries.push([name, value]);
      continue;
    }
    // Un câmp de fișier gol (nimic ales) nu înseamnă nimic.
    if (value.size === 0) continue;
    if (++files > PLUGIN_FORM_MAX_FILES || !actor.userId) {
      entries.push([name, { error: "too_many_files" }]);
      continue;
    }
    try {
      entries.push([name, await plugins.uploadMedia(key, { bytes: Buffer.from(await value.arrayBuffer()) }, actor)]);
    } catch (error) {
      // Pluginul primește motivul pe câmpul fișierului (ex. `too_large`) și decide ce afișează.
      if (error instanceof GcsValidationError) entries.push([name, { error: error.fields.file ?? error.code, ...(error.params ?? {}) }]);
      else if (error instanceof GcsRateLimited) entries.push([name, { error: "rate_limited" }]);
      else throw error;
    }
  }
  return pluginFormBody(entries);
}

/**
 * `/api/plugins/<cheie>/…` (etapa 6, Studio VIP): rutele API ale pluginurilor. JSON (corp ≤ 64 KB) sau formulare din
 * paginile pluginului (urlencoded ≤ 64 KB; `multipart` doar cu capabilitatea `media`, fișierele verificate și recodate
 * de nucleu înainte să ajungă la plugin). CSRF (Origin) la metodele care modifică, limită de rată pe IP și plugin.
 * Rutele marcate `acp` cer poarta ACP (sesiune ACP, 2FA) și dreptul pe secțiunea pluginului. Un formular primește 303
 * spre adresa cerută de plugin (o pagină a lui) sau înapoi la pagina de unde a venit.
 */
async function handle(request: Request, ctx: Ctx): Promise<Response> {
  const { plugin, path } = await ctx.params;
  const key = pluginKeyParam(plugin);
  if (!key) return json({ error: "not_found" }, 404);
  const method = request.method.toUpperCase();
  if (method !== "GET" && !isSameOrigin(request.headers)) return json({ error: "csrf" }, 403);

  const { rateLimiter, acp } = services();
  const limit = await rateLimiter.consume(`plugin-api:${key}:${clientIp(request.headers)}`, { window: 60, max: 120 });
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...HEADERS, "Retry-After": String(limit.retryAfter) } });
  if (await safeModeActive()) return json({ error: "safe_mode" }, 503);

  const plugins = await pluginHost();
  const routePath = `/${(path ?? []).map(decodeURIComponent).join("/")}`;
  const route = plugins.apiRoute(key, method, routePath);
  if (route.status === 404) return json({ error: "not_found" }, 404);
  if (route.status === 405) return json({ error: "method_not_allowed" }, 405);

  let actor = await currentActor();
  if (route.acp) {
    const gate = await getAcpContext();
    if (gate.state !== "ok" || !(await acp.can(gate.actor, pluginAcpSection(key), route.acp))) return json({ error: "forbidden" }, 403);
    actor = gate.actor;
  }

  let body: unknown = null;
  let form = false;
  if (method !== "GET" && method !== "DELETE") {
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("multipart/form-data")) {
      if (!route.media) return json({ error: "unsupported_media_type" }, 415);
      const parsed = await multipartBody(request, key, route.media, actor);
      if (parsed instanceof Response) return parsed;
      body = parsed;
      form = true;
    } else {
      const raw = await request.text();
      if (raw.length > (type.startsWith("application/x-www-form-urlencoded") ? PLUGIN_FORM_MAX_BYTES : MAX_BODY)) return json({ error: "too_large" }, 413);
      if (type.startsWith("application/x-www-form-urlencoded")) {
        body = pluginFormBody(new URLSearchParams(raw).entries());
        form = true;
      } else if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
      }
    }
  }
  const result = await plugins.handleApi(key, {
    method,
    path: routePath,
    query: pluginQuery(new URL(request.url).searchParams),
    body,
    actor,
    locale: await getLocale(),
    form,
    acp: route.acp !== null,
  });
  // Un formular trimis din JS (`Accept: application/json`) primește JSON-ul pluginului, nu redirecționarea.
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  if (form && !wantsJson) {
    const origin = new URL(request.url).origin;
    const back = result.redirect ?? pluginFormReturn(request.headers.get("referer"), request.headers.get("origin") ?? origin, key);
    if (back) return seeOther(back);
  }
  return json(result.body, result.status);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
