import { currentActor } from "@/lib/actor";
import { SEARCH_PERIODS, SEARCH_SCOPES, type GcsSearchPeriod, type GcsSearchScope } from "@/lib/quick-search";
import { quickSearch, searchScopes } from "@/lib/quick-search.server";
import { moveTargets } from "@/lib/forum-page";

export const dynamic = "force-dynamic";

/**
 * Panoul de căutare din antet: `?meta=1` = domeniile disponibile și forumurile (filtrul „Forum”); altfel rezultatele
 * rapide pentru `?q=&scope=&forum=&author=&period=&titles=1`. Limitele de căutare ale forumului se aplică.
 */
export async function GET(req: Request): Promise<Response> {
  const actor = await currentActor();
  const sp = new URL(req.url).searchParams;
  const headers = { "Cache-Control": "private, no-store" };
  if (sp.get("meta") === "1") {
    const [scopes, forums] = await Promise.all([searchScopes(actor), moveTargets(actor)]);
    return Response.json({ scopes, forums }, { headers });
  }
  const scope = (SEARCH_SCOPES as readonly string[]).includes(sp.get("scope") ?? "") ? (sp.get("scope") as GcsSearchScope) : "all";
  const period = (SEARCH_PERIODS as readonly string[]).includes(sp.get("period") ?? "") ? (sp.get("period") as GcsSearchPeriod) : "any";
  const forum = Number(sp.get("forum"));
  const data = await quickSearch(actor, sp.get("q") ?? "", scope, {
    forum: Number.isInteger(forum) && forum > 0 ? forum : null,
    author: (sp.get("author") ?? "").slice(0, 40),
    period,
    titles: sp.get("titles") === "1",
  });
  return Response.json(data, { headers });
}
