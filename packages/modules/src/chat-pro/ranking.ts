import type { GcsCache, GcsRateLimiter, GcsSettingsService } from "@gcs/core";
import { type PrismaClient, sql } from "@gcs/db";
import { toRef, userRefSelect } from "../forums/queries";
import { addDays, dayKey, daysBetween, previousPeriod, rankingPeriod, secondsSinceMidnight, weekStart, type GcsRankingPeriod } from "./period";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { CHAT_PRO_WINNER_BADGE } from "./index";
import type { GcsChatProLastWinner, GcsChatProRanking, GcsChatProRankRow } from "./types";

export const RANKING_TAG = "chat_pro_ranking";
const TOP = 3;
const CACHE_TTL = 30;

/**
 * Clasamentul Chat Pro (specul 2026-10-10-chat-pro §5): mesajele numărate pe zile (`chat_pro_daily_stats`), podiumul
 * perioadei (lunară implicit, configurabilă), „Spammer-ul zilei”, ultimul câștigător și statisticile membrului.
 * Numărarea ignoră comenzile botului și respectă pauza `chat_pro.count_cooldown` (peste flood-ul chat-ului); membrii
 * banați nu apar. Câștigătorul unei perioade încheiate se înregistrează o singură dată și primește badge-ul.
 */
