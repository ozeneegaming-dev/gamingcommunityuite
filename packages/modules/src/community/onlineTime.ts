import { defineKvScript, type GcsJobQueue, type GcsKv, type GcsMemberDataHandler, type GcsSettingsService } from "@gcs/core";
import { Prisma, type PrismaClient, isMysql, sql } from "@gcs/db";
import { addDays, dayKey } from "../chat-pro/period";
export { formatOnlineDuration } from "./onlineFormat";

/**
 * Timpul online al membrilor (specul 2026-10-10-hero-cockpit §4, „Timp online”): fiecare semn de prezență (cererile
 * paginilor, ping-ul socket-ului la 60 s) adaugă timpul scurs de la semnul precedent, dacă pauza e cel mult fereastra
 * de prezență (5 minute). Totalurile zilei (`YYYY-MM-DD` în fusul orar al site-ului) stau în Redis și se copiază în
 * `member_online_days` (jobul de 5 minute și înaintea citirilor); copia păstrează mereu valoarea cea mai mare, deci o
 * repornire a Redis-ului nu scade totalul zilei.
 */

/** Pauza maximă dintre două semne care încă se socotește „online” (ca fereastra de prezență). */
export const ONLINE_GAP_MS = 5 * 60_000;
const LAST_TTL_MS = ONLINE_GAP_MS * 2;
/** Totalurile zilnice din Redis trăiesc 3 zile (ziua de ieri se mai copiază după miezul nopții). */
const DAY_TTL_MS = 3 * 86_400_000;
const FLUSH_LOCK_MS = 30_000;
const lastKey = (userId: string) => `gcs:online:last:${userId}`;
const dayHash = (day: string) => `gcs:online:day:${day}`;
const FLUSH_KEY = "gcs:online:flush";

/**
 * Atomic: citește ultimul semn, îl actualizează (doar înainte în timp) și adaugă pauza la totalul zilei dacă e scurtă.
 * Întoarce milisecundele adăugate.
 */
const HEARTBEAT_SCRIPT = defineKvScript<number>({
  lua: `
local last = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
if now > last then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3]) end
local delta = now - last
if last > 0 and delta > 0 and delta <= tonumber(ARGV[2]) then
  redis.call('HINCRBY', KEYS[2], ARGV[4], delta)
  redis.call('PEXPIRE', KEYS[2], ARGV[5])
  return delta
end
return 0`,
  run: async (kv, [lastKey, dayKey], [nowRaw, gap, lastTtl, userId, dayTtl]) => {
    const last = Number((await kv.get(lastKey!)) ?? 0);
    const now = Number(nowRaw);
    if (now > last) await kv.set(lastKey!, nowRaw!, { ttlMs: Number(lastTtl) });
    const delta = now - last;
    if (last > 0 && delta > 0 && delta <= Number(gap)) {
      await kv.hincrby(dayKey!, userId!, delta);
      await kv.expire(dayKey!, Number(dayTtl));
      return delta;
    }
    return 0;
  },
  fromRedis: Number,
});

/** Perioadele clasamentului (zilele incluse, în fusul orar al site-ului). */
export const GCS_ONLINE_PERIODS = ["day", "week", "month", "year", "all"] as const;
export type GcsOnlinePeriod = (typeof GCS_ONLINE_PERIODS)[number];
const PERIOD_DAYS: Record<Exclude<GcsOnlinePeriod, "all">, number> = { day: 1, week: 7, month: 30, year: 365 };

/** Prima zi inclusă într-o perioadă (`null` = de la început). */
export function onlinePeriodStart(today: string, period: GcsOnlinePeriod): string | null {
  return period === "all" ? null : addDays(today, -(PERIOD_DAYS[period] - 1));
}

export class GcsOnlineTime {
  constructor(private readonly deps: { db: PrismaClient; kv: GcsKv; settings: GcsSettingsService }) {}

  /** Fusul orar al site-ului (un fus invalid devine UTC la calculul zilei). */
  async timeZone(): Promise<string> {
    return this.deps.settings.get<string>("site.timezone").catch(() => "UTC");
  }

  async today(now = Date.now()): Promise<string> {
    return dayKey(new Date(now), await this.timeZone());
  }

  /** Un semn de prezență al membrului: adaugă pauza de la semnul precedent la totalul zilei (dacă e scurtă). */
  async heartbeat(userId: string, now = Date.now()): Promise<number> {
    const day = await this.today(now);
    return Number(await this.deps.kv.script(HEARTBEAT_SCRIPT, [lastKey(userId), dayHash(day)], [now, ONLINE_GAP_MS, LAST_TTL_MS, userId, DAY_TTL_MS]));
  }

