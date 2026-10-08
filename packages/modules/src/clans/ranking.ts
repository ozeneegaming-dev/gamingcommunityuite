import type { PrismaClient } from "@gcs/db";

/** Fereastra „recent” a clasamentului (postările și membrii activi). */
export const RANK_WINDOW_DAYS = 30;
const RANK_LOCK = 0x636c616e; // „clan”: lacătul consultativ al recalculării

export type GcsClanWeights = { posts: number; reputation: number; activity: number; members: number };
export type GcsClanScoreParts = { posts: number; reputation: number; active: number; members: number };

/** Scorul unui clan după formula din specul 2026-10-08-clanuri §6. */
export function clanScore(parts: GcsClanScoreParts, w: GcsClanWeights): number {
  return Math.round(parts.posts * w.posts + parts.reputation * w.reputation + parts.active * w.activity + parts.members * w.members);
}

type Row = { id: number; members: number; reputation: number; active: number; posts: number; createdAt: Date };

/** Valorile formulei pentru clanurile date (sau toate clanurile active), într-o singură interogare. */
async function scoreRows(db: Pick<PrismaClient, "$queryRaw">, since: Date, clanId: number | null): Promise<Row[]> {
  return db.$queryRaw<Row[]>`
    SELECT c.id, c."createdAt",
           COUNT(m."userId")::int AS members,
           COALESCE(SUM(u.reputation), 0)::int AS reputation,
           (COUNT(*) FILTER (WHERE u."lastActiveAt" >= ${since}))::int AS active,
           COALESCE((
             SELECT COUNT(*) FROM posts p
             JOIN clan_members pm ON pm."userId" = p."authorId" AND pm."clanId" = c.id
             WHERE p."createdAt" >= ${since} AND p.visibility = 'VISIBLE'
           ), 0)::int AS posts
    FROM clans c
    JOIN clan_members m ON m."clanId" = c.id
    JOIN users u ON u.id = m."userId"
    WHERE c.status = 'ACTIVE' AND (${clanId}::int IS NULL OR c.id = ${clanId}::int)
    GROUP BY c.id`;
}

/**
 * Recalculează scorurile și locurile tuturor clanurilor active (egalitate: mai mulți membri, apoi clanul mai vechi);
 * clanurile care nu sunt active pierd locul. O singură rulare odată (lacăt consultativ). Întoarce câte clanuri au loc.
 */
export async function recomputeClanRanking(db: PrismaClient, weights: GcsClanWeights, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
  return db.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${RANK_LOCK}) AS locked`;
      if (!lock?.locked) return -1;
      const rows = (await scoreRows(tx, since, null))
        .map((r) => ({ ...r, score: clanScore({ posts: r.posts, reputation: r.reputation, active: r.active, members: r.members }, weights) }))
        .sort((a, b) => b.score - a.score || b.members - a.members || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
      await tx.clan.updateMany({ where: { status: { not: "ACTIVE" } }, data: { rank: null } });
      for (const [i, r] of rows.entries()) {
        await tx.clan.update({
          where: { id: r.id },
          data: { score: r.score, rank: i + 1, scoreParts: { posts: r.posts, reputation: r.reputation, active: r.active, members: r.members }, scoredAt: now },
        });
      }
      return rows.length;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Scorul unui singur clan (după intrări și ieșiri); locul se reface la următoarea recalculare completă. */
export async function rescoreClan(db: PrismaClient, clanId: number, weights: GcsClanWeights, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
  const [r] = await scoreRows(db, since, clanId);
  if (!r) return;
  const parts = { posts: r.posts, reputation: r.reputation, active: r.active, members: r.members };
  await db.clan.update({ where: { id: clanId }, data: { score: clanScore(parts, weights), scoreParts: parts, scoredAt: now } });
}
