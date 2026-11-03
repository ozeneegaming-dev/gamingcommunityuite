import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { aggregate, bucketKey, bucketKeys, GcsStatsReportService, STATS_SETTING, DEFAULT_STATS } from "./reports";

const TZ = "Europe/Bucharest";

describe("intervalele rapoartelor", () => {
  test("ziua, săptămâna (luni sau duminică) și luna, în fusul site-ului", () => {
    // 23:30 UTC pe 2 noiembrie = 01:30 pe 3 noiembrie la București (luni).
    const at = new Date("2026-11-02T23:30:00Z");
    expect(bucketKey(at, "day", TZ)).toBe("2026-11-03");
    expect(bucketKey(at, "week", TZ, "monday")).toBe("2026-11-02");
    expect(bucketKey(at, "week", TZ, "sunday")).toBe("2026-11-01");
    expect(bucketKey(at, "month", TZ)).toBe("2026-11-01");
  });

  test("cheile acoperă perioada fără goluri", () => {
    const from = new Date("2026-10-31T22:00:00Z"); // 1 noiembrie, miezul nopții la București
    const to = new Date("2026-11-07T22:00:00Z"); // 8 noiembrie
    expect(bucketKeys(from, to, "day", TZ)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(bucketKeys(from, to, "week", TZ)).toEqual(["2026-10-26", "2026-11-02"]);
  });

  test("agregarea: numărate, însumate, maximul și membrii distincți", () => {
    const series = [
      { key: "a", agg: "count" as const, unit: "count" as const },
      { key: "b", agg: "sum" as const, unit: "hours" as const },
      { key: "c", agg: "max" as const, unit: "count" as const },
      { key: "d", agg: "distinct" as const, unit: "count" as const },
    ];
    const d1 = new Date("2026-11-01T10:00:00Z");
    const d2 = new Date("2026-11-02T10:00:00Z");
    const points = [
      { s: 0, at: d1 },
      { s: 0, at: d1 },
      { s: 1, at: d1, n: 1.25 },
      { s: 1, at: d1, n: 2 },
      { s: 2, at: d1, n: 7 },
      { s: 2, at: d1, n: 3 },
      { s: 3, at: d1, id: "u1" },
      { s: 3, at: d1, id: "u1" },
      { s: 3, at: d2, id: "u2" },
    ];
    expect(aggregate(points, series, ["2026-11-01", "2026-11-02"], (at) => bucketKey(at, "day", TZ))).toEqual([
      [2, 3.3, 7, 1],
      [0, 0, 0, 1],
    ]);
  });
});

describe("rapoartele", () => {
  let w: GcsRemovalWorld;
  let stats: GcsStatsReportService;
  beforeAll(async () => {
    w = await createRemovalWorld();
  });
  afterAll(async () => {
    await w.close();
  });
  beforeEach(async () => {
    await w.reset();
    stats = new GcsStatsReportService({ db: w.s.db, acp: w.s.acp, settings: w.s.settings });
  });

  test("înregistrările: seria pe zile, totalul față de perioada anterioară, topul metodelor; fără drept → refuz", async () => {
    const root = await w.user("RootStats", "root_admin");
    const now = Date.now();
    const a = await w.user("NouA");
    const b = await w.user("NouB");
    const old = await w.user("Vechi");
    await w.s.db.user.update({ where: { id: a.userId! }, data: { createdAt: new Date(now - 2 * 86_400_000) } });
    await w.s.db.user.update({ where: { id: b.userId! }, data: { createdAt: new Date(now - 1 * 86_400_000) } });
    await w.s.db.user.update({ where: { id: old.userId! }, data: { createdAt: new Date(now - 10 * 86_400_000) } });
    await w.s.db.user.update({ where: { id: root.userId! }, data: { createdAt: new Date(now - 40 * 86_400_000) } });
    await w.s.db.account.create({ data: { userId: a.userId!, providerId: "steam", accountId: "7656" } });

    const r = await stats.run(root, "registrations", { from: new Date(now - 7 * 86_400_000), to: new Date(now + 60_000), group: "day", timeZone: TZ });
    expect(r.series[0]).toMatchObject({ key: "registrations", total: 2, previous: 1 });
    expect(r.buckets.reduce((n, b) => n + b.values[0]!, 0)).toBe(2);
    expect(r.tops[0]!.rows).toEqual([{ label: "steam", value: 1 }]);
    await expect(stats.run(a, "registrations", { from: new Date(now - 86_400_000), to: new Date(now), group: "day", timeZone: TZ })).rejects.toThrow();
  });

  test("membrii activi: postatorii distincți; staff-ul exclus la cerere", async () => {
    const root = await w.user("RootAct", "root_admin");
    const forum = await w.forum();
    const ana = await w.user("AnaAct");
    await w.topic(ana, forum, "Primul topic");
    await w.topic(root, forum, "Topicul adminului");
    const q = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 60_000), group: "day" as const, timeZone: TZ };
    expect((await stats.run(root, "members", q)).series[0]).toMatchObject({ key: "posters", total: 2 });
    await w.s.settings.set(STATS_SETTING, { ...DEFAULT_STATS, excludeStaff: true }, w.system());
    const r = await stats.run(root, "members", q);
    expect(r.series[0]).toMatchObject({ key: "posters", total: 1 });
    expect(r.tops[0]!.rows.map((x) => x.label)).toEqual(["AnaAct"]);
    expect(GcsStatsReportService.csv(r).split("\n")[0]).toBe("period,posters,online");
  });
});