  /**
   * Copiază totalurile de azi și de ieri din Redis în baza de date (secunde întregi; cea mai mare valoare câștigă).
   * Membrii șterși între timp sunt ignorați. `force: false` = cel mult o dată la 30 s (citirile o cer des).
   */
  async flush(now = Date.now(), opts: { force?: boolean } = {}): Promise<number> {
    const { db, kv } = this.deps;
    if (!opts.force && !(await kv.set(FLUSH_KEY, "1", { ttlMs: FLUSH_LOCK_MS, nx: true }))) return 0;
    const today = await this.today(now);
    let written = 0;
    for (const day of [addDays(today, -1), today]) {
      const totals = await kv.hgetall(dayHash(day));
      const rows = Object.entries(totals)
        .map(([userId, ms]) => ({ userId, seconds: Math.floor(Number(ms) / 1000) }))
        .filter((r) => r.seconds > 0);
      if (rows.length === 0) continue;
      if (isMysql()) {
        // MySQL: fără `unnest`; membrii șterși între timp se scot înainte, cea mai mare valoare câștigă la fel.
        const alive = new Set((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true } })).map((u) => u.id));
        const valid = rows.filter((r) => alive.has(r.userId));
        if (valid.length === 0) continue;
        await db.$executeRaw(sql`
          INSERT INTO member_online_days (userId, day, seconds)
          VALUES ${Prisma.join(valid.map((r) => sql`(${r.userId}, ${day}, ${r.seconds})`))}
          ON DUPLICATE KEY UPDATE seconds = GREATEST(seconds, VALUES(seconds))`);
        written += valid.length;
        continue;
      }
      written += await db.$executeRaw(sql`
        INSERT INTO member_online_days ("userId", day, seconds)
        SELECT v."userId", ${day}, v.seconds
        FROM unnest(${rows.map((r) => r.userId)}::text[], ${rows.map((r) => r.seconds)}::int[]) AS v("userId", seconds)
        JOIN users u ON u.id = v."userId"
        ON CONFLICT ("userId", day) DO UPDATE SET seconds = GREATEST(member_online_days.seconds, EXCLUDED.seconds)`);
    }
    return written;
  }

  /** Secundele online ale unor membri într-o perioadă (după copierea totalurilor din Redis). */
  async seconds(userIds: string[], period: GcsOnlinePeriod, now = Date.now()): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (userIds.length === 0) return out;
    await this.flush(now);
    const from = onlinePeriodStart(await this.today(now), period);
    const rows = await this.deps.db.memberOnlineDay.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, ...(from ? { day: { gte: from } } : {}) },
      _sum: { seconds: true },
    });
    for (const r of rows) out.set(r.userId, r._sum.seconds ?? 0);
    return out;
  }

  /**
   * Interogarea SQL a totalurilor pe perioadă (`id`, `value` în secunde), pentru clasament. Totalurile se copiază
   * întâi din Redis, ca „Azi” să fie la zi.
   */
  async valuesSql(period: GcsOnlinePeriod, now = Date.now()): Promise<Prisma.Sql> {
    await this.flush(now);
    const from = onlinePeriodStart(await this.today(now), period);
    const where = from ? sql`WHERE d.day >= ${from}` : Prisma.empty;
    return sql`SELECT d."userId" AS id, sum(d.seconds)::int AS value FROM member_online_days d ${where} GROUP BY d."userId"`;
  }

  /** Jobul de copiere (5 minute), rulat de worker. */
  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: "community.online_time_flush", everyMs: 5 * 60_000, handler: async () => void (await this.flush(Date.now(), { force: true })) });
  }
}

/**
 * Timpul online la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri): zilele dispar odată cu
 * membrul; la unire, secundele se adună pe zile.
 */
export function onlineTimeMemberData(deps: { db: PrismaClient }): GcsMemberDataHandler {
  const { db } = deps;
  return {
    key: "online_time",
    async summary(userId) {
      return [{ key: "online_time.days", count: await db.memberOnlineDay.count({ where: { userId } }) }];
    },
    async erase({ userId }) {
      return (await db.memberOnlineDay.deleteMany({ where: { userId } })).count;
    },
    async merge({ sourceId, targetId }) {
      return db.$transaction(async (tx) => {
        const n = await tx.$executeRaw(sql`
          INSERT INTO member_online_days ("userId", day, seconds)
          SELECT ${targetId}, day, seconds FROM member_online_days WHERE "userId" = ${sourceId}
          ON CONFLICT ("userId", day) DO UPDATE SET seconds = member_online_days.seconds + EXCLUDED.seconds`);
        return n + (await tx.memberOnlineDay.deleteMany({ where: { userId: sourceId } })).count;
      });
    },
  };
}
