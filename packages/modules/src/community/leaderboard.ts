import { GcsForbidden, type GcsActor, type GcsCache, type GcsPermissionService } from "@gcs/core";
import { Prisma, type PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { notBannedSql, pgTimestamp, profileAudience, profileVisibleSql, type GcsProfileAudience } from "./sql";

export const GCS_LEADERBOARD_METRICS = ["reputation", "posts", "xp", "solutions"] as const;
export type GcsLeaderboardMetric = (typeof GCS_LEADERBOARD_METRICS)[number];
export const GCS_LEADERBOARD_PERIODS = ["week", "month", "all"] as const;
export type GcsLeaderboardPeriod = (typeof GCS_LEADERBOARD_PERIODS)[number];
export const LEADERBOARD_SIZE = 50;
const TTL = 300;
const DAY = 86_400_000;
/** Perioadele: ultimele 7, respectiv 30 de zile (ca widget-ul „Top posteri”). */
const PERIOD_DAYS: Record<Exclude<GcsLeaderboardPeriod, "all">, number> = { week: 7, month: 30 };
/** Contorul userului folosit la „Tot timpul”. */
const COUNTER: Record<GcsLeaderboardMetric, string> = { reputation: "reputation", posts: "postsCount", xp: "points", solutions: "solutionsCount" };

/** Un loc în clasament: locul (egalitățile au același loc), valoarea, userul și grupul lui principal. */
export type GcsLeaderboardRow = { rank: number; value: number; user: GcsUserRef; group: { name: string; color: string | null; icon: string | null } };

const rowSelect = { ...userRefSelect, primaryGroup: { select: { key: true, name: true, title: true, color: true, icon: true } } } as const satisfies Prisma.UserSelect;

/**
 * Clasamentul (`/leaderboard`): primii 50 după reputație, postări, XP (realizări) sau soluții, pe săptămână, lună sau
 * tot timpul. Pe perioade, valorile se calculează din ce s-a creat în perioadă (reacțiile primite, postările vizibile din
 * topicuri vizibile, punctele din jurnalul realizărilor, răspunsurile marcate soluție); „tot timpul” folosește contoarele.
 * Doar valori pozitive, fără membrii banați, cu regula de vizibilitate a profilului; accesul cere `core.members_list`
 * (ca lista de membri). Cache 5 minute pe (măsură, perioadă, public), tag `leaderboard` și `user:<id>`.
 */
export class GcsLeaderboard {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; permissions: GcsPermissionService }) {}

  async top(viewer: GcsActor, metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, now = Date.now()): Promise<GcsLeaderboardRow[]> {
    const { cache, permissions } = this.deps;
    if (viewer.isBanned || !(await permissions.can(viewer, "core.members_list"))) throw new GcsForbidden({ permission: "core.members_list" });
    const audience = await profileAudience(permissions, viewer);
    const key = `leaderboard:${metric}:${period}:${audience}`;
    const cached = await cache.get<GcsLeaderboardRow[]>(key);
    if (cached) return cached;
    const rows = await this.compute(metric, period, audience, now);
    await cache.set(key, rows, { ttlSec: TTL, tags: ["leaderboard", ...rows.map((r) => `user:${r.user.id}`)] });
    return rows;
  }

  private values(metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, now: number): Prisma.Sql {
    if (period === "all") {
      const col = Prisma.raw(`"${COUNTER[metric]}"`);
      return Prisma.sql`SELECT c.id, c.${col} AS value FROM users c WHERE c.${col} > 0`;
    }
    const since = Prisma.sql`${pgTimestamp(new Date(now - PERIOD_DAYS[period] * DAY))}::timestamp`;
    // `contentId` e text (orice tip de conținut): convertit doar când e un număr, în CASE (ordinea evaluării e garantată).
    const numericId = Prisma.sql`(CASE WHEN cr."contentId" ~ '^[0-9]{1,9}$' THEN cr."contentId"::int END)`;
    switch (metric) {
      case "posts":
        return Prisma.sql`SELECT p."authorId" AS id, count(*)::int AS value
          FROM posts p JOIN topics t ON t.id = p."topicId"
          WHERE p.visibility = 'VISIBLE' AND t.visibility = 'VISIBLE' AND p."createdAt" >= ${since} AND p."authorId" IS NOT NULL
          GROUP BY p."authorId"`;
      case "reputation":
        return Prisma.sql`SELECT x.id, sum(x.weight)::int AS value FROM (
            SELECT p."authorId" AS id, r.weight FROM content_reactions cr
              JOIN reactions r ON r.id = cr."reactionId" JOIN posts p ON p.id = ${numericId}
              WHERE cr."contentType" = 'forums.post' AND cr."createdAt" >= ${since}
            UNION ALL
            SELECT s."authorId" AS id, r.weight FROM content_reactions cr
              JOIN reactions r ON r.id = cr."reactionId" JOIN status_updates s ON s.id = ${numericId}
              WHERE cr."contentType" = 'profile.status' AND cr."createdAt" >= ${since}
          ) x WHERE x.id IS NOT NULL GROUP BY x.id`;
      case "xp":
        return Prisma.sql`SELECT a."userId" AS id, sum(a.points)::int AS value FROM achievement_log a WHERE a."createdAt" >= ${since} GROUP BY a."userId"`;
      case "solutions":
        return Prisma.sql`SELECT p."authorId" AS id, count(*)::int AS value
          FROM topics t JOIN posts p ON p.id = t."solvedPostId"
          WHERE p."createdAt" >= ${since} AND p."authorId" IS NOT NULL
          GROUP BY p."authorId"`;
    }
  }

  private async compute(metric: GcsLeaderboardMetric, period: GcsLeaderboardPeriod, audience: GcsProfileAudience, now: number): Promise<GcsLeaderboardRow[]> {
    const { db } = this.deps;
    const top = await db.$queryRaw<{ id: string; value: number }[]>`
      SELECT v.id, v.value::int AS value FROM (${this.values(metric, period, now)}) v
      JOIN users u ON u.id = v.id
      WHERE v.value > 0 AND ${notBannedSql(Prisma.sql`u`)} ${profileVisibleSql(Prisma.sql`u`, audience)}
      ORDER BY v.value DESC, u."createdAt" ASC, u.id ASC
      LIMIT ${LEADERBOARD_SIZE}`;
    if (top.length === 0) return [];
    const users = new Map((await db.user.findMany({ where: { id: { in: top.map((t) => t.id) } }, select: rowSelect })).map((u) => [u.id, u]));
    const rows: GcsLeaderboardRow[] = [];
    for (const [i, t] of top.entries()) {
      const u = users.get(t.id);
      if (!u) continue;
      const value = Number(t.value);
      // Clasament „olimpic”: egalitățile au același loc, următorul sare peste (1, 2, 2, 4).
      const rank = i > 0 && rows[rows.length - 1]?.value === value ? rows[rows.length - 1]!.rank : i + 1;
      rows.push({ rank, value, user: toRef(u), group: { name: u.primaryGroup.title ?? u.primaryGroup.name, color: u.primaryGroup.color, icon: u.primaryGroup.icon } });
    }
    return rows;
  }
}
