import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { bothKvs } from "../../test/kv";
import { GcsCache } from "../cache";
import { GcsRateLimiter } from "../auth/rateLimit";
import { defineKvScript } from "./kv";
import { GcsLock } from "./lock";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const drivers = bothKvs();

afterAll(async () => {
  for (const d of drivers) d.kv().disconnect();
  await testDb().$disconnect();
});

/** Același contract pentru ambele drivere: ediția VPS (Redis) și ediția Lite (SQL) trebuie să se poarte la fel. */
describe.each(drivers)("GcsKv pe $name", ({ name, kv: getKv }) => {
  const kv = () => getKv();

  beforeEach(async () => {
    if (name === "sql") await truncateAll(testDb());
    await kv().flushAll();
  });

  test("get / set / mget / del", async () => {
    expect(await kv().get("a")).toBeNull();
    expect(await kv().set("a", "1")).toBe(true);
    await kv().set("b", "2");
    expect(await kv().get("a")).toBe("1");
    expect(await kv().mget(["a", "lipsa", "b"])).toEqual(["1", null, "2"]);
    expect(await kv().del("a", "lipsa")).toBe(1);
    expect(await kv().get("a")).toBeNull();
  });

  test("set NX scrie doar prima dată; după expirare din nou", async () => {
    expect(await kv().set("nx", "x", { nx: true, ttlMs: 150 })).toBe(true);
    expect(await kv().set("nx", "y", { nx: true })).toBe(false);
    expect(await kv().get("nx")).toBe("x");
    await sleep(250);
    expect(await kv().get("nx")).toBeNull();
    expect(await kv().set("nx", "z", { nx: true })).toBe(true);
  });

  test("set NX concurent: un singur câștigător", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => kv().set("race", String(i), { nx: true, ttlMs: 10_000 })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("incr păstrează expirarea; incrWindow pornește fereastra la primul", async () => {
    expect(await kv().incr("c")).toBe(1);
    expect(await kv().incr("c", 4)).toBe(5);
    await kv().expire("c", 60_000);
    await kv().incr("c");
    expect(await kv().pttl("c")).toBeGreaterThan(50_000);
    expect(await kv().pttl("lipsa")).toBe(-2);
    await kv().set("fara", "1");
    expect(await kv().pttl("fara")).toBe(-1);

    expect(await kv().incrWindow("w", 60)).toEqual({ count: 1, ttlSec: 60 });
    const second = await kv().incrWindow("w", 60);
    expect(second.count).toBe(2);
    expect(second.ttlSec).toBeGreaterThan(55);
  });

  test("incr concurent nu pierde incrementări", async () => {
    await Promise.all(Array.from({ length: 15 }, () => kv().incr("par")));
    expect(await kv().get("par")).toBe("15");
  });

  test("delIfEquals șterge doar valoarea proprie", async () => {
    await kv().set("lock", "eu");
    expect(await kv().delIfEquals("lock", "altul")).toBe(false);
    expect(await kv().delIfEquals("lock", "eu")).toBe(true);
    expect(await kv().get("lock")).toBeNull();
  });

  test("expireMax doar prelungește", async () => {
    await kv().set("e", "1");
    await kv().expireMax("e", 10_000);
    expect(await kv().pttl("e")).toBeGreaterThan(9_000);
    await kv().expireMax("e", 1_000);
    expect(await kv().pttl("e")).toBeGreaterThan(9_000);
    await kv().expireMax("e", 60_000);
    expect(await kv().pttl("e")).toBeGreaterThan(50_000);
    await kv().expireMax("lipsa", 1000);
    expect(await kv().pttl("lipsa")).toBe(-2);
  });

  test("hash: hset, hgetall, hmget, hincrby, hdel, hsetMax", async () => {
    await kv().hset("h", { a: "1", b: "2" });
    expect(await kv().hgetall("h")).toEqual({ a: "1", b: "2" });
    expect(await kv().hmget("h", ["b", "x"])).toEqual(["2", null]);
    expect(await kv().hincrby("h", "a", 5)).toBe(6);
    expect(await kv().hincrby("h", "nou", 2)).toBe(2);
    await kv().hdel("h", ["b"]);
    expect(await kv().hgetall("h")).toEqual({ a: "6", nou: "2" });
    expect(await kv().hsetMax("h", "max", 10)).toBe(true);
    expect(await kv().hsetMax("h", "max", 7)).toBe(false);
    expect(await kv().hsetMax("h", "max", 12)).toBe(true);
    expect((await kv().hgetall("h")).max).toBe("12");
    expect(await kv().hgetall("lipsa")).toEqual({});
    await kv().hdel("h", ["a", "nou", "max"]);
    expect(await kv().pttl("h")).toBe(-2);
  });

  test("sorted set: ordine, intervale, exclusiv, ștergere", async () => {
    await kv().zadd("z", 30, "c");
    await kv().zadd("z", 10, "a");
    await kv().zadd("z", 20, "b");
    await kv().zadd("z", 20, "b2");
    expect(await kv().zrangeByScore("z", -Infinity, Infinity)).toEqual(["a", "b", "b2", "c"]);
    expect(await kv().zrangeByScore("z", 20, Infinity, { rev: true })).toEqual(["c", "b2", "b"]);
    expect(await kv().zrangeByScore("z", -Infinity, 20, { maxExclusive: true })).toEqual(["a"]);
    expect(await kv().zcount("z", 15, 30)).toBe(3);
    expect(await kv().zcard("z")).toBe(4);
    await kv().zadd("z", 5, "c");
    expect(await kv().zrangeByScore("z", -Infinity, Infinity)).toEqual(["c", "a", "b", "b2"]);
    expect(await kv().zremRangeByScore("z", -Infinity, 20, { maxExclusive: true })).toBe(2);
    await kv().zrem("z", ["b"]);
    expect(await kv().zrangeByScore("z", -Infinity, Infinity)).toEqual(["b2"]);
  });

  test("set și listă scurtă", async () => {
    await kv().sadd("s", ["x", "y", "x"]);
    expect((await kv().smembers("s")).sort()).toEqual(["x", "y"]);
    for (let i = 1; i <= 5; i++) await kv().listPush("l", `m${i}`, 3);
    expect(await kv().listRange("l", 10)).toEqual(["m5", "m4", "m3"]);
    expect(await kv().listRange("l", 2)).toEqual(["m5", "m4"]);
  });

  test("expirarea se aplică și colecțiilor", async () => {
    await kv().hset("he", { a: "1" });
    await kv().expire("he", 150);
    await sleep(250);
    expect(await kv().hgetall("he")).toEqual({});
    await kv().hset("he", { b: "2" });
    expect(await kv().hgetall("he")).toEqual({ b: "2" });
    expect(await kv().pttl("he")).toBe(-1);
  });

  test("keys / delPrefix", async () => {
    await kv().set("gcs:k:a", "1");
    await kv().hset("gcs:k:b", { f: "1" });
    await kv().set("gcs:x", "1");
    expect((await kv().keys("gcs:k:")).sort()).toEqual(["gcs:k:a", "gcs:k:b"]);
    expect(await kv().delPrefix("gcs:k:")).toBe(2);
    expect(await kv().keys("gcs:")).toEqual(["gcs:x"]);
  });

  test("o cheie foarte lungă funcționează", async () => {
    const key = `gcs:k:${"x".repeat(400)}`;
    await kv().set(key, "lung");
    expect(await kv().get(key)).toBe("lung");
    expect(await kv().keys("gcs:k:")).toHaveLength(1);
  });

  test("script: aceeași operație compusă, atomic, pe ambele drivere", async () => {
    const swap = defineKvScript<number>({
      lua: "local v = tonumber(redis.call('GET', KEYS[1]) or '0') + tonumber(ARGV[1]); redis.call('SET', KEYS[1], v); redis.call('HSET', KEYS[2], 'last', v); return v",
      run: async (k, [a, b], [by]) => {
        const v = Number((await k.get(a!)) ?? 0) + Number(by);
        await k.set(a!, String(v));
        await k.hset(b!, { last: String(v) });
        return v;
      },
      fromRedis: Number,
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => kv().script(swap, ["sc", "sch"], [2])));
    expect(results.sort((x, y) => x - y)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(await kv().hgetall("sch")).toEqual({ last: "20" });
  });

  test("GcsCache: tag-urile invalidează doar cheile lor", async () => {
    const cache = new GcsCache(kv());
    await cache.set("a", { x: 1 }, { ttlSec: 60, tags: ["g:5"] });
    await cache.set("b", 2, { ttlSec: 60, tags: ["g:5", "g:6"] });
    await cache.set("c", 3, { ttlSec: 60, tags: ["g:6"] });
    expect(await cache.get("a")).toEqual({ x: 1 });
    await cache.invalidateTags(["g:5"]);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("c")).toBe(3);
    await cache.clear();
    expect(await cache.get("c")).toBeNull();
  });

  test("GcsRateLimiter și GcsLock", async () => {
    const limiter = new GcsRateLimiter(kv());
    const rule = { window: 60, max: 2 };
    expect((await limiter.consume("k", rule)).allowed).toBe(true);
    expect((await limiter.consume("k", rule)).allowed).toBe(true);
    const third = await limiter.consume("k", rule);
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(50);
    await limiter.reset("k");
    expect((await limiter.consume("k", rule)).allowed).toBe(true);

    const lock = new GcsLock(kv());
    const token = await lock.acquire("job", 10_000);
    expect(token).toBeTruthy();
    expect(await lock.acquire("job", 10_000)).toBeNull();
    expect(await lock.withLock("job", 1000, async () => "rulat")).toBeNull();
    await lock.release("job", token!);
    expect(await lock.withLock("job", 1000, async () => "rulat")).toBe("rulat");
    expect(await lock.once("zi", 10_000)).toBe(true);
    expect(await lock.once("zi", 10_000)).toBe(false);
  });
});
