import type { MetadataRoute } from "next";
import { forumHref, topicHref } from "@/lib/forum-urls";
import { FORUM_INDEX_ALT_HREF } from "@/lib/landing";
import { guestActor, siteBaseUrl } from "@/lib/seo";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Limita unui sitemap (protocolul sitemaps.org). */
const MAX_URLS = 50_000;

/** `sitemap.xml`: forumurile și topicurile vizibile vizitatorilor (Review Focus #2: nimic ascuns sau în așteptare). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { db, permissions, apps } = services();
  const base = await siteBaseUrl();
  const guest = await guestActor();
  // Cu altă aplicație de pornire (ACP → Aplicații), indexul forumului are adresa lui (specul 2026-10-09 §2.3).
  const forumIndex = (await apps.landingFor(guest)) ? [{ url: `${base}${FORUM_INDEX_ALT_HREF}`, changeFrequency: "hourly" as const }] : [];
  const forums = await db.forum.findMany({ where: { type: { not: "LINK" } }, select: { id: true, slug: true, lastPostAt: true } });
  const readable = await permissions.filterContainers(guest, "forums.read", forums.map((f) => ({ type: "forum", id: String(f.id) })));
  const open = forums.filter((f) => readable.has(String(f.id)));

  const topics = await db.topic.findMany({
    where: { visibility: "VISIBLE", forumId: { in: open.map((f) => f.id) } },
    orderBy: { lastPostAt: "desc" },
    take: MAX_URLS - open.length - 2,
    select: { id: true, slug: true, lastPostAt: true },
  });

  return [
    { url: `${base}/`, changeFrequency: "hourly" },
    ...forumIndex,
    ...open.map((f) => ({ url: `${base}${forumHref(f)}`, ...(f.lastPostAt ? { lastModified: f.lastPostAt } : {}) })),
    ...topics.map((t) => ({ url: `${base}${topicHref(t)}`, lastModified: t.lastPostAt })),
  ];
}
