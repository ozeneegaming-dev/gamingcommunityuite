import type { GcsActorResolver, GcsContentRatingService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsTopicService } from "../forums/topics";
import type { GcsPagesAccess } from "./access";
import type { GcsPagesQueries } from "./queries";
import { PAGES_CACHE_TAG, PAGES_RECORD_TYPE, plainText } from "./shared";

/**
 * Notele cu stele ale înregistrărilor (serviciul generic): doar în bazele cu notele pornite, membrii cu `pages.rate` și
 * grupul bazei, nu propria înregistrare; votul se poate schimba. Media se copiază pe înregistrare (ordinea „notă”).
 */
export function registerPagesRatings(ratings: GcsContentRatingService, deps: { db: PrismaClient; access: GcsPagesAccess; queries: GcsPagesQueries }): void {
  const { db, access, queries } = deps;
  ratings.register(PAGES_RECORD_TYPE, {
    canView: (actor, id) => queries.canViewRecord(actor, Number(id)),
    check: async (actor, id) => {
      if (!actor.userId) return "guest";
      const r = await db.pagesRecord.findUnique({ where: { id: Number(id) }, select: { authorId: true, databaseId: true, status: true } });
      if (!r || r.status !== "PUBLISHED") return "disabled";
      if (r.authorId === actor.userId) return "own_content";
      const d = await access.database(r.databaseId);
      if (!d?.ratings) return "disabled";
      return (await access.canRate(actor, d)) ? null : "no_permission";
    },
    changeVote: async () => true,
    canModerate: (actor) => access.isStaff(actor),
    onChange: async (tx, id, summary) => {
      await tx.pagesRecord.updateMany({ where: { id: Number(id) }, data: { ratingAvg: summary.avg, ratingCount: summary.count } });
    },
    tags: () => [PAGES_CACHE_TAG],
  });
}

/**
 * Legătura cu forumul: o înregistrare publicată într-o bază cu forum devine un topic al autorului (titlul, un fragment și
 * linkul spre înregistrare), o singură dată. Fără dreptul autorului de a posta acolo, nu se publică nimic.
 */
export async function publishPagesTopic(deps: { db: PrismaClient; topics: GcsTopicService; actors: GcsActorResolver; access: GcsPagesAccess; queries: GcsPagesQueries }, recordId: number): Promise<void> {
  const { db, topics, actors, access, queries } = deps;
  const r = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, title: true, contentHtml: true, authorId: true, databaseId: true, topicId: true, status: true } });
  if (!r || r.topicId !== null || r.status !== "PUBLISHED" || !r.authorId) return;
  const d = await access.database(r.databaseId);
  const link = await queries.recordLink(r.id);
  if (!d?.forumId || !link) return;
  const excerpt = plainText(r.contentHtml, 400);
  const content = {
    type: "doc",
    content: [
      ...(excerpt ? [{ type: "paragraph", content: [{ type: "text", text: excerpt }] }] : []),
      { type: "paragraph", content: [{ type: "text", text: link.title, marks: [{ type: "link", attrs: { href: link.href } }] }] },
    ],
  };
  const created = await topics.create(await actors.forUser(r.authorId, ""), { forumId: d.forumId, title: r.title.length >= 3 ? r.title : `${r.title}…`, content });
  await db.pagesRecord.update({ where: { id: r.id }, data: { topicId: created.topicId } });
}
