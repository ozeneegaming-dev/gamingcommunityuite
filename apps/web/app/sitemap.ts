import type { MetadataRoute } from "next";
import { forumHref, topicHref } from "@/lib/forum-urls";
import { guestActor, siteBaseUrl } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Limita unui sitemap (protocolul sitemaps.org). */
const MAX_URLS = 50_000;

/** `sitemap.xml`: forumurile și topicurile vizibile vizitatorilor (Review Focus #2: nimic ascuns sau în așteptare). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { db, permissions } = services();
  const base = await siteBaseUrl();
  const guest = await guestActor();
  const forums = await db.forum.findMany({ where: { type: { not: "LINK" } }, select: { id: true, slug: true, lastPostAt: true } });
  const readable = await permissions.filterContainers(guest, "forums.read", forums.map((f) => ({ type: "forum", id: String(f.id) })));
  const open = forums.filter((f) => readable.has(String(f.id)));

  const topics = await db.topic.findMany({
    where: { visibility: "VISIBLE", forumId: { in: open.map((f) => f.id) } },
    orderBy: { lastPostAt: "desc" },
    take: MAX_URLS - open.length - 1,
    select: { id: true, slug: true, lastPostAt: true },
  });

  return [
    { url: `${base}/`, changeFrequency: "hourly" },
    ...open.map((f) => ({ url: `${base}${forumHref(f)}`, ...(f.lastPostAt ? { lastModified: f.lastPostAt } : {}) })),
    ...topics.map((t) => ({ url: `${base}${topicHref(t)}`, lastModified: t.lastPostAt })),
  ];
}
