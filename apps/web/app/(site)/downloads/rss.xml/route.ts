import { rssDocument } from "@gcs/modules";
import { guestActor } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Fluxul RSS al Descărcărilor (`/downloads/rss.xml`, opțional `?category=<id>`): ultimele fișiere publicate pe care le
 * vede un vizitator. Oprit din ACP → Descărcări → Setări (sau aplicația oprită) → 404.
 */
export async function GET(req: Request): Promise<Response> {
  const { downloads, settings } = services();
  const opts = await downloads.queries.options();
  if (!opts.rss || !(await downloads.queries.appEnabled())) return new Response(null, { status: 404 });
  const raw = new URL(req.url).searchParams.get("category");
  const categoryId = raw && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
  const [feed, siteName, siteUrl] = await Promise.all([downloads.queries.feed(await guestActor(), categoryId), settings.get<string>("site.name"), settings.get<string>("site.url")]);
  if (categoryId && !feed.category) return new Response(null, { status: 404 });
  const base = (siteUrl || process.env.GCS_BASE_URL || "").replace(/\/$/, "");
  const title = feed.category ? `${feed.category.name} · ${siteName}` : siteName;
  const body = rssDocument(
    { title, link: `${base}${feed.category?.href ?? "/downloads"}`, description: title },
    feed.items.map((f) => ({ title: f.version ? `${f.title} ${f.version}` : f.title, link: `${base}${f.href}`, date: new Date(f.publishedAt), description: f.summary })),
  );
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}
