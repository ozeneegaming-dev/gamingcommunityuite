import { describe, expect, test } from "vitest";
import { advancedCount, memberSearchParams, parseMemberSearch } from "./member-search";

describe("căutarea din ACP → Membri în adresa paginii", () => {
  test("parametrii valizi devin interogarea; cei invalizi se ignoră", () => {
    const q = parseMemberSearch({
      q: " ana ",
      quick: "banned",
      group: "12",
      scope: "secondary",
      ip: "203.0.113",
      login: "steam",
      tfa: "on",
      country: "ro",
      joinedFrom: "2026-01-01",
      joinedTo: "2026-02-01",
      postsMin: "10",
      sort: "posts",
      dir: "asc",
      page: "3",
    });
    expect(q).toEqual({
      page: 3,
      q: "ana",
      quick: "banned",
      groupId: 12,
      groupScope: "secondary",
      ip: "203.0.113",
      loginMethod: "steam",
      twoFactor: true,
      country: "RO",
      joinedFrom: new Date("2026-01-01T00:00:00.000Z"),
      joinedTo: new Date("2026-02-01T23:59:59.999Z"),
      postsMin: 10,
      sort: "posts",
      dir: "asc",
    });
    expect(parseMemberSearch({ quick: "hackers", login: "github", ip: "'; DROP", sort: "email", joinedFrom: "ieri", page: "-1", tfa: "maybe" })).toEqual({ page: 1 });
    expect(advancedCount(q)).toBe(7);
  });

  test("interogarea → adresa (fără câmpurile goale), dus-întors identic", () => {
    const q = parseMemberSearch({ quick: "staff", group: "4", scope: "primary", activeTo: "2026-10-01", sort: "joined" });
    const params = memberSearchParams(q);
    expect(params.toString()).toBe("quick=staff&group=4&scope=primary&activeTo=2026-10-01&sort=joined");
    expect(parseMemberSearch(Object.fromEntries(params))).toEqual(q);
    expect(memberSearchParams({ page: 2 }).toString()).toBe("page=2");
  });
});
