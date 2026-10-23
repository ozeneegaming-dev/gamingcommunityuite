import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsKv, GcsKvScript } from "./kv";

type Tx = Prisma.TransactionClient;
type Entry = { key: string; type: string; value: string | null; expiresAt: bigint | null };
type KvType = "string" | "hash" | "zset" | "set" | "list";

/** Benzile de lacăt: o cheie blochează banda ei (`FOR UPDATE`), deci operațiile pe aceeași cheie se serializează. */
const STRIPES = 256;
const MAX_KEY = 255;

/** Cheile prea lungi pentru coloană păstrează începutul (prefixul contează la `delPrefix`) și primesc un hash. */
export function sqlKvKey(key: string): string {
  if (key.length <= MAX_KEY) return key;
  return `${key.slice(0, 190)}#${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
}

function stripeOf(key: string): number {
  return createHash("sha1").update(key).digest().readUInt16BE(0) % STRIPES;
}

class WrongType extends Error {
  constructor(key: string) {
    super(`WRONGTYPE: ${key}`);
  }
}

/**
 * `GcsKv` în baza de date (ediția Lite, fără Redis): `gcs_kv` (cheia, tipul, valoarea, expirarea în ms) și
 * `gcs_kv_items` (elementele colecțiilor). Citirile sunt simple `SELECT`-uri care ignoră cheile expirate; scrierile
 * rulează într-o tranzacție care blochează banda cheii, deci sunt atomice între procese (Passenger, cron).
 * Cheile expirate se șterg leneș la scriere și de `sweep()` (jobul de curățenie).
 */
export class GcsSqlKv implements GcsKv {
  readonly driver = "sql" as const;

  constructor(
    private readonly db: PrismaClient,
    private readonly opts: { now?: () => number; tx?: Tx } = {},
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private get q(): Tx {
    return this.opts.tx ?? this.db;
  }

  private alive(entry: Entry | null): entry is Entry {
    return entry !== null && (entry.expiresAt === null || Number(entry.expiresAt) > this.now());
  }

  /**
   * Rulează `fn` într-o tranzacție cu benzile cheilor blocate (în ordine). În `script`, direct. O operație care atinge
   * și chei nedeclarate (ex. invalidarea cache-ului) poate intra în deadlock cu alta: baza o oprește pe una, care se
   * reia de la capăt.
   */
  private async atomic<T>(keys: string[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (this.opts.tx) return fn(this.opts.tx);
    return withRetry(() =>
      this.db.$transaction(
        async (tx) => {
          await lockStripes(tx, keys);
          return fn(tx);
        },
        { maxWait: 15_000, timeout: 30_000 },
      ),
    );
  }

  /** Intrarea vie a cheii, în tranzacție; una expirată se șterge (cu elementele ei). */
  private async load(tx: Tx, key: string): Promise<Entry | null> {
    const entry = await tx.gcsKvEntry.findUnique({ where: { key } });
    if (!entry) return null;
    if (this.alive(entry)) return entry;
    await tx.gcsKvEntry.delete({ where: { key } });
    return null;
  }

  /** Colecția de tipul dat (creată goală dacă lipsește). */
  private async collection(tx: Tx, key: string, type: KvType): Promise<Entry> {
    const entry = await this.load(tx, key);
    if (entry) {
      if (entry.type !== type) throw new WrongType(key);
      return entry;
    }
    return tx.gcsKvEntry.create({ data: { key, type, value: null, expiresAt: null } });
  }

  /** O colecție rămasă goală dispare (ca în Redis). */
  private async dropIfEmpty(tx: Tx, key: string): Promise<void> {
    if ((await tx.gcsKvItem.count({ where: { key } })) === 0) await tx.gcsKvEntry.deleteMany({ where: { key } });
  }

  private async liveEntries(keys: string[]): Promise<Map<string, Entry>> {
    const rows = await this.q.gcsKvEntry.findMany({ where: { key: { in: keys } } });
    return new Map(rows.filter((r) => this.alive(r)).map((r) => [r.key, r]));
  }

  private async items(key: string, type: KvType) {
    const entry = (await this.liveEntries([key])).get(key);
    if (!entry) return null;
    if (entry.type !== type) throw new WrongType(key);
    return entry;
  }

  async get(rawKey: string) {
    const key = sqlKvKey(rawKey);
    const entry = (await this.liveEntries([key])).get(key);
    if (!entry) return null;
    if (entry.type !== "string") throw new WrongType(key);
    return entry.value;
  }

  async mget(rawKeys: string[]) {
    if (rawKeys.length === 0) return [];
    const keys = rawKeys.map(sqlKvKey);
    const live = await this.liveEntries([...new Set(keys)]);
    return keys.map((k) => {
      const e = live.get(k);
      return e && e.type === "string" ? e.value : null;
    });
  }

  async set(rawKey: string, value: string, opts: { ttlMs?: number; nx?: boolean } = {}) {
    const key = sqlKvKey(rawKey);
    const expiresAt = opts.ttlMs ? BigInt(this.now() + Math.max(1, Math.round(opts.ttlMs))) : null;
    return this.atomic([key], async (tx) => {
      const entry = await this.load(tx, key);
      if (entry && opts.nx) return false;
      if (entry && entry.type !== "string") await tx.gcsKvEntry.delete({ where: { key } });
      if (entry && entry.type === "string") await tx.gcsKvEntry.update({ where: { key }, data: { value, expiresAt } });
      else await tx.gcsKvEntry.create({ data: { key, type: "string", value, expiresAt } });
      return true;
    });
  }

  async del(...rawKeys: string[]) {
    if (rawKeys.length === 0) return 0;
    const keys = [...new Set(rawKeys.map(sqlKvKey))];
    return this.atomic(keys, async (tx) => {
      const rows = await tx.gcsKvEntry.findMany({ where: { key: { in: keys } } });
      await tx.gcsKvEntry.deleteMany({ where: { key: { in: keys } } });
      return rows.filter((r) => this.alive(r)).length;
    });
  }

  async incr(rawKey: string, by = 1) {
    const key = sqlKvKey(rawKey);
    return this.atomic([key], async (tx) => {
      const entry = await this.load(tx, key);
      if (entry && entry.type !== "string") throw new WrongType(key);
      const next = Number(entry?.value ?? 0) + by;
      if (!Number.isFinite(next)) throw new Error(`ERR value is not an integer: ${key}`);
      if (entry) await tx.gcsKvEntry.update({ where: { key }, data: { value: String(next) } });
      else await tx.gcsKvEntry.create({ data: { key, type: "string", value: String(next), expiresAt: null } });
      return next;
    });
  }

  async incrWindow(rawKey: string, windowSec: number) {
    const key = sqlKvKey(rawKey);
    return this.atomic([key], async (tx) => {
      const now = this.now();
      const entry = await this.load(tx, key);
      if (!entry) {
        await tx.gcsKvEntry.create({ data: { key, type: "string", value: "1", expiresAt: BigInt(now + windowSec * 1000) } });
        return { count: 1, ttlSec: windowSec };
      }
      const count = Number(entry.value ?? 0) + 1;
      const expiresAt = entry.expiresAt ?? BigInt(now + windowSec * 1000);
      await tx.gcsKvEntry.update({ where: { key }, data: { value: String(count), expiresAt } });
      return { count, ttlSec: Math.max(0, Math.ceil((Number(expiresAt) - now) / 1000)) };
    });
  }

  async expire(rawKey: string, ttlMs: number) {
    const key = sqlKvKey(rawKey);
    await this.atomic([key], (tx) =>
      tx.gcsKvEntry.updateMany({
        where: { key, OR: [{ expiresAt: null }, { expiresAt: { gt: BigInt(this.now()) } }] },
        data: { expiresAt: BigInt(this.now() + Math.max(1, Math.round(ttlMs))) },
      }),
    );
  }

  async expireMax(rawKey: string, ttlMs: number) {
    const key = sqlKvKey(rawKey);
    const target = BigInt(this.now() + Math.max(1, Math.round(ttlMs)));
    await this.atomic([key], (tx) =>
      tx.gcsKvEntry.updateMany({
        where: { key, OR: [{ expiresAt: null }, { expiresAt: { gt: BigInt(this.now()), lt: target } }] },
        data: { expiresAt: target },
      }),
    );
  }

  async pttl(rawKey: string) {
    const key = sqlKvKey(rawKey);
    const entry = (await this.liveEntries([key])).get(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : Math.max(0, Number(entry.expiresAt) - this.now());
  }

  async delIfEquals(rawKey: string, value: string) {
    const key = sqlKvKey(rawKey);
    return this.atomic([key], async (tx) => {
      const entry = await this.load(tx, key);
      if (!entry || entry.type !== "string" || entry.value !== value) return false;
      await tx.gcsKvEntry.delete({ where: { key } });
      return true;
    });
  }

  async hset(rawKey: string, fields: Record<string, string>) {
    const pairs = Object.entries(fields);
    if (pairs.length === 0) return;
    const key = sqlKvKey(rawKey);
    await this.atomic([key], async (tx) => {
      await this.collection(tx, key, "hash");
      for (const [field, value] of pairs) {
        await tx.gcsKvItem.upsert({ where: { key_field: { key, field } }, create: { key, field, value }, update: { value } });
      }
    });
  }

  async hgetall(rawKey: string) {
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "hash"))) return {};
    const rows = await this.q.gcsKvItem.findMany({ where: { key } });
    return Object.fromEntries(rows.map((r) => [r.field, r.value ?? ""]));
  }

  async hmget(rawKey: string, fields: string[]) {
    if (fields.length === 0) return [];
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "hash"))) return fields.map(() => null);
    const rows = await this.q.gcsKvItem.findMany({ where: { key, field: { in: fields } } });
    const map = new Map(rows.map((r) => [r.field, r.value]));
    return fields.map((f) => map.get(f) ?? null);
  }

  async hincrby(rawKey: string, field: string, by: number) {
    const key = sqlKvKey(rawKey);
    return this.atomic([key], async (tx) => {
      await this.collection(tx, key, "hash");
      const row = await tx.gcsKvItem.findUnique({ where: { key_field: { key, field } } });
      const next = Number(row?.value ?? 0) + by;
      await tx.gcsKvItem.upsert({ where: { key_field: { key, field } }, create: { key, field, value: String(next) }, update: { value: String(next) } });
      return next;
    });
  }

  async hdel(rawKey: string, fields: string[]) {
    if (fields.length === 0) return;
    const key = sqlKvKey(rawKey);
    await this.atomic([key], async (tx) => {
      if (!(await this.load(tx, key))) return;
      await tx.gcsKvItem.deleteMany({ where: { key, field: { in: fields } } });
      await this.dropIfEmpty(tx, key);
    });
  }

  async hsetMax(rawKey: string, field: string, value: number) {
    const key = sqlKvKey(rawKey);
    return this.atomic([key], async (tx) => {
      await this.collection(tx, key, "hash");
      const row = await tx.gcsKvItem.findUnique({ where: { key_field: { key, field } } });
      if (value <= Number(row?.value ?? 0)) return false;
      await tx.gcsKvItem.upsert({ where: { key_field: { key, field } }, create: { key, field, value: String(value) }, update: { value: String(value) } });
      return true;
    });
  }

  async zadd(rawKey: string, score: number, member: string) {
    const key = sqlKvKey(rawKey);
    await this.atomic([key], async (tx) => {
      await this.collection(tx, key, "zset");
      await tx.gcsKvItem.upsert({ where: { key_field: { key, field: member } }, create: { key, field: member, score }, update: { score } });
    });
  }

  async zrem(rawKey: string, members: string[]) {
    if (members.length === 0) return;
    const key = sqlKvKey(rawKey);
    await this.atomic([key], async (tx) => {
      if (!(await this.load(tx, key))) return;
      await tx.gcsKvItem.deleteMany({ where: { key, field: { in: members } } });
      await this.dropIfEmpty(tx, key);
    });
  }

  private scoreRange(min: number, max: number, maxExclusive = false): Prisma.FloatNullableFilter {
    const range: Prisma.FloatNullableFilter = {};
    if (min !== -Infinity) range.gte = min;
    if (max !== Infinity) range[maxExclusive ? "lt" : "lte"] = max;
    return range;
  }

  async zrangeByScore(rawKey: string, min: number, max: number, opts: { rev?: boolean; maxExclusive?: boolean } = {}) {
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "zset"))) return [];
    const dir = opts.rev ? "desc" : "asc";
    const rows = await this.q.gcsKvItem.findMany({
      where: { key, score: this.scoreRange(min, max, opts.maxExclusive) },
      orderBy: [{ score: dir }, { field: dir }],
      select: { field: true },
    });
    return rows.map((r) => r.field);
  }

  async zcount(rawKey: string, min: number, max: number) {
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "zset"))) return 0;
    return this.q.gcsKvItem.count({ where: { key, score: this.scoreRange(min, max) } });
  }

  async zremRangeByScore(rawKey: string, min: number, max: number, opts: { maxExclusive?: boolean } = {}) {
    const key = sqlKvKey(rawKey);
    return this.atomic([key], async (tx) => {
      if (!(await this.load(tx, key))) return 0;
      const { count } = await tx.gcsKvItem.deleteMany({ where: { key, score: this.scoreRange(min, max, opts.maxExclusive) } });
      await this.dropIfEmpty(tx, key);
      return count;
    });
  }

  async zcard(rawKey: string) {
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "zset"))) return 0;
    return this.q.gcsKvItem.count({ where: { key } });
  }

  async sadd(rawKey: string, members: string[]) {
    if (members.length === 0) return;
    const key = sqlKvKey(rawKey);
    await this.atomic([key], async (tx) => {
      await this.collection(tx, key, "set");
      await tx.gcsKvItem.createMany({ data: [...new Set(members)].map((field) => ({ key, field })), skipDuplicates: true });
    });
  }

  async smembers(rawKey: string) {
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "set"))) return [];
    const rows = await this.q.gcsKvItem.findMany({ where: { key }, select: { field: true } });
    return rows.map((r) => r.field);
  }

  async listPush(rawKey: string, value: string, maxLen: number) {
    const key = sqlKvKey(rawKey);
    await this.atomic([key], async (tx) => {
      const entry = await this.collection(tx, key, "list");
      // `value` al antetului ține numărul de ordine al ultimului element (cel mai mare = cel mai nou).
      const seq = Number(entry.value ?? 0) + 1;
      await tx.gcsKvEntry.update({ where: { key }, data: { value: String(seq) } });
      await tx.gcsKvItem.create({ data: { key, field: String(seq).padStart(15, "0"), value, score: seq } });
      await tx.gcsKvItem.deleteMany({ where: { key, score: { lte: seq - maxLen } } });
    });
  }

  async listRange(rawKey: string, count: number) {
    const key = sqlKvKey(rawKey);
    if (!(await this.items(key, "list"))) return [];
    const rows = await this.q.gcsKvItem.findMany({ where: { key }, orderBy: { score: "desc" }, take: count, select: { value: true } });
    return rows.map((r) => r.value ?? "");
  }

  async keys(prefix: string) {
    const rows = await this.q.gcsKvEntry.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, expiresAt: true, type: true, value: true } });
    return rows.filter((r) => this.alive(r)).map((r) => r.key);
  }

  async delPrefix(prefix: string) {
    const { count } = await this.q.gcsKvEntry.deleteMany({ where: { key: { startsWith: prefix } } });
    return count;
  }

  async flushAll() {
    await this.q.gcsKvItem.deleteMany({});
    await this.q.gcsKvEntry.deleteMany({});
  }

  async ping() {
    await this.q.$queryRawUnsafe("SELECT 1");
    return true;
  }

  disconnect() {}

  async script<R>(script: GcsKvScript<R>, rawKeys: string[], args: (string | number)[]): Promise<R> {
    const keys = rawKeys.map(sqlKvKey);
    const strArgs = args.map(String);
    if (this.opts.tx) return script.run(this, rawKeys, strArgs);
    return withRetry(() =>
      this.db.$transaction(
        async (tx) => {
          await lockStripes(tx, keys);
          return script.run(new GcsSqlKv(this.db, { ...this.opts, tx }), rawKeys, strArgs);
        },
        { maxWait: 15_000, timeout: 30_000 },
      ),
    );
  }

  /** Curățenia: șterge cheile expirate (elementele lor se șterg în cascadă). */
  async sweep(): Promise<number> {
    const { count } = await this.db.gcsKvEntry.deleteMany({ where: { expiresAt: { lte: BigInt(this.now()) } } });
    return count;
  }
}

/** Deadlock (PostgreSQL 40P01, MySQL 1213) sau conflict de serializare: tranzacția oprită de bază se poate relua. */
export function isRetryableTxError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; meta?: { code?: string } } | null;
  if (!e) return false;
  if (e.code === "P2034") return true;
  const text = `${e.meta?.code ?? ""} ${e.message ?? ""}`;
  return /40P01|40001|deadlock|1213|Deadlock found|write conflict/i.test(text);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts || !isRetryableTxError(error)) throw error;
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 40));
    }
  }
}

/** Blochează benzile cheilor (create la nevoie; `TRUNCATE`-ul testelor le poate goli). */
async function lockStripes(tx: Tx, keys: string[]): Promise<void> {
  const stripes = [...new Set(keys.map(stripeOf))].sort((a, b) => a - b);
  if (stripes.length === 0) return;
  const select = `SELECT stripe FROM gcs_kv_locks WHERE stripe IN (${stripes.join(",")}) ORDER BY stripe FOR UPDATE`;
  const rows = await tx.$queryRawUnsafe<{ stripe: number }[]>(select);
  if (rows.length === stripes.length) return;
  await tx.gcsKvLock.createMany({ data: stripes.map((stripe) => ({ stripe })), skipDuplicates: true });
  await tx.$queryRawUnsafe(select);
}
