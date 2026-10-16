import { describe, expect, test } from "vitest";
import { donationRange, goalPeriod, monthStartDay, zonedDayStart } from "./donationPeriod";

const TZ = "Europe/Bucharest";

describe("perioadele donațiilor, după ceasul site-ului", () => {
  test("miezul nopții în fusul site-ului (vara UTC+3, iarna UTC+2); un fus invalid = UTC", () => {
    expect(zonedDayStart("2026-07-01", TZ).toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(zonedDayStart("2026-12-01", TZ).toISOString()).toBe("2026-11-30T22:00:00.000Z");
    // Ziua schimbării orei (29 martie 2026, 03:00 → 04:00): miezul nopții e încă pe ora de iarnă.
    expect(zonedDayStart("2026-03-29", TZ).toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(zonedDayStart("2026-07-01", "Nu/Exista").toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  test("prima zi a lunii, cu trecerea anului", () => {
    expect(monthStartDay("2026-10-17")).toBe("2026-10-01");
    expect(monthStartDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("luna și anul curent; „tot” fără limite", () => {
    // 21:30 UTC pe 31 octombrie = 23:30 în București (UTC+2 după schimbarea orei): tot octombrie.
    const now = new Date("2026-10-31T21:30:00Z");
    expect(donationRange("month", now, TZ)).toEqual({ start: new Date("2026-09-30T21:00:00Z"), end: new Date("2026-10-31T22:00:00Z") });
    expect(donationRange("year", now, TZ)).toEqual({ start: new Date("2025-12-31T22:00:00Z"), end: new Date("2026-12-31T22:00:00Z") });
    expect(donationRange("all", now, TZ)).toEqual({ start: null, end: null });
    // 22:30 UTC = 00:30 pe 1 noiembrie în București: luna următoare.
    expect(donationRange("month", new Date("2026-10-31T22:30:00Z"), TZ).start).toEqual(new Date("2026-10-31T22:00:00Z"));
  });
});

describe("perioada unui obiectiv", () => {
  test("lunar cu reînnoire: luna de acum; înainte de start, „în curând”", () => {
    const goal = { period: "MONTHLY" as const, startsOn: new Date("2026-09-10T00:00:00Z"), endsOn: null, autoRenew: true };
    expect(goalPeriod(goal, new Date("2026-10-17T10:00:00Z"), TZ)).toMatchObject({ startDay: "2026-10-01", nextDay: "2026-11-01", state: "active" });
    expect(goalPeriod(goal, new Date("2027-01-05T10:00:00Z"), TZ)).toMatchObject({ startDay: "2027-01-01", nextDay: "2027-02-01", state: "active" });
    expect(goalPeriod(goal, new Date("2026-08-20T10:00:00Z"), TZ)).toMatchObject({ startDay: "2026-09-01", state: "upcoming" });
  });

  test("lunar fără reînnoire: doar luna de start, apoi încheiat", () => {
    const goal = { period: "MONTHLY" as const, startsOn: "2026-09-10", endsOn: null, autoRenew: false };
    expect(goalPeriod(goal, new Date("2026-09-25T10:00:00Z"), TZ)).toMatchObject({ startDay: "2026-09-01", nextDay: "2026-10-01", state: "active" });
    expect(goalPeriod(goal, new Date("2026-10-17T10:00:00Z"), TZ)).toMatchObject({ startDay: "2026-09-01", state: "ended" });
  });

  test("interval: de la prima la ultima zi inclusiv, cu momentele din fusul site-ului", () => {
    const goal = { period: "CUSTOM" as const, startsOn: "2026-10-10", endsOn: "2026-10-20", autoRenew: true };
    const p = goalPeriod(goal, new Date("2026-10-20T20:00:00Z"), TZ);
    expect(p).toMatchObject({ startDay: "2026-10-10", nextDay: "2026-10-21", state: "active" });
    expect(p.start.toISOString()).toBe("2026-10-09T21:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-20T21:00:00.000Z");
    expect(goalPeriod(goal, new Date("2026-10-20T21:30:00Z"), TZ).state).toBe("ended");
  });
});
