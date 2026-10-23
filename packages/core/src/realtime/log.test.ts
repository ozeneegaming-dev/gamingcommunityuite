import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRedis } from "../../test/redis";
import { GcsRedisRealtimeLog, GcsSqlRealtimeLog, REALTIME_RETAIN_MS, type GcsRealtimeLog } from "./log";

let now = Date.now();
const logs: { name: string; log: () => GcsRealtimeLog }[] = [
  { name: "redis", log: () => new GcsRedisRealtimeLog(testRedis()) },
  { name: "sql", log: () => new GcsSqlRealtimeLog(testDb(), () => now) },
];

afterAll(async () => {
  testRedis().disconnect();
  await testDb().$disconnect();
});

/** Jurnalul live din care citesc transporturile SSE și polling: același comportament în VPS și în Lite. */
describe.each(logs)("jurnalul live pe $name", ({ name, log: make }) => {
  beforeEach(async () => {
    now = Date.now();
    if (name === "sql") await truncateAll(testDb());
    else await testRedis().flushdb();
  });

  test("citirea de după cursor: doar camerele cerute, în ordine, cu originea", async () => {
    const log = make();
    const start = await log.head();
    await log.append({ room: "topic:1", event: "post:new", data: { id: 1 } });
    await log.append({ room: "user:u1", event: "notification", data: { unread: 2 }, origin: "tab-1" });
    await log.append({ room: "topic:2", event: "post:new", data: { id: 3 } });
    const read = await log.read(start, new Set(["topic:1", "user:u1"]));
    expect(read.reset).toBe(false);
    expect(read.events.map(({ room, event, data, origin }) => ({ room, event, data, origin }))).toEqual([
      { room: "topic:1", event: "post:new", data: { id: 1 }, origin: undefined },
      { room: "user:u1", event: "notification", data: { unread: 2 }, origin: "tab-1" },
    ]);
    // Cursorul a trecut și de mesajul altei camere: citirea următoare nu-l mai parcurge.
    const again = await log.read(read.cursor, new Set(["topic:1", "user:u1"]));
    expect(again.events).toEqual([]);
    await log.append({ room: "topic:1", event: "post:new", data: { id: 4 } });
    expect((await log.read(read.cursor, new Set(["topic:1"]))).events.map((e) => e.data)).toEqual([{ id: 4 }]);
  });

  test("onAppend trezește cititorii din același proces", async () => {
    const log = make();
    let woke = 0;
    const off = log.onAppend(() => void woke++);
    await log.append({ room: "x", event: "e", data: null });
    off();
    await log.append({ room: "x", event: "e", data: null });
    expect(woke).toBe(1);
  });

  test("toate camerele (null) și limita de citire", async () => {
    const log = make();
    const start = await log.head();
    for (let i = 0; i < 5; i++) await log.append({ room: `r${i}`, event: "e", data: i });
    const first = await log.read(start, null, 3);
    expect(first.events.map((e) => e.data)).toEqual([0, 1, 2]);
    const rest = await log.read(first.cursor, null, 3);
    expect(rest.events.map((e) => e.data)).toEqual([3, 4]);
  });

  test.runIf(name === "sql")("curățenia păstrează ultimul mesaj; un cursor șters cere resync", async () => {
    const log = make();
    await log.append({ room: "a", event: "e", data: 1 });
    const cursor = await log.head();
    await log.append({ room: "a", event: "e", data: 2 });
    await log.append({ room: "a", event: "e", data: 3 });
    now += REALTIME_RETAIN_MS + 1000;
    await log.append({ room: "a", event: "e", data: 4 });
    now += REALTIME_RETAIN_MS + 1000;
    expect(await log.prune()).toBe(3);
    const read = await log.read(cursor, new Set(["a"]));
    expect(read.reset).toBe(true);
    expect(read.events.map((e) => e.data)).toEqual([4]);
  });
});
