import { createHash } from "node:crypto";
import { safeFetchBuffer } from "@gcs/core";
import { parseLinkPreview, type GcsLinkPreview } from "@gcs/modules";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 30 };
const TTL = 24 * 3600;

/**
 * Previzualizarea unui link din chat (Chat Pro): `?url=https://…` → `{ preview: { url, host, title, site } | null }`.
 * Serverul descarcă pagina prin garda anti-SSRF (doar internet public, 1,5 MB, 5 s), rezultatul stă o zi în cache; doar
 * membrii cu acces la Chat Pro, cu limită pe minut. Browserul nu contactează site-ul extern.
 */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  const { chatPro, rateLimiter, cache } = services();
  if (!actor.userId || actor.isBanned || !(await chatPro.canUse(actor))) return Response.json({ preview: null }, { status: 404 });
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  if (!URL.canParse(raw) || !/^https?:$/.test(new URL(raw).protocol) || raw.length > 500) return Response.json({ preview: null }, { status: 400 });
  const key = `chat_pro:preview:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
  const cached = await cache.get<{ v: GcsLinkPreview | null }>(key);
  if (cached) return Response.json({ preview: cached.v }, { headers: { "Cache-Control": "private, max-age=3600" } });
  const limit = await rateLimiter.consume(`chat-pro-preview:${actor.userId}`, LIMIT);
  if (!limit.allowed) return Response.json({ preview: null }, { status: 429 });
  let preview: GcsLinkPreview | null = null;
  try {
    const page = await safeFetchBuffer(raw, { maxBytes: 1_500_000, timeoutMs: 5000, maxRedirects: 3 });
    if ((page.contentType ?? "").includes("html")) preview = parseLinkPreview(raw, page.bytes.toString("utf8"));
  } catch {
    preview = null;
  }
  await cache.set(key, { v: preview }, { ttlSec: TTL, tags: ["chat_pro_preview"] });
  return Response.json({ preview }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
