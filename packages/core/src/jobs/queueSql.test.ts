import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { nextCronTime } from "./cron";
import { GcsSqlJobQueue } from "./queueSql";

const db = testDb();
let now = 1_000_000;
const clock = () => now;

beforeEach(async () => {
  await truncateAll(db);
  now = 1_000_000;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GcsSqlJobQueue (ediția Lite)", () => {
  test("un job adăugat rulează la runDue, cu datele lui, și dispare", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    const seen: unknown[] = [];
    queue.register({ name: "echo", handler: async (data) => void seen.push(data) });
    await queue.enqueue("echo", { userId: "u1" });
    const report = await queue.runDue();
    expect(seen).toEqual([{ userId: "u1" }]);
    expect(report).toMatchObject({ ran: 1, failed: 0, pending: 0 });
    expect(await db.gcsJob.count()).toBe(0);
  });

  test("același jobId cât timp așteaptă → un singur job; delayMs amână rularea", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let runs = 0;
    queue.register({ name: "count", handler: async () => void runs++ });
    await queue.enqueue("count", {}, { jobId: "count-u1", delayMs: 300 });
    await queue.enqueue("count", {}, { jobId: "count-u1", delayMs: 300 });
    await queue.runDue();
    expect(runs).toBe(0);
    now += 301;
    await queue.runDue();
    expect(runs).toBe(1);
    // După ce a rulat, aceeași cheie se poate adăuga din nou.
    await queue.enqueue("count", {}, { jobId: "count-u1" });
    await queue.runDue();
    expect(runs).toBe(2);
  });

  test("același jobId adăugat în timp ce jobul rulează → încă o rulare după el (nu se pierde)", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let runs = 0;
    queue.register({
      name: "t.debounced",
      handler: async () => {
        runs++;
        // Ca evaluarea realizărilor: o postare nouă vine cât rulează evaluarea pentru cea de dinainte.
        if (runs === 1) await queue.enqueue("t.debounced", {}, { jobId: "ach-u1-0" });
      },
    });
    await queue.enqueue("t.debounced", {}, { jobId: "ach-u1-0" });
    await queue.runDue();
    expect(runs).toBe(2);
  });

  test("un job care eșuează e reîncercat cu backoff exponențial, apoi rămâne „failed” după 5 încercări", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let attempts = 0;
    queue.register({
      name: "flaky",
      handler: async () => {
        attempts++;
        throw new Error("încă nu");
      },
    });
    await queue.enqueue("flaky");
    const errors: string[] = [];
    for (const wait of [0, 2000, 4000, 8000, 16000]) {
      now += wait;
      await queue.runDue({ onError: (name) => void errors.push(name) });
    }
    expect(attempts).toBe(5);
    expect(errors).toHaveLength(5);
    const row = await db.gcsJob.findFirstOrThrow();
    expect(row).toMatchObject({ status: "failed", attempts: 5, lastError: "încă nu" });
    now += 100_000;
    await queue.runDue();
    expect(attempts).toBe(5);
  });

  test("un job reușește la a doua încercare, după backoff", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let attempts = 0;
    queue.register({
      name: "once",
      handler: async () => {
        attempts++;
        if (attempts < 2) throw new Error("x");
      },
    });
    await queue.enqueue("once");
    await queue.runDue();
    now += 1999;
    await queue.runDue();
    expect(attempts).toBe(1);
    now += 1;
    await queue.runDue();
    expect(attempts).toBe(2);
    expect(await db.gcsJob.count()).toBe(0);
  });

  test("un job repetabil (everyMs) rulează o dată pe fereastră, fără restanțe după o pauză lungă", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let runs = 0;
    queue.register({ name: "tick", everyMs: 60_000, handler: async () => void runs++ });
    await queue.runDue();
    expect(runs).toBe(1);
    await queue.runDue();
    expect(runs).toBe(1);
    now += 60_000;
    await queue.runDue();
    expect(runs).toBe(2);
    // Procesul a stat oprit o oră: o singură rulare, nu 60.
    now += 3_600_000;
    await queue.runDue();
    await queue.runDue();
    expect(runs).toBe(3);
  });

  test("două procese care rulează deodată nu iau același job", async () => {
    const a = new GcsSqlJobQueue(db, { now: clock });
    const b = new GcsSqlJobQueue(db, { now: clock });
    const ran: number[] = [];
    for (const q of [a, b]) q.register({ name: "j", handler: async (d) => void ran.push(d.i as number) });
    for (let i = 0; i < 20; i++) await a.enqueue("j", { i });
    await Promise.all([a.runDue({ concurrency: 3 }), b.runDue({ concurrency: 3 })]);
    expect(ran.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  test("un job rămas „în lucru” de la un proces oprit e reluat după expirarea lui", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let runs = 0;
    queue.register({ name: "lung", handler: async () => void runs++ });
    await db.gcsJob.create({ data: { name: "lung", data: "{}", status: "running", runAt: BigInt(now), attempts: 1, lockedUntil: BigInt(now + 1000), createdAt: BigInt(now) } });
    await queue.runDue();
    expect(runs).toBe(0);
    now += 1001;
    await queue.runDue();
    expect(runs).toBe(1);
  });

  test("limita de timp: joburile rămase trec la rularea următoare", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    queue.register({
      name: "incet",
      handler: async () => {
        now += 400;
      },
    });
    for (let i = 0; i < 5; i++) await queue.enqueue("incet");
    const first = await queue.runDue({ budgetMs: 1000, concurrency: 1 });
    expect(first.ran).toBe(3);
    expect(first.pending).toBe(2);
    const second = await queue.runDue({ budgetMs: 10_000, concurrency: 1 });
    expect(second.ran).toBe(2);
  });

  test("programările adăugate la rulare (pluginuri): upsert, listare, ștergere", async () => {
    const queue = new GcsSqlJobQueue(db, { now: clock });
    const seen: unknown[] = [];
    queue.register({ name: "plugin.job", handler: async (d) => void seen.push(d) });
    await queue.upsertScheduler("plugin-x-a", 300_000, { name: "plugin.job", data: { plugin: "x" } });
    await queue.upsertScheduler("plugin-x-a", 600_000, { name: "plugin.job", data: { plugin: "x" } });
    await queue.upsertScheduler("plugin-y-b", 300_000, { name: "plugin.job", data: { plugin: "y" } });
    expect((await queue.schedulerIds("plugin-x-")).sort()).toEqual(["plugin-x-a"]);
    await queue.runDue();
    expect(seen).toHaveLength(2);
    await queue.removeScheduler("plugin-y-b");
    await queue.removeScheduler("lipsa");
    expect(await queue.schedulerIds("plugin-")).toEqual(["plugin-x-a"]);
  });

  test("programarea cron (pattern): rulează la minutul potrivit, în UTC, o dată pe fereastră", async () => {
    now = Date.UTC(2026, 9, 23, 3, 58);
    const queue = new GcsSqlJobQueue(db, { now: clock });
    let runs = 0;
    queue.register({ name: "cron", pattern: "0 4 * * *", handler: async () => void runs++ });
    await queue.runDue();
    expect(runs).toBe(0);
    now = Date.UTC(2026, 9, 23, 4, 0, 5);
    await queue.runDue();
    await queue.runDue();
    expect(runs).toBe(1);
    now = Date.UTC(2026, 9, 24, 4, 1);
    await queue.runDue();
    expect(runs).toBe(2);
  });

  test("nextCronTime: pași, intervale, liste și ziua săptămânii", () => {
    const at = Date.UTC(2026, 9, 23, 10, 7);
    expect(new Date(nextCronTime("*/10 * * * *", at)).toISOString()).toBe("2026-10-23T10:10:00.000Z");
    expect(new Date(nextCronTime("0 4 * * *", at)).toISOString()).toBe("2026-10-24T04:00:00.000Z");
    expect(new Date(nextCronTime("30 9-11 * * 1,3", at)).toISOString()).toBe("2026-10-26T09:30:00.000Z");
    expect(() => nextCronTime("61 * * * *", at)).toThrow(/cron/);
  });

  test("start: bucla din proces rulează joburile fără cron", async () => {
    const queue = new GcsSqlJobQueue(db, { tickMs: 50 });
    let runs = 0;
    queue.register({ name: "bg", handler: async () => void runs++ });
    const stop = await queue.start();
    await queue.enqueue("bg");
    const deadline = Date.now() + 5000;
    while (runs === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    await stop();
    expect(runs).toBe(1);
  });
});
