import { searchGiphy } from "@gcs/modules";
import { getLocale } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 30 };

/**
 * Căutarea GIPHY pentru `/giphy` din chat: doar membrii autentificați, cu cheia din ACP (fără cheie → 404).
 * Răspunde `{ gifs: [{ id, title, url, preview, width, height }] }`.
 */
export async function GET(req: Request): Promise<Response> {
  const { apps, chat, rateLimiter } = services();
  const actor = await currentActor();
  if (!actor.userId || actor.isBanned) return Response.json({ gifs: [] }, { status: 401 });
  const key = (await apps.enabled("chat")) ? await chat.giphyKey() : null;
  if (!key) return Response.json({ gifs: [] }, { status: 404 });
  const limit = await rateLimiter.consume(`giphy:${actor.userId}`, LIMIT);
  if (!limit.allowed) return Response.json({ gifs: [] }, { status: 429 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q.trim()) return Response.json({ gifs: [] });
  try {
    const gifs = await searchGiphy(key, q, { lang: (await getLocale()).slice(0, 2) });
    return Response.json({ gifs }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ gifs: [] }, { status: 502 });
  }
}