export class GcsChatProRankingService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      settings: GcsSettingsService;
      rateLimiter: GcsRateLimiter;
      /** Acordă badge-ul câștigătorului (sistemul de badge-uri). */
      awardWinner?: (userId: string, period: GcsRankingPeriod) => Promise<void>;
    },
  ) {}

  private async options(): Promise<{ timeZone: string; kind: "month" | "week"; resetDay: number; cooldown: number }> {
    const s = this.deps.settings;
    const [timeZone, kind, resetDay, cooldown] = await Promise.all([
      s.get<string>("site.timezone").catch(() => "UTC"),
      s.get<string>("chat_pro.ranking_period"),
      s.get<number>("chat_pro.ranking_reset_day"),
      s.get<number>("chat_pro.count_cooldown"),
    ]);
    const k = kind === "week" ? "week" : "month";
    return { timeZone: typeof timeZone === "string" && timeZone ? timeZone : "UTC", kind: k, resetDay: k === "week" ? Math.min(7, resetDay) : resetDay, cooldown };
  }

  /** Ziua de azi și perioada curentă. */
  async current(now = new Date()): Promise<{ today: string; period: GcsRankingPeriod; resetDay: number; timeZone: string }> {
    const o = await this.options();
    const today = dayKey(now, o.timeZone);
    return { today, period: rankingPeriod(today, o.kind, o.resetDay), resetDay: o.resetDay, timeZone: o.timeZone };
  }

  /** Numără un mesaj al membrului (dacă a trecut pauza de numărare). Întoarce `true` dacă a fost numărat. */
  async count(userId: string, now = new Date()): Promise<boolean> {
    const { db, rateLimiter, cache } = this.deps;
    const o = await this.options();
    if (o.cooldown > 0) {
      const res = await rateLimiter.consume(`chat-pro-count:${userId}`, { window: o.cooldown, max: 1 });
      if (!res.allowed) return false;
    }
    const day = dayKey(now, o.timeZone);
    await db.chatProDailyStat.upsert({ where: { userId_day: { userId, day } }, create: { userId, day, messages: 1 }, update: { messages: { increment: 1 } } });
    await cache.invalidateTags([RANKING_TAG]);
    return true;
  }

  /** Primii membri (nebanați) după mesajele dintre două zile (inclusiv). */
  private async top(from: string, to: string, limit: number): Promise<GcsChatProRankRow[]> {
    const { db } = this.deps;
    const rows = await db.$queryRaw<{ userId: string; messages: number }[]>(sql`
      SELECT s."userId", SUM(s.messages)::int AS messages
      FROM chat_pro_daily_stats s JOIN users u ON u.id = s."userId" JOIN groups g ON g.id = u."primaryGroupId"
      WHERE s.day >= ${from} AND s.day <= ${to} AND g.key <> 'banned'
      GROUP BY s."userId" HAVING SUM(s.messages) > 0
      ORDER BY messages DESC, MIN(s.day) ASC, s."userId" ASC
      LIMIT ${limit}`);
    if (rows.length === 0) return [];
    const users = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: userRefSelect })).map((u) => [u.id, toRef(u)]));
    return rows.flatMap((r, i) => {
      const user = users.get(r.userId);
      return user ? [{ rank: i + 1, user, messages: r.messages }] : [];
    });
  }

  private async sum(userId: string, from: string, to: string): Promise<number> {
    const r = await this.deps.db.chatProDailyStat.aggregate({ where: { userId, day: { gte: from, lte: to } }, _sum: { messages: true } });
    return r._sum.messages ?? 0;
  }

  /**
   * Înregistrează câștigătorul perioadei anterioare, dacă nu există încă (idempotent: cheia e începutul perioadei),
   * și îi acordă badge-ul. Chemat la citirea clasamentului și de jobul zilnic.
   */
  async finalize(now = new Date()): Promise<void> {
    const { db, cache } = this.deps;
    const { period, resetDay } = await this.current(now);
    const prev = previousPeriod(period, resetDay);
    if (await db.chatProWinner.findUnique({ where: { periodStart: prev.start }, select: { id: true } })) return;
    const [best] = await this.top(prev.start, prev.end, 1);
    const created = await db.chatProWinner
      .create({ data: { periodStart: prev.start, periodEnd: prev.end, userId: best?.user.id ?? null, messages: best?.messages ?? 0 } })
      .catch(() => null);
    if (!created) return;
    await cache.invalidateTags([RANKING_TAG]);
    if (best && this.deps.awardWinner) await this.deps.awardWinner(best.user.id, prev);
  }

  /** Ultimul câștigător (cel mai recent rând cu un membru) și insigna primită, sau `null`. */
  async lastWinner(): Promise<GcsChatProLastWinner | null> {
    const cached = await this.deps.cache.get<{ v: GcsChatProLastWinner | null }>("chat_pro:last_winner");
    if (cached) return cached.v;
    const { db } = this.deps;
    const row = await db.chatProWinner.findFirst({ where: { userId: { not: null } }, orderBy: { periodStart: "desc" }, include: { user: { select: userRefSelect } } });
    let v: GcsChatProLastWinner | null = null;
    if (row?.user) {
      const b = await db.badge.findUnique({ where: { key: CHAT_PRO_WINNER_BADGE } });
      const badge = b ? { key: b.key, name: b.name, art: badgeArtSrc(b), image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null } : null;
      v = { user: toRef(row.user), messages: row.messages, start: row.periodStart, end: row.periodEnd, badge };
    }
    await this.deps.cache.set("chat_pro:last_winner", { v }, { ttlSec: 300, tags: [RANKING_TAG] });
    return v;
  }

  /** Panoul de clasament: podiumul, spammer-ul zilei, ultimul câștigător, numărătoarea inversă și statisticile viewer-ului. */
  async view(viewerId: string | null, now = new Date()): Promise<GcsChatProRanking> {
    const { cache } = this.deps;
    await this.finalize(now);
    const { today, period, timeZone, resetDay } = await this.current(now);
    const key = `chat_pro:ranking:${period.start}:${today}`;
    let shared = await cache.get<Pick<GcsChatProRanking, "top" | "spammer">>(key);
    if (!shared) {
      const [top, [spammer]] = await Promise.all([this.top(period.start, period.end, TOP), this.top(today, today, 1)]);
      shared = { top, spammer: spammer ?? null };
      await cache.set(key, shared, { ttlSec: CACHE_TTL, tags: [RANKING_TAG] });
    }
    const resetsIn = Math.max(0, daysBetween(today, period.next) * 86_400 - secondsSinceMidnight(now, timeZone));
    let me: GcsChatProRanking["me"] = null;
    if (viewerId) {
      const prev = previousPeriod(period, resetDay);
      const [todayCount, periodCount, week, previous] = await Promise.all([
        this.sum(viewerId, today, today),
        this.sum(viewerId, period.start, period.end),
        this.sum(viewerId, weekStart(today), addDays(weekStart(today), 6)),
        this.sum(viewerId, prev.start, prev.end),
      ]);
      me = { position: periodCount > 0 ? await this.position(periodCount, period) : null, today: todayCount, period: periodCount, week, previous };
    }
    return { period: { start: period.start, end: period.end, kind: period.kind }, resetsIn, ...shared, lastWinner: await this.lastWinner(), me };
  }

  /** Locul unui total în perioadă: câți membri nebanați au strict mai multe mesaje, plus unu. */
  private async position(total: number, period: GcsRankingPeriod): Promise<number> {
    const [row] = await this.deps.db.$queryRaw<{ n: number }[]>(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT s."userId" FROM chat_pro_daily_stats s JOIN users u ON u.id = s."userId" JOIN groups g ON g.id = u."primaryGroupId"
        WHERE s.day >= ${period.start} AND s.day <= ${period.end} AND g.key <> 'banned'
        GROUP BY s."userId" HAVING SUM(s.messages) > ${total}
      ) x`);
    return (row?.n ?? 0) + 1;
  }
}
