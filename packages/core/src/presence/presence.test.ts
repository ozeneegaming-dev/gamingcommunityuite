import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRedis } from "../../test/redis";
import { serviceStatus, writeServiceHeartbeat } from "../jobs/heartbeat";
import { GcsPresenceService, guestPresenceId, type GcsPresenceRecord } from "./presence";

const redis = testRedis();
const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
let saved: GcsPresenceRecord[];
let presence: GcsPresenceService;

beforeEach(async () => {
  await redis.flushdb();
  saved = [];
  presence = new GcsPresenceService({ redis, persistRecord: async (r) => void saved.push(r) });
});

afterAll(() => {
  redis.disconnect();
});

describe("GcsPresenceService", () => {
  test("membrii și vizitatorii activi apar; după 5 minute expiră", async () => {
    await presence.touch({ userId: "u1" }, T0);
    await presence.touch({ userId: "u2" }, T0 + 60_000);
    await presence.touch({ guestId: "g1" }, T0);
    expect(await presence.online(T0 + 60_000)).toMatchObject({ users: ["u2", "u1"], guests: 1 });

    const later = await presence.online(T0 + 5 * 60_000 + 1);
    expect(later).toMatchObject({ users: ["u2"], guests: 0 });
    // Recordul rămâne.
    expect(later.record).toEqual({ count: 3, at: new Date(T0) });
  });

  test("un touch repetat nu dublează userul", async () => {
    await presence.touch({ userId: "u1" }, T0);
    await presence.touch({ userId: "u1" }, T0 + 1000);
    expect((await presence.online(T0 + 1000)).users).toEqual(["u1"]);
  });

  test("20 de touch-uri în paralel pentru useri diferiți → recordul e 20", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => presence.touch({ userId: `u${i}` }, T0 + i)));
    expect((await presence.online(T0 + 100)).record?.count).toBe(20);
    expect(Math.max(...saved.map((r) => r.count))).toBe(20);
  });

  test("recordul persistat se încarcă înapoi când Redis-ul e gol și nu scade", async () => {
    const restored = new GcsPresenceService({ redis, loadRecord: async () => ({ count: 50, at: new Date(T0 - 86_400_000) }) });
    await restored.touch({ userId: "u1" }, T0);
    expect((await restored.online(T0)).record).toEqual({ count: 50, at: new Date(T0 - 86_400_000) });
  });

  test("cititorii unui topic: membri și vizitatori, cu expirare și ieșire", async () => {
    await presence.touchTopic(5, { userId: "u1" }, T0);
    await presence.touchTopic(5, { guestId: "g1" }, T0);
    await presence.touchTopic(5, { userId: "u2" }, T0 + 4 * 60_000);
    await presence.touchTopic(6, { userId: "u3" }, T0);
    expect(await presence.topicReaders(5, T0 + 4 * 60_000)).toEqual({ users: ["u2", "u1"], guests: 1 });
    await presence.leaveTopic(5, { userId: "u2" });
    expect(await presence.topicReaders(5, T0 + 5 * 60_000 + 1)).toEqual({ users: [], guests: 0 });
  });

  test("id-ul de vizitator e stabil pe IP", () => {
    expect(guestPresenceId("198.51.100.1")).toBe(guestPresenceId("198.51.100.1"));
    expect(guestPresenceId("198.51.100.1")).not.toBe(guestPresenceId("198.51.100.2"));
  });
});

describe("serviceStatus", () => {
  test("worker: 10 minute; realtime: 2 minute", async () => {
    expect(await serviceStatus(redis, "realtime", T0)).toEqual({ up: false, lastBeatAt: null });
    await writeServiceHeartbeat(redis, "realtime", T0);
    await writeServiceHeartbeat(redis, "worker", T0);
    expect((await serviceStatus(redis, "realtime", T0 + 60_000)).up).toBe(true);
    expect((await serviceStatus(redis, "realtime", T0 + 3 * 60_000)).up).toBe(false);
    expect((await serviceStatus(redis, "worker", T0 + 3 * 60_000)).up).toBe(true);
  });
});
