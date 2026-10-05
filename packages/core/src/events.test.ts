import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { testRedis } from "../test/redis";
import { GcsCache } from "./cache";
import { GcsEventBus, type GcsEvent } from "./events";

const redis = testRedis();
const cache = new GcsCache(redis);

const event: GcsEvent = { name: "group.updated", payload: { groupId: 5 }, tags: ["group:5"] };

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  redis.disconnect();
});

describe("GcsEventBus", () => {
  test("emit invalidează tag-urile din cache", async () => {
    await cache.set("perm:1", true, { ttlSec: 60, tags: ["group:5"] });
    await new GcsEventBus({ cache }).emit(event);
    await expect(cache.get("perm:1")).resolves.toBeNull();
  });

  test("emit apelează revalidate('group:5')", async () => {
    const revalidate = vi.fn();
    await new GcsEventBus({ cache, revalidate }).emit(event);
    expect(revalidate).toHaveBeenCalledWith("group:5");
  });

  test("listenerii rulează în ordinea înregistrării; o eroare nu oprește următorul listener", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    const bus = new GcsEventBus({ cache });
    bus.on("group.updated", async () => {
      calls.push("primul");
      throw new Error("boom");
    });
    bus.on("group.updated", async () => {
      calls.push("al doilea");
    });
    bus.on("altceva", async () => {
      calls.push("nu trebuie");
    });

    await bus.emit(event);

    expect(calls).toEqual(["primul", "al doilea"]);
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  test("publish primește exact evenimentul emis, după listeneri", async () => {
    const order: string[] = [];
    const publish = vi.fn(async () => {
      order.push("publish");
    });
    const bus = new GcsEventBus({ cache, publish });
    bus.on("group.updated", async () => {
      order.push("listener");
    });

    await bus.emit(event);

    expect(publish).toHaveBeenCalledExactlyOnceWith(event);
    expect(order).toEqual(["listener", "publish"]);
  });
});
