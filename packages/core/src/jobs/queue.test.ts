import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { testKv } from "../../test/kv";
import { WORKER_STALE_MS, workerStatus, writeWorkerHeartbeat } from "./heartbeat";
import { debouncedJobId, GcsBullJobQueue } from "./queue";

let queue: GcsBullJobQueue;
let stop: (() => Promise<void>) | undefined;

function redisUrl(): string {
  const url = new URL(inject("redisUrl"));
  url.pathname = `/${process.env.VITEST_POOL_ID ?? "1"}`;
  return url.toString();
}

beforeEach(() => {
  // O coadă cu nume unic pe test: joburile altor teste nu se amestecă.
  queue = new GcsBullJobQueue({ redisUrl: redisUrl(), name: `test-${randomUUID()}` });
});

afterEach(async () => {
  await stop?.();
  stop = undefined;
  await queue.close();
});

function until(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error("timeout"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe("GcsJobQueue", () => {
  test("un handler înregistrat primește datele jobului", async () => {
    const seen: unknown[] = [];
    queue.register({ name: "echo", handler: async (data) => void seen.push(data) });
    stop = await queue.start();
    await queue.enqueue("echo", { userId: "u1" });
    await until(() => seen.length === 1);
    expect(seen).toEqual([{ userId: "u1" }]);
  });

  test("același jobId adăugat de două ori cât timp așteaptă → un singur job", async () => {
    let runs = 0;
    queue.register({ name: "count", handler: async () => void runs++ });
    await queue.enqueue("count", {}, { jobId: "count-u1", delayMs: 300 });
    await queue.enqueue("count", {}, { jobId: "count-u1", delayMs: 300 });
    stop = await queue.start();
    await until(() => runs >= 1);
    await new Promise((r) => setTimeout(r, 700));
    expect(runs).toBe(1);
  });

  test("un job care eșuează e reîncercat până reușește", async () => {
    let attempts = 0;
    queue.register({
      name: "flaky",
      handler: async () => {
        attempts++;
        if (attempts < 3) throw new Error("încă nu");
      },
    });
    stop = await queue.start();
    await queue.enqueue("flaky");
    // Backoff exponențial de 2 s: a doua încercare la ~2 s, a treia la ~4 s după aceea.
    await until(() => attempts === 3, 20_000);
    expect(attempts).toBe(3);
  }, 30_000);

  test("un job repetabil (everyMs) rulează fără să fie adăugat manual", async () => {
    let runs = 0;
    queue.register({ name: "tick", everyMs: 200, handler: async () => void runs++ });
    stop = await queue.start();
    await until(() => runs >= 2);
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  test("două joburi cu același nume nu se pot înregistra", () => {
    queue.register({ name: "x", handler: async () => {} });
    expect(() => queue.register({ name: "x", handler: async () => {} })).toThrow();
  });
});

describe("debouncedJobId", () => {
  test("aceeași fereastră → aceeași cheie; fereastra următoare → altă cheie", () => {
    expect(debouncedJobId("ach-u1", 2000, 10_000)).toBe(debouncedJobId("ach-u1", 2000, 11_999));
    expect(debouncedJobId("ach-u1", 2000, 10_000)).not.toBe(debouncedJobId("ach-u1", 2000, 12_000));
  });
});

describe("heartbeat-ul worker-ului", () => {
  test("fără heartbeat → oprit; după unul → pornit; după 10 minute fără → oprit", async () => {
    const kv = testKv();
    await kv.flushAll();
    expect(await workerStatus(kv)).toEqual({ up: false, lastBeatAt: null });
    const now = Date.now();
    await writeWorkerHeartbeat(kv, now);
    expect(await workerStatus(kv, now + 1000)).toMatchObject({ up: true });
    expect(await workerStatus(kv, now + WORKER_STALE_MS + 1)).toMatchObject({ up: false });
  });
});
