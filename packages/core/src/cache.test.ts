import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testKv } from "../test/kv";
import { GcsCache } from "./cache";

const kv = testKv();
const cache = new GcsCache(kv);

beforeEach(async () => {
  await kv.flushAll();
});

afterAll(async () => {
  kv.disconnect();
});

describe("GcsCache", () => {
  test("set + get pe Redis real", async () => {
    await cache.set("user:1", { name: "Krypt", groups: [3, 9] }, { ttlSec: 60, tags: ["user:1"] });
    await expect(cache.get("user:1")).resolves.toEqual({ name: "Krypt", groups: [3, 9] });
  });

  test("o cheie inexistentă întoarce null", async () => {
    await expect(cache.get("lipsa")).resolves.toBeNull();
  });

  test("getMany: mai multe chei dintr-o citire, în ordine, cu null pentru cele lipsă; invalidarea pe tag-uri rămâne", async () => {
    await expect(cache.getMany([])).resolves.toEqual([]);
    await cache.set("m:1", { a: 1 }, { ttlSec: 60, tags: ["topic:1"] });
    await cache.set("m:3", "trei", { ttlSec: 60, tags: ["topic:3"] });
    await expect(cache.getMany(["m:1", "m:2", "m:3"])).resolves.toEqual([{ a: 1 }, null, "trei"]);
    await cache.invalidateTags(["topic:3"]);
    await expect(cache.getMany(["m:3", "m:1"])).resolves.toEqual([null, { a: 1 }]);
  });

  test("getMany ține minte ratările: o valoare citită înaintea unei invalidări nu se mai scrie", async () => {
    let clock = 2_000_000;
    const c = new GcsCache(kv, "cursaMulti", () => clock);
    await expect(c.getMany(["p:1"])).resolves.toEqual([null]);
    clock += 10;
    await c.invalidateTags(["topic:1"]);
    clock += 10;
    await c.set("p:1", "vechi", { ttlSec: 60, tags: ["topic:1"] });
    await expect(c.get("p:1")).resolves.toBeNull();
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

  test("două citiri ratate în paralel, cu o invalidare între ele: valoarea veche nu ajunge în cache, oricare scrie întâi", async () => {
    let clock = 1_000_000;
    const c = new GcsCache(kv, "cursa", () => clock);
    await expect(c.get("apps")).resolves.toBeNull(); // A citește din bază: valoarea veche
    clock += 10;
    await c.invalidateTags(["apps"]);
    clock += 10;
    await expect(c.get("apps")).resolves.toBeNull(); // B citește după invalidare: valoarea nouă
    clock += 10;
    await c.set("apps", "nou", { ttlSec: 60, tags: ["apps"] }); // B scrie primul (refuzat, prudent: nu știm care e)
    await c.set("apps", "vechi", { ttlSec: 60, tags: ["apps"] }); // A scrie după: refuzat
    await expect(c.get("apps")).resolves.not.toBe("vechi");
    clock += 10;
    await c.set("apps", "nou", { ttlSec: 60, tags: ["apps"] }); // o citire nouă, după invalidare: se scrie
    await expect(c.get("apps")).resolves.toBe("nou");
  });

  test("prefixul separă două cache-uri pe același Redis", async () => {
    const other = new GcsCache(kv, "altul");
    await cache.set("k", "gcs", { ttlSec: 60, tags: ["t"] });
    await other.set("k", "altul", { ttlSec: 60, tags: ["t"] });
    await other.invalidateTags(["t"]);
    await expect(cache.get("k")).resolves.toBe("gcs");
    await expect(other.get("k")).resolves.toBeNull();
  });
});
