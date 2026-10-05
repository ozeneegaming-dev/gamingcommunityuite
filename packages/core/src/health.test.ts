import { afterEach, describe, expect, test, vi } from "vitest";
import { checkHealth, type GcsHealthDb, type GcsHealthRedis } from "./health";

const okDb: GcsHealthDb = { $queryRawUnsafe: async () => [{ "?column?": 1 }] };
const okRedis: GcsHealthRedis = { ping: async () => "PONG" };

describe("checkHealth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("ambele dependențe răspund → ok", async () => {
    await expect(checkHealth({ db: okDb, redis: okRedis })).resolves.toEqual({
      status: "ok",
      db: true,
      redis: true,
    });
  });

  test("redis.ping aruncă eroare → degraded, redis:false", async () => {
    const redis: GcsHealthRedis = {
      ping: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    await expect(checkHealth({ db: okDb, redis })).resolves.toEqual({
      status: "degraded",
      db: true,
      redis: false,
    });
  });

  test("query-ul DB depășește 2 s → db:false", async () => {
    vi.useFakeTimers();
    const db: GcsHealthDb = { $queryRawUnsafe: () => new Promise<unknown>(() => {}) };
    const pending = checkHealth({ db, redis: okRedis });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ status: "degraded", db: false, redis: true });
  });
});
