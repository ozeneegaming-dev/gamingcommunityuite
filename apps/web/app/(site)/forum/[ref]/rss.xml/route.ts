import { GcsForbidden, GcsNotFound } from "@gcs/core";
import { loadRssConfig, parseRef, rssDocument, RSS_ENABLED_SETTING } from "@gcs/modules";
import { topicHref } from "@/lib/forum-urls";
import { guestActor } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ref: string }> };

/**
 * Fluxul RSS al unui forum (Forum v2, setarea „RSS per forum”): cele mai noi topicuri pe care le vede un vizitator
 * (forumurile private, cu parolă sau „doar topicurile mele” nu au flux), cu începutul primei postări. Numărul de
 * topicuri, rezumatul și cache-ul vin din ACP › Descoperire › RSS.
 */
export async function GET(_req: Request, { params }: Props): Promise<Response> {
  const ref = parseRef((await params).ref);
  if (!ref) return new Response(null, { status: 404 });
  const { forumQueries, settings } = services();
  if (!(await settings.get<boolean>(RSS_ENABLED_SETTING))) return new Response(null, { status: 404 });
  const cfg = await loadRssConfig(settings);
  let data;
  try {
    data = await forumQueries.forum(await guestActor(), ref.id, { page: 1, snippets: cfg.snippets, sort: "created" });
  } catch (error) {
    if (error instanceof GcsNotFound || error instanceof GcsForbidden) return new Response(null, { status: 404 });
    throw error;
  }
  if (data.options.hasPassword || data.options.ownTopicsOnly || data.forum.type === "LINK" || data.forum.type === "CATEGORY") return new Response(null, { status: 404 });
  const base = ((await settings.get<string>("site.url")) || process.env.GCS_BASE_URL || "").replace(/\/$/, "");
  const siteName = await settings.get<string>("site.name");
  const body = rssDocument(
    { title: `${data.forum.name} · ${siteName}`, link: `${base}/forum/${data.forum.id}-${data.forum.slug}`, description: data.forum.description || data.forum.name },
    data.topics.slice(0, cfg.items).map((t) => ({ title: t.title, link: `${base}${topicHref(t)}`, date: new Date(t.createdAt), description: cfg.snippets ? t.snippet : null })),
  );
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": `public, max-age=${cfg.cacheMinutes * 60}` } });
}
