import { createHash } from "node:crypto";
import { defineKvScript, type GcsKv } from "../infra/kv";

/** „Online” = activitate în ultimele 5 minute (specul etapei 4 §3). */
export const PRESENCE_WINDOW_MS = 5 * 60_000;
const USERS_KEY = "gcs:presence:users";
const GUESTS_KEY = "gcs:presence:guests";
const RECORD_KEY = "gcs:presence:record";
const roomKey = (room: string) => `gcs:presence:${room}`;

export type GcsPresenceViewer = { userId: string } | { guestId: string };
export type GcsPresenceRecord = { count: number; at: Date };
export type GcsOnline = { users: string[]; guests: number; record: GcsPresenceRecord | null };

/** Id-ul de prezență al unui vizitator, derivat din IP (același la request și la socket, ca să nu fie numărat de două ori). */
export function guestPresenceId(ip: string): string {
  return createHash("sha256").update(`gcs-guest:${ip}`).digest("hex").slice(0, 16);
}

/**
 * Notează prezența, curăță intrările vechi și urcă recordul, totul atomic (sub concurență, recordul nu pierde actualizări).
 * Întoarce noul record sau 0 dacă nu s-a schimbat.
 */
const TOUCH_SCRIPT = defineKvScript<number>({
  lua: `
local key = ARGV[1] == 'u' and KEYS[1] or KEYS[2]
redis.call('ZADD', key, ARGV[3], ARGV[2])
local cutoff = tonumber(ARGV[3]) - tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. cutoff)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', '(' .. cutoff)
local total = redis.call('ZCARD', KEYS[1]) + redis.call('ZCARD', KEYS[2])
local rec = tonumber(redis.call('HGET', KEYS[3], 'count') or '0')
if total > rec then
  redis.call('HSET', KEYS[3], 'count', total, 'at', ARGV[3])
  return total
end
return 0`,
  run: async (kv, [users, guests, record], [kind, id, nowRaw, windowRaw]) => {
    const now = Number(nowRaw);
    await kv.zadd(kind === "u" ? users! : guests!, now, id!);
    const cutoff = now - Number(windowRaw);
    await kv.zremRangeByScore(users!, -Infinity, cutoff, { maxExclusive: true });
    await kv.zremRangeByScore(guests!, -Infinity, cutoff, { maxExclusive: true });
    const total = (await kv.zcard(users!)) + (await kv.zcard(guests!));
    const [rec] = await kv.hmget(record!, ["count"]);
    if (total <= Number(rec ?? 0)) return 0;
    await kv.hset(record!, { count: String(total), at: String(now) });
    return total;
  },
  fromRedis: Number,
});

/** Pune recordul dat dacă e mai mare decât cel din Redis (la pornire, din copia persistată). */
const SEED_RECORD_SCRIPT = defineKvScript<number>({
  lua: `
local rec = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
if tonumber(ARGV[1]) > rec then redis.call('HSET', KEYS[1], 'count', ARGV[1], 'at', ARGV[2]) return 1 end
return 0`,
  run: async (kv, [record], [count, at]) => {
    const [rec] = await kv.hmget(record!, ["count"]);
    if (Number(count) <= Number(rec ?? 0)) return 0;
    await kv.hset(record!, { count: count!, at: at! });
    return 1;
  },
  fromRedis: Number,
});

/** Prezența într-o cameră: membrul notat acum, cei mai vechi decât fereastra scoși, camera expiră odată cu fereastra. */
const TOUCH_ROOM_SCRIPT = defineKvScript<number>({
  lua: `
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. (tonumber(ARGV[2]) - tonumber(ARGV[3])))
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1`,
  run: async (kv, [key], [member, now, windowMs]) => {
    await kv.zadd(key!, Number(now), member!);
    await kv.zremRangeByScore(key!, -Infinity, Number(now) - Number(windowMs), { maxExclusive: true });
    await kv.expire(key!, Number(windowMs));
    return 1;
  },
  fromRedis: Number,
});

/**
 * Prezența (specul etapei 4 §4–5), în `GcsKv` (Redis în VPS, baza de date în Lite): membrii și vizitatorii activi în ultimele 5 minute, cititorii unui topic
 * și recordul de utilizatori online. `persistRecord` salvează un record nou (ex. în setări); `loadRecord` îl citește
 * înapoi când Redis-ul e gol (după o repornire).
 */
