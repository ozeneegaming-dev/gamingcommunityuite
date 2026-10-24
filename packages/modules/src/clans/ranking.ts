import { gcsTryTxLock } from "@gcs/core";
import { type Prisma, type PrismaClient, sql } from "@gcs/db";
import { gamePartsByClan, type GcsClanGameParts, type GcsClanGameStatsSource } from "./gameStats";

/** Fereastra „recent” a clasamentului (postările și membrii activi). */
export const RANK_WINDOW_DAYS = 30;
const RANK_LOCK = 0x636c616e; // „clan”: lacătul consultativ al recalculării

/** Ponderile formulei; cele de joc (`playtime`, `kd`, `mixWins`, `elo`) sunt opționale (aplicația Servere). */
export type GcsClanWeights = { posts: number; reputation: number; activity: number; members: number; playtime?: number; kd?: number; mixWins?: number; elo?: number };
export type GcsClanScoreParts = { posts: number; reputation: number; active: number; members: number; game?: GcsClanGameParts | null };

const hasGameWeights = (w: GcsClanWeights) => Boolean(w.playtime || w.kd || w.mixWins || w.elo);

/**
 * Scorul unui clan după formula din specul 2026-10-08-clanuri §6. Partea de joc (§15) se adaugă doar dacă există
 * statistici: ore de joc × pondere + K/D × 100 × pondere + meciuri mix câștigate × pondere + ELO mediu ÷ 10 × pondere.
 */
export function clanScore(parts: GcsClanScoreParts, w: GcsClanWeights): number {
  const base = parts.posts * w.posts + parts.reputation * w.reputation + parts.active * w.activity + parts.members * w.members;
  const g = parts.game;
  const game = g ? g.playtimeHours * (w.playtime ?? 0) + g.kd * 100 * (w.kd ?? 0) + g.mixWins * (w.mixWins ?? 0) + ((g.elo ?? 0) / 10) * (w.elo ?? 0) : 0;
  return Math.round(base + game);
}

type Row = { id: number; members: number; reputation: number; active: number; posts: number; createdAt: Date };

/** Valorile formulei pentru clanurile date (sau toate clanurile active), într-o singură interogare. */
async function scoreRows(db: Pick<PrismaClient, "$queryRaw">, since: Date, clanId: number | null): Promise<Row[]> {
  return db.$queryRaw<Row[]>(sql`
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
    GROUP BY c.id`);
}

const partsJson = (r: Row, game: GcsClanGameParts | null): Prisma.InputJsonValue => ({
  posts: r.posts,
  reputation: r.reputation,
  active: r.active,
  members: r.members,
  ...(game ? { game } : {}),
});

/**
 * Recalculează scorurile și locurile tuturor clanurilor active (egalitate: mai mulți membri, apoi clanul mai vechi);
 * clanurile care nu sunt active pierd locul. Statisticile de joc se citesc o singură dată pentru toți membrii, doar dacă
 * aplicația Servere e activă (`games`). O singură rulare odată (lacăt consultativ). Întoarce câte clanuri au loc.
 */
export async function recomputeClanRanking(db: PrismaClient, weights: GcsClanWeights, now = new Date(), games: GcsClanGameStatsSource | null = null): Promise<number> {
  const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
  const active = await db.clan.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  // Statisticile de joc se citesc doar dacă vreo pondere de joc contează.
  const game = hasGameWeights(weights) ? await gamePartsByClan(db, games, active.map((c) => c.id)) : new Map<number, GcsClanGameParts>();
  return db.$transaction(
    async (tx) => {
      if (!(await gcsTryTxLock(tx, String(RANK_LOCK)))) return -1;
      const rows = (await scoreRows(tx, since, null))
        .map((r) => ({ ...r, game: game.get(r.id) ?? null }))
        .map((r) => ({ ...r, score: clanScore({ posts: r.posts, reputation: r.reputation, active: r.active, members: r.members, game: r.game }, weights) }))
        .sort((a, b) => b.score - a.score || b.members - a.members || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
      await tx.clan.updateMany({ where: { status: { not: "ACTIVE" } }, data: { rank: null } });
      for (const [i, r] of rows.entries()) {
        await tx.clan.update({ where: { id: r.id }, data: { score: r.score, rank: i + 1, scoreParts: partsJson(r, r.game), scoredAt: now } });
      }
      return rows.length;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Scorul unui singur clan (după intrări și ieșiri); locul se reface la următoarea recalculare completă. */
export async function rescoreClan(db: PrismaClient, clanId: number, weights: GcsClanWeights, now = new Date(), games: GcsClanGameStatsSource | null = null): Promise<void> {
  const since = new Date(now.getTime() - RANK_WINDOW_DAYS * 86_400_000);
  const [r] = await scoreRows(db, since, clanId);
  if (!r) return;
  const game = hasGameWeights(weights) ? ((await gamePartsByClan(db, games, [clanId])).get(clanId) ?? null) : null;
  const parts = { posts: r.posts, reputation: r.reputation, active: r.active, members: r.members, game };
  await db.clan.update({ where: { id: clanId }, data: { score: clanScore(parts, weights), scoreParts: partsJson(r, game), scoredAt: now } });
}
