import { describe, expect, test } from "vitest";
import { compareSemver, isValidSemverRange, parseSemver, satisfiesSemver } from "./semver";

describe("semver", () => {
  test("parsează versiunile valide și le respinge pe cele invalide", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver("2.0.0-beta.1+build.5")).toEqual({ major: 2, minor: 0, patch: 0, prerelease: ["beta", "1"] });
    for (const bad of ["1.2", "01.2.3", "1.2.3-", "v1.2.3", "1.2.3.4", "", "x.y.z", 123]) expect(parseSemver(bad)).toBeNull();
  });

  test("compară după semver (pre-release < release)", () => {
    const c = (a: string, b: string) => compareSemver(parseSemver(a)!, parseSemver(b)!);
    expect(c("1.0.0", "1.0.1")).toBe(-1);
    expect(c("1.10.0", "1.9.9")).toBe(1);
    expect(c("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(c("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(c("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
    expect(c("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(c("3.1.4", "3.1.4")).toBe(0);
  });

  test("intervalele uzuale", () => {
    expect(satisfiesSemver("1.4.0", "^1.2.0")).toBe(true);
    expect(satisfiesSemver("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesSemver("2.0.0-beta", "^1.2.0")).toBe(false);
    expect(satisfiesSemver("0.2.5", "^0.2.1")).toBe(true);
    expect(satisfiesSemver("0.3.0", "^0.2.1")).toBe(false);
    expect(satisfiesSemver("0.0.4", "^0.0.3")).toBe(false);
    expect(satisfiesSemver("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesSemver("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesSemver("1.5.0", ">=1.2.0 <2.0.0")).toBe(true);
    expect(satisfiesSemver("2.5.0", "<1.0.0 || >=2.0.0")).toBe(true);
    expect(satisfiesSemver("1.9.0", "1.x")).toBe(true);
    expect(satisfiesSemver("1.9.0", "1.8.x")).toBe(false);
    expect(satisfiesSemver("7.0.0", "*")).toBe(true);
    expect(satisfiesSemver("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesSemver("1.2.4", "=1.2.3")).toBe(false);
  });

  test("un interval invalid nu se potrivește cu nimic", () => {
    for (const bad of ["", ">=", "^x", "1.2.3 ||", "~>1.0", "latest", ">= 1.2.3"]) {
      expect(isValidSemverRange(bad)).toBe(false);
      expect(satisfiesSemver("1.2.3", bad)).toBe(false);
    }
    expect(isValidSemverRange(">=1.0.0 <3.0.0")).toBe(true);
  });
});
