import type Redis from "ioredis";
import type { GcsKv, GcsKvScript } from "./kv";

const INCR_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}`;

const EXPIRE_MAX = `
local t = redis.call('PTTL', KEYS[1])
if t == -1 or (t >= 0 and tonumber(ARGV[1]) > t) then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return 1`;

const DEL_IF_EQUALS = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

const HSET_MAX = `
local c = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if tonumber(ARGV[2]) > c then redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) return 1 end
return 0`;

const bound = (n: number, exclusive = false) => (n === Infinity ? "+inf" : n === -Infinity ? "-inf" : `${exclusive ? "(" : ""}${n}`);

/** `GcsKv` peste Redis (ediția VPS): comenzile se traduc unu la unu, operațiile compuse sunt scripturi Lua. */
export class GcsRedisKv implements GcsKv {
  readonly driver = "redis" as const;

  constructor(readonly redis: Redis) {}

  get(key: string) {
    return this.redis.get(key);
  }

  async mget(keys: string[]) {
    return keys.length === 0 ? [] : this.redis.mget(...keys);
  }

  async set(key: string, value: string, opts: { ttlMs?: number; nx?: boolean } = {}) {
    const args: (string | number)[] = [];
    if (opts.ttlMs) args.push("PX", Math.max(1, Math.round(opts.ttlMs)));
    if (opts.nx) args.push("NX");
    const result = await (this.redis.set as unknown as (...a: (string | number)[]) => Promise<string | null>).call(this.redis, key, value, ...args);
    return result === "OK";
  }

  async del(...keys: string[]) {
    return keys.length === 0 ? 0 : this.redis.del(...keys);
  }

  incr(key: string, by = 1) {
    return by === 1 ? this.redis.incr(key) : this.redis.incrby(key, by);
  }

  async incrWindow(key: string, windowSec: number) {
    const [count, ttlSec] = (await this.redis.eval(INCR_WINDOW, 1, key, windowSec)) as [number, number];
    return { count, ttlSec };
  }

  async expire(key: string, ttlMs: number) {
    await this.redis.pexpire(key, Math.max(1, Math.round(ttlMs)));
  }

  async expireMax(key: string, ttlMs: number) {
    await this.redis.eval(EXPIRE_MAX, 1, key, Math.max(1, Math.round(ttlMs)));
  }

  pttl(key: string) {
    return this.redis.pttl(key);
  }

  async delIfEquals(key: string, value: string) {
    return Number(await this.redis.eval(DEL_IF_EQUALS, 1, key, value)) > 0;
  }

  async hset(key: string, fields: Record<string, string>) {
    if (Object.keys(fields).length > 0) await this.redis.hset(key, fields);
  }

  hgetall(key: string) {
    return this.redis.hgetall(key);
  }

  async hmget(key: string, fields: string[]) {
    return fields.length === 0 ? [] : this.redis.hmget(key, ...fields);
  }

  hincrby(key: string, field: string, by: number) {
    return this.redis.hincrby(key, field, by);
  }

  async hdel(key: string, fields: string[]) {
    if (fields.length > 0) await this.redis.hdel(key, ...fields);
  }

  async hsetMax(key: string, field: string, value: number) {
    return Number(await this.redis.eval(HSET_MAX, 1, key, field, value)) > 0;
  }

  async zadd(key: string, score: number, member: string) {
    await this.redis.zadd(key, score, member);
  }

  async zrem(key: string, members: string[]) {
    if (members.length > 0) await this.redis.zrem(key, ...members);
  }

  zrangeByScore(key: string, min: number, max: number, opts: { rev?: boolean; maxExclusive?: boolean } = {}) {
    const hi = bound(max, opts.maxExclusive);
    const lo = bound(min);
    return opts.rev ? this.redis.zrevrangebyscore(key, hi, lo) : this.redis.zrangebyscore(key, lo, hi);
  }

  zcount(key: string, min: number, max: number) {
    return this.redis.zcount(key, bound(min), bound(max));
  }

  zremRangeByScore(key: string, min: number, max: number, opts: { maxExclusive?: boolean } = {}) {
    return this.redis.zremrangebyscore(key, bound(min), bound(max, opts.maxExclusive));
  }

  zcard(key: string) {
    return this.redis.zcard(key);
  }

  async sadd(key: string, members: string[]) {
    if (members.length > 0) await this.redis.sadd(key, ...members);
  }

  smembers(key: string) {
    return this.redis.smembers(key);
  }

  async listPush(key: string, value: string, maxLen: number) {
    await this.redis.multi().lpush(key, value).ltrim(key, 0, maxLen - 1).exec();
  }

  listRange(key: string, count: number) {
    return this.redis.lrange(key, 0, count - 1);
  }

  async keys(prefix: string) {
    const out: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", `${prefix.replace(/[*?[\]\\]/g, "\\$&")}*`, "COUNT", 500);
      out.push(...batch);
      cursor = next;
    } while (cursor !== "0");
    return out;
  }

  async delPrefix(prefix: string) {
    const keys = await this.keys(prefix);
    let removed = 0;
    for (let i = 0; i < keys.length; i += 500) removed += await this.redis.del(...keys.slice(i, i + 500));
    return removed;
  }

  async flushAll() {
    await this.redis.flushdb();
  }

  async ping() {
    return (await this.redis.ping()) === "PONG";
  }

  disconnect() {
    this.redis.disconnect();
  }

  async script<R>(script: GcsKvScript<R>, keys: string[], args: (string | number)[]): Promise<R> {
    const raw = await this.redis.eval(script.lua, keys.length, ...keys, ...args.map(String));
    return script.fromRedis ? script.fromRedis(raw) : (raw as R);
  }
}
