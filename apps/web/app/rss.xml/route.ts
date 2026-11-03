import { loadRssConfig, rssDocument, RSS_ENABLED_SETTING } from "@gcs/modules";
import { topicHref } from "@/lib/forum-urls";
import { guestActor } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Fluxul RSS general (`/rss.xml`, ACP › Descoperire › RSS): topicurile cu activitate recentă din forumurile pe care le
 * vede un vizitator. Oprit (fluxurile sau doar cel general) → 404.
 */
export async function GET(): Promise<Response> {
  const { forumQueries, settings } = services();
  const cfg = await loadRssConfig(settings);
  if (!cfg.siteFeed || !(await settings.get<boolean>(RSS_ENABLED_SETTING))) return new Response(null, { status: 404 });
  const [topics, siteName, siteUrl, description] = await Promise.all([
    forumQueries.recentTopics(await guestActor(), cfg.items),
    settings.get<string>("site.name"),
    settings.get<string>("site.url"),
    settings.get<string>("site.description").catch(() => ""),
  ]);
  const base = (siteUrl || process.env.GCS_BASE_URL || "").replace(/\/$/, "");
  const body = rssDocument(
    { title: siteName, link: base || "/", description: description || siteName },
    topics.map((t) => ({ title: t.title, link: `${base}${topicHref(t)}`, date: new Date(t.lastPostAt) })),
  );
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": `public, max-age=${cfg.cacheMinutes * 60}` } });
}
