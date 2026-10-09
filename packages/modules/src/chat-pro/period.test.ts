import { describe, expect, test } from "vitest";
import { addDays, dayKey, daysBetween, isoWeekday, previousPeriod, rankingPeriod, secondsSinceMidnight, weekStart } from "./period";

describe("zilele și perioadele clasamentului", () => {
  test("ziua în fusul orar al site-ului (nu UTC)", () => {
    // 23:30 UTC pe 31 decembrie e deja 1 ianuarie la București (UTC+2).
    const at = new Date("2026-12-31T23:30:00Z");
    expect(dayKey(at, "Europe/Bucharest")).toBe("2027-01-01");
    expect(dayKey(at, "UTC")).toBe("2026-12-31");
    expect(dayKey(at, "Nu/Exista")).toBe("2026-12-31");
    expect(secondsSinceMidnight(at, "Europe/Bucharest")).toBe(5400); // 01:30
  });

  test("aritmetica pe zile, ziua săptămânii, începutul săptămânii", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-09", "2026-11-01")).toBe(23);
    expect(isoWeekday("2026-10-09")).toBe(5); // vineri
    expect(isoWeekday("2026-10-11")).toBe(7); // duminică
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
  });

  test("perioada lunară: din ziua resetării până în ziua dinaintea următoarei", () => {
    expect(rankingPeriod("2026-10-09", "month", 1)).toEqual({ kind: "month", start: "2026-10-01", end: "2026-10-31", next: "2026-11-01" });
    // Înainte de ziua resetării: perioada a început luna trecută.
    expect(rankingPeriod("2026-10-09", "month", 15)).toEqual({ kind: "month", start: "2026-09-15", end: "2026-10-14", next: "2026-10-15" });
    expect(rankingPeriod("2027-01-02", "month", 5)).toEqual({ kind: "month", start: "2026-12-05", end: "2027-01-04", next: "2027-01-05" });
    // Ziua resetării invalidă se limitează la 1–28.
    expect(rankingPeriod("2026-02-28", "month", 31).start).toBe("2026-02-28");
  });

  test("perioada săptămânală (1 = luni) și perioada anterioară", () => {
    const week = rankingPeriod("2026-10-09", "week", 1);
    expect(week).toEqual({ kind: "week", start: "2026-10-05", end: "2026-10-11", next: "2026-10-12" });
    expect(rankingPeriod("2026-10-09", "week", 6)).toEqual({ kind: "week", start: "2026-10-03", end: "2026-10-09", next: "2026-10-10" });
    expect(previousPeriod(week, 1)).toEqual({ kind: "week", start: "2026-09-28", end: "2026-10-04", next: "2026-10-05" });
    expect(previousPeriod(rankingPeriod("2026-10-09", "month", 1), 1)).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
  });
});
