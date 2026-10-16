import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsOnlineTime, ONLINE_GAP_MS, formatOnlineDuration, onlineTimeMemberData, onlinePeriodStart } from "./onlineTime";

let w: GcsProfileWorld;
let online: GcsOnlineTime;
// 2026-10-10 12:00 la București (UTC+3).
const NOON = Date.parse("2026-10-10T09:00:00Z");
const MIN = 60_000;

beforeEach(async () => {
  w = await createProfileWorld();
  online = new GcsOnlineTime({ db: w.db, redis: w.redis, settings: w.settings });
  await w.settings.set("site.timezone", "Europe/Bucharest", w.root);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("timpul online", () => {
  test("adună pauzele scurte dintre semne; o pauză peste fereastra de prezență nu se socotește", async () => {
    const id = w.member.userId!;
    expect(await online.heartbeat(id, NOON)).toBe(0);
    expect(await online.heartbeat(id, NOON + MIN)).toBe(MIN);
    expect(await online.heartbeat(id, NOON + 2 * MIN)).toBe(MIN);
    // Plecat 10 minute: pauza nu contează; de la revenire se numără din nou.
    expect(await online.heartbeat(id, NOON + 12 * MIN)).toBe(0);
    expect(await online.heartbeat(id, NOON + 12 * MIN + ONLINE_GAP_MS)).toBe(ONLINE_GAP_MS);
    // Un semn mai vechi (alt proces, ceas ușor în urmă) nu dă înapoi timpul.
    expect(await online.heartbeat(id, NOON + 5 * MIN)).toBe(0);
    await online.flush(NOON + 20 * MIN, { force: true });
    const row = await w.db.memberOnlineDay.findUnique({ where: { userId_day: { userId: id, day: "2026-10-10" } } });
    expect(row?.seconds).toBe(2 * 60 + 5 * 60);
  });

  test("ziua urmează fusul orar al site-ului", async () => {
    const id = w.member.userId!;
    // 23:58 la București = 20:58 UTC; după miezul nopții (local), timpul trece pe ziua următoare.
    const late = Date.parse("2026-10-10T20:58:00Z");
    await online.heartbeat(id, late);
    await online.heartbeat(id, late + MIN);
    await online.heartbeat(id, late + 3 * MIN);
    await online.flush(late + 3 * MIN, { force: true });
    const days = await w.db.memberOnlineDay.findMany({ where: { userId: id }, orderBy: { day: "asc" } });
    expect(days.map((d) => [d.day, d.seconds])).toEqual([
      ["2026-10-10", 60],
      ["2026-10-11", 120],
    ]);
  });

  test("copierea păstrează valoarea cea mai mare (un Redis golit nu scade totalul) și ignoră membrii șterși", async () => {
    const id = w.member.userId!;
    await w.db.memberOnlineDay.create({ data: { userId: id, day: "2026-10-10", seconds: 3600 } });
    await online.heartbeat(id, NOON);
    await online.heartbeat(id, NOON + MIN);
    await w.redis.hset("gcs:online:day:2026-10-10", "nu-exista", "90000");
    await online.flush(NOON + MIN, { force: true });
    expect((await w.db.memberOnlineDay.findUnique({ where: { userId_day: { userId: id, day: "2026-10-10" } } }))?.seconds).toBe(3600);
    expect(await w.db.memberOnlineDay.count({ where: { userId: "nu-exista" } })).toBe(0);
  });

  test("totalurile pe perioade (azi, 7 / 30 / 365 de zile, tot timpul)", async () => {
    const id = w.member.userId!;
    await w.db.memberOnlineDay.createMany({
      data: [
        { userId: id, day: "2026-10-10", seconds: 100 },
        { userId: id, day: "2026-10-05", seconds: 200 },
        { userId: id, day: "2026-09-20", seconds: 400 },
        { userId: id, day: "2025-01-01", seconds: 800 },
      ],
    });
    const at = async (p: "day" | "week" | "month" | "year" | "all") => (await online.seconds([id], p, NOON)).get(id);
    expect(await at("day")).toBe(100);
    expect(await at("week")).toBe(300);
    expect(await at("month")).toBe(700);
    expect(await at("year")).toBe(700);
    expect(await at("all")).toBe(1500);
    expect(onlinePeriodStart("2026-10-10", "week")).toBe("2026-10-04");
    expect(onlinePeriodStart("2026-10-10", "all")).toBeNull();
  });

  test("durata ca text scurt", () => {
    expect(formatOnlineDuration(5735)).toBe("1h 35m");
    expect(formatOnlineDuration(37 * 60 + 17)).toBe("37m");
    expect(formatOnlineDuration(45)).toBe("45s");
    expect(formatOnlineDuration(61 * 3600)).toBe("61h 00m");
  });

  test("ștergerea și unirea conturilor: zilele dispar, respectiv se adună", async () => {
    const a = w.member.userId!;
    const b = (await w.createUser("Sursa", "member")).id;
    await w.db.memberOnlineDay.createMany({
      data: [
        { userId: a, day: "2026-10-10", seconds: 100 },
        { userId: b, day: "2026-10-10", seconds: 50 },
        { userId: b, day: "2026-10-09", seconds: 70 },
      ],
    });
    const handler = onlineTimeMemberData({ db: w.db });
    expect(await handler.summary(b)).toEqual([{ key: "online_time.days", count: 2 }]);
    await handler.merge({ sourceId: b, targetId: a } as never);
    const days = await w.db.memberOnlineDay.findMany({ where: { userId: a }, orderBy: { day: "asc" } });
    expect(days.map((d) => d.seconds)).toEqual([70, 150]);
    expect(await w.db.memberOnlineDay.count({ where: { userId: b } })).toBe(0);
    await handler.erase({ userId: a } as never);
    expect(await w.db.memberOnlineDay.count({ where: { userId: a } })).toBe(0);
  });
});
