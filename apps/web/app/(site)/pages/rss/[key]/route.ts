import { rssDocument, RSS_ENABLED_SETTING } from "@gcs/modules";
import { guestActor } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Fluxul RSS al unei baze de date (`/pages/rss/<cheie>`): ultimele înregistrări publicate pe care le vede un vizitator.
 * Fluxul bazei oprit, baza invizibilă vizitatorilor sau fluxurile RSS oprite pe site → 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  const { pagesQueries, settings } = services();
  const { key } = await params;
  if (!(await settings.get<boolean>(RSS_ENABLED_SETTING))) return new Response(null, { status: 404 });
  const feed = /^[a-z0-9-]{1,80}$/.test(key) ? await pagesQueries.rss(await guestActor(), key) : null;
  if (!feed) return new Response(null, { status: 404 });
  const siteUrl = (await settings.get<string>("site.url")) || process.env.GCS_BASE_URL || "";
  const base = siteUrl.replace(/\/$/, "");
  const body = rssDocument(
    { title: feed.db.name, link: `${base}/pages/${feed.db.path}`, description: feed.db.description || feed.db.name },
    feed.items.map((i) => ({ title: i.title, link: `${base}${i.href}`, date: i.at, description: i.description })),
  );
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}
