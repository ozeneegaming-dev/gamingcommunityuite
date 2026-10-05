import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRedis } from "../test/redis";
import { GcsCache } from "./cache";

const redis = testRedis();
const cache = new GcsCache(redis);

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  redis.disconnect();
});

describe("GcsCache", () => {
  test("set + get pe Redis real", async () => {
    await cache.set("user:1", { name: "Krypt", groups: [3, 9] }, { ttlSec: 60, tags: ["user:1"] });
    await expect(cache.get("user:1")).resolves.toEqual({ name: "Krypt", groups: [3, 9] });
  });

  test("o cheie inexistentă întoarce null", async () => {
    await expect(cache.get("lipsa")).resolves.toBeNull();
  });

  test("invalidateTags(['group:5']) șterge doar cheile etichetate group:5", async () => {
    await cache.set("a", 1, { ttlSec: 60, tags: ["group:5"] });
    await cache.set("b", 2, { ttlSec: 60, tags: ["group:5", "group:6"] });
    await cache.set("c", 3, { ttlSec: 60, tags: ["group:6"] });
    await cache.set("d", 4, { ttlSec: 60, tags: [] });

    await cache.invalidateTags(["group:5"]);

    await expect(cache.get("a")).resolves.toBeNull();
    await expect(cache.get("b")).resolves.toBeNull();
    await expect(cache.get("c")).resolves.toBe(3);
    await expect(cache.get("d")).resolves.toBe(4);
  });

  test("după TTL, get întoarce null", async () => {
    await cache.set("scurt", "x", { ttlSec: 1, tags: ["t"] });
    await expect(cache.get("scurt")).resolves.toBe("x");
    await new Promise((r) => setTimeout(r, 1200));
    await expect(cache.get("scurt")).resolves.toBeNull();
  });

  test("prefixul separă două cache-uri pe același Redis", async () => {
    const other = new GcsCache(redis, "altul");
    await cache.set("k", "gcs", { ttlSec: 60, tags: ["t"] });
    await other.set("k", "altul", { ttlSec: 60, tags: ["t"] });
    await other.invalidateTags(["t"]);
    await expect(cache.get("k")).resolves.toBe("gcs");
    await expect(other.get("k")).resolves.toBeNull();
  });
});