export class GcsPresenceService {
  private recordLoaded = false;

  constructor(
    private readonly deps: {
      kv: GcsKv;
      persistRecord?: (r: GcsPresenceRecord) => Promise<void>;
      loadRecord?: () => Promise<GcsPresenceRecord | null>;
      /** Un semn de prezență al unui membru (ex. timpul online pe zile); erorile nu opresc prezența. */
      onUserTouch?: (userId: string, now: number) => Promise<unknown>;
    },
  ) {}

  async touch(viewer: GcsPresenceViewer, now = Date.now()): Promise<void> {
    await this.ensureRecord();
    const [kind, id] = "userId" in viewer ? ["u", viewer.userId] : ["g", viewer.guestId];
    const record = Number(await this.deps.kv.script(TOUCH_SCRIPT, [USERS_KEY, GUESTS_KEY, RECORD_KEY], [kind, id, now, PRESENCE_WINDOW_MS]));
    if ("userId" in viewer && this.deps.onUserTouch) {
      await this.deps.onUserTouch(viewer.userId, now).catch((error: unknown) => {
        console.error("[gcs] timpul online nu a putut fi notat", error);
      });
    }
    if (record > 0 && this.deps.persistRecord) {
      await this.deps.persistRecord({ count: record, at: new Date(now) }).catch((error: unknown) => {
        console.error("[gcs] salvarea recordului de prezență a eșuat", error);
      });
    }
  }

  async touchTopic(topicId: number, viewer: GcsPresenceViewer, now = Date.now()): Promise<void> {
    await this.touchRoom(`topic:${topicId}`, viewer, now);
  }

  /** Prezența într-o cameră (topic sau cameră de chat): cine e în ea în ultimele 5 minute. */
  async touchRoom(room: string, viewer: GcsPresenceViewer, now = Date.now()): Promise<void> {
    const key = roomKey(room);
    const member = "userId" in viewer ? `u:${viewer.userId}` : `g:${viewer.guestId}`;
    await this.deps.kv.script(TOUCH_ROOM_SCRIPT, [key], [member, now, PRESENCE_WINDOW_MS]);
  }

  async leaveTopic(topicId: number, viewer: GcsPresenceViewer): Promise<void> {
    await this.leaveRoom(`topic:${topicId}`, viewer);
  }

  async leaveRoom(room: string, viewer: GcsPresenceViewer): Promise<void> {
    await this.deps.kv.zrem(roomKey(room), ["userId" in viewer ? `u:${viewer.userId}` : `g:${viewer.guestId}`]);
  }

  /** Membrii online (cei mai recenți întâi; filtrarea celor ascunși o face cine afișează), vizitatorii și recordul. */
  async online(now = Date.now()): Promise<GcsOnline> {
    await this.ensureRecord();
    const min = now - PRESENCE_WINDOW_MS;
    const [users, guests, record] = await Promise.all([
      this.deps.kv.zrangeByScore(USERS_KEY, min, Infinity, { rev: true }),
      this.deps.kv.zcount(GUESTS_KEY, min, Infinity),
      this.deps.kv.hgetall(RECORD_KEY),
    ]);
    const count = Number(record.count ?? 0);
    return { users, guests, record: count > 0 ? { count, at: new Date(Number(record.at)) } : null };
  }

  async topicReaders(topicId: number, now = Date.now()): Promise<{ users: string[]; guests: number }> {
    return this.roomMembers(`topic:${topicId}`, now);
  }

  /** Cine e într-o cameră (cei mai recenți întâi) și câți vizitatori. */
  async roomMembers(room: string, now = Date.now()): Promise<{ users: string[]; guests: number }> {
    const members = await this.deps.kv.zrangeByScore(roomKey(room), now - PRESENCE_WINDOW_MS, Infinity, { rev: true });
    return {
      users: members.filter((m) => m.startsWith("u:")).map((m) => m.slice(2)),
      guests: members.filter((m) => m.startsWith("g:")).length,
    };
  }

  private async ensureRecord(): Promise<void> {
    if (this.recordLoaded || !this.deps.loadRecord) return;
    this.recordLoaded = true;
    const saved = await this.deps.loadRecord().catch(() => null);
    if (saved && saved.count > 0) await this.deps.kv.script(SEED_RECORD_SCRIPT, [RECORD_KEY], [saved.count, saved.at.getTime()]);
  }
}
