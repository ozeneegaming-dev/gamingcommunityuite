import { describe, expect, it } from "vitest";
import { cssPermissions, effectiveImmunity, isPowerAdmin, mergeGrants, normalizeFlags, reportedAdminFlags } from "./flags";

describe("flag-urile AMXX și permisiunile CS2 (§7.2)", () => {
  it("normalizează: doar a–v și z, fără dubluri, ordonate", () => {
    expect(normalizeFlags("zbca A!b w")).toBe("abcz");
    expect(normalizeFlags("")).toBe("");
    expect(normalizeFlags(null)).toBe("");
  });

  it("literele → permisiunile CounterStrikeSharp; toate literele de admin → @css/root în plus", () => {
    expect(cssPermissions("bceiju")).toEqual(["@css/reservation", "@css/kick", "@css/slay", "@css/chat", "@css/vote", "@css/generic"]);
    expect(cssPermissions("d")).toEqual(["@css/ban", "@css/unban"]);
    expect(cssPermissions("mt")).toEqual(["@gcs/custom_a", "@gcs/custom_h"]);
    expect(cssPermissions("bt")).toEqual(["@css/reservation", "@gcs/custom_h"]);
    expect(cssPermissions("v")).toEqual(["@gcs/tempban"]);
    expect(cssPermissions("az")).toEqual([]);
    const all = cssPermissions("abcdefghijklmnopqrstuv");
    expect(all).toContain("@css/root");
    expect(all).toContain("@css/rcon");
    expect(cssPermissions("abcdefghijklmnopqrstu")).not.toContain("@css/root");
  });

  it("imunitatea: a intrării, altfel a presetului, altfel 100 cu `a`, altfel 0", () => {
    expect(effectiveImmunity({ immunity: 20, presetImmunity: 50, flags: "a" })).toBe(20);
    expect(effectiveImmunity({ immunity: null, presetImmunity: 50, flags: "a" })).toBe(50);
    expect(effectiveImmunity({ immunity: null, presetImmunity: null, flags: "ab" })).toBe(100);
    expect(effectiveImmunity({ immunity: null, presetImmunity: null, flags: "b" })).toBe(0);
  });

  it("mai multe intrări pe aceeași identitate: reuniunea flag-urilor, imunitatea maximă, expirarea cea mai târzie", () => {
    const a = new Date("2026-11-01T00:00:00Z");
    const b = new Date("2026-12-01T00:00:00Z");
    expect(mergeGrants([{ flags: "bc", immunity: 10, expiresAt: a }, { flags: "cd", immunity: 50, expiresAt: b }])).toEqual({ flags: "bcd", immunity: 50, expiresAt: b });
    expect(mergeGrants([{ flags: "b", immunity: 0, expiresAt: a }, { flags: "z", immunity: 0, expiresAt: null }])).toEqual({ flags: "bz", immunity: 0, expiresAt: null });
  });

  it("flag-urile raportate de server (v2 §2): literele CS 1.6, permisiunile CS2 (@css/root = toate), fără z", () => {
    expect(reportedAdminFlags({ flags: "zbcdeu" })).toBe("bcdeu");
    expect(reportedAdminFlags({ flags: "z" })).toBeNull();
    expect(reportedAdminFlags({})).toBeNull();
    expect(reportedAdminFlags({ permissions: ["@css/kick", "@css/ban", "@CSS/Generic", "@other/x", 5] })).toBe("cdu");
    expect(reportedAdminFlags({ permissions: ["@css/root"] })).toBe("abcdefghijklmnopqrstuv");
    expect(reportedAdminFlags({ flags: { evil: true }, permissions: "nu e listă" })).toBeNull();
    expect(reportedAdminFlags({ flags: "c".repeat(10_000) })).toBe("c");
  });

  it("admin pentru prezență = cel puțin o literă de putere (nu doar imunitate, rezervare sau niveluri VIP)", () => {
    expect(isPowerAdmin("bceiju")).toBe(true);
    expect(isPowerAdmin("u")).toBe(true);
    expect(isPowerAdmin("ab")).toBe(false);
    expect(isPowerAdmin("bt")).toBe(false);
    expect(isPowerAdmin(null)).toBe(false);
  });
});
