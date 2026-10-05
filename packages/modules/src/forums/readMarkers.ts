import type { GcsActor, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/** Topicurile fără activitate de mai mult de atât sunt considerate citite (ține interogările mărginite pe forumuri mari). */
export const UNREAD_DAYS = 60;

type TopicForUnread = { id: number; forumId: number; lastPostId: number | null; lastPostAt: Date | string };

/**
 * `timestamp` (fără fus orar) pentru SQL brut: un `Date` trimis ca parametru ar fi interpretat în fusul orar al sesiunii.
 * Coloanele sunt în UTC (scrise de Prisma), deci comparăm cu șirul ISO fără `Z`, convertit cu `::timestamp`.
 */
const pgTimestamp = (d: Date) => d.toISOString().slice(0, -1);

/**
 * Necititele (specul etapei 2, §4; Review Focus #6). Un topic e necitit pentru un user dacă ultima lui postare vizibilă
 * (`lastPostId`, care ignoră postările ascunse) e după marker-ul userului, iar activitatea e după „marchează tot citit”
 * pe forum, după înregistrarea userului și din ultimele `UNREAD_DAYS` zile. Vizitatorii nu au necitite.
 */
export class GcsReadMarkerService {
  constructor(private readonly deps: { db: PrismaClient; settings: GcsSettingsService }) {}

  /** Marchează topicul citit până la postarea dată. Marker-ul doar crește. */
  async markRead(userId: string, topicId: number, lastPostId: number): Promise<void> {
    await this.deps.db.$executeRaw`
      INSERT INTO read_markers ("userId", "topicId", "lastReadPostId", "updatedAt")
      VALUES (${userId}, ${topicId}, ${lastPostId}, now() AT TIME ZONE 'UTC')
      ON CONFLICT ("userId", "topicId") DO UPDATE
      SET "lastReadPostId" = GREATEST(read_markers."lastReadPostId", EXCLUDED."lastReadPostId"), "updatedAt" = EXCLUDED."updatedAt"`;
  }

  /** „Marchează tot citit” pe un forum: forumul și toate subforumurile lui. */
  async markForumRead(userId: string, forumId: number): Promise<void> {
    const { db } = this.deps;
    const all = await db.forum.findMany({ select: { id: true, parentId: true } });
    const ids = [forumId];
    for (let i = 0; i < ids.length; i++) for (const f of all) if (f.parentId === ids[i]) ids.push(f.id);
    const markedAt = new Date();
    await db.$transaction(
      ids.map((id) =>
        db.forumReadMark.upsert({
          where: { userId_forumId: { userId, forumId: id } },
          create: { userId, forumId: id, markedAt },
          update: { markedAt },
        }),
      ),
    );
  }

  /** Momentul de dinaintea căruia totul e citit pentru user: înregistrarea sau acum `UNREAD_DAYS` zile. */
  private async cutoff(userId: string): Promise<Date> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    const window = new Date(Date.now() - UNREAD_DAYS * 86_400_000);
    return user && user.createdAt > window ? user.createdAt : window;
  }

  /** Care dintre topicurile date sunt necitite. */
  async unreadTopicIds(userId: string | null, topics: TopicForUnread[]): Promise<Set<number>> {
    if (!userId || topics.length === 0) return new Set();
    const { db } = this.deps;
    const [cutoff, markers, marks] = await Promise.all([
      this.cutoff(userId),
      db.readMarker.findMany({ where: { userId, topicId: { in: topics.map((t) => t.id) } }, select: { topicId: true, lastReadPostId: true } }),
      db.forumReadMark.findMany({ where: { userId, forumId: { in: [...new Set(topics.map((t) => t.forumId))] } } }),
    ]);
    const marker = new Map(markers.map((m) => [m.topicId, m.lastReadPostId]));
    const mark = new Map(marks.map((m) => [m.forumId, m.markedAt.getTime()]));
    const unread = new Set<number>();
    for (const t of topics) {
      const at = new Date(t.lastPostAt).getTime();
      if (t.lastPostId === null || at <= cutoff.getTime() || at <= (mark.get(t.forumId) ?? 0)) continue;
      if (t.lastPostId > (marker.get(t.id) ?? 0)) unread.add(t.id);
    }
    return unread;
  }

  /** Forumurile (dintre cele date) care au cel puțin un topic vizibil necitit. O singură interogare. */
  async unreadForumIds(userId: string | null, forumIds: number[]): Promise<Set<number>> {
    if (!userId || forumIds.length === 0) return new Set();
    const cutoff = pgTimestamp(await this.cutoff(userId));
    const rows = await this.deps.db.$queryRaw<{ forumId: number }[]>`
      SELECT DISTINCT t."forumId"
      FROM topics t
      LEFT JOIN read_markers m ON m."topicId" = t.id AND m."userId" = ${userId}
      LEFT JOIN forum_read_marks f ON f."forumId" = t."forumId" AND f."userId" = ${userId}
      WHERE t."forumId" = ANY(${forumIds})
        AND t.visibility = 'VISIBLE'
        AND t."lastPostId" IS NOT NULL
        AND t."lastPostAt" > ${cutoff}::timestamp
        AND (f."markedAt" IS NULL OR t."lastPostAt" > f."markedAt")
        AND t."lastPostId" > COALESCE(m."lastReadPostId", 0)`;
    return new Set(rows.map((r) => r.forumId));
  }

  /** Prima postare vizibilă necitită și pagina ei; dacă totul e citit, ultima postare. */
  async firstUnread(actor: GcsActor, topicId: number): Promise<{ postId: number; page: number } | null> {
    const { db, settings } = this.deps;
    const topic = await db.topic.findUnique({ where: { id: topicId }, select: { forumId: true } });
    if (!topic) return null;

    let boundary = 0;
    if (actor.userId) {
      const [marker, mark, cutoff] = await Promise.all([
        db.readMarker.findUnique({ where: { userId_topicId: { userId: actor.userId, topicId } } }),
        db.forumReadMark.findUnique({ where: { userId_forumId: { userId: actor.userId, forumId: topic.forumId } } }),
        this.cutoff(actor.userId),
      ]);
      // Postările de dinainte de „marchează tot citit” sau de înregistrare sunt citite.
      const readUntil = mark && mark.markedAt > cutoff ? mark.markedAt : cutoff;
      const lastReadByTime = await db.post.findFirst({
        where: { topicId, visibility: "VISIBLE", createdAt: { lte: readUntil } },
        orderBy: { id: "desc" },
        select: { id: true },
      });
      boundary = Math.max(marker?.lastReadPostId ?? 0, lastReadByTime?.id ?? 0);
    }

    const target =
      (await db.post.findFirst({ where: { topicId, visibility: "VISIBLE", id: { gt: boundary } }, orderBy: { id: "asc" }, select: { id: true } })) ??
      (await db.post.findFirst({ where: { topicId, visibility: "VISIBLE" }, orderBy: { id: "desc" }, select: { id: true } }));
    if (!target) return null;
    const [before, perPage] = await Promise.all([
      db.post.count({ where: { topicId, visibility: "VISIBLE", id: { lt: target.id } } }),
      settings.get<number>("forums.posts_per_page"),
    ]);
    return { postId: target.id, page: Math.floor(before / perPage) + 1 };
  }
}
