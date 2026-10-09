import { GcsError } from "@gcs/core";
import { getLocale } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * GIF-urile Chat Pro: `?q=` caută, fără `q` întoarce GIF-urile populare, prin furnizorul ales în ACP (GIPHY / Tenor).
 * Doar membrii cu acces la Chat Pro; fără cheie → 404 (clientul nu are butonul GIF). Răspunde `{ gifs }`.
 */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor.userId || actor.isBanned) return Response.json({ gifs: [] }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q");
  try {
    const gifs = await services().chatPro.gifs(actor, q, (await getLocale()).slice(0, 2));
    if (gifs === null) return Response.json({ gifs: [] }, { status: 404 });
    return Response.json({ gifs }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    if (error instanceof GcsError) return Response.json({ gifs: [] }, { status: error.status });
    return Response.json({ gifs: [] }, { status: 502 });
  }
}
