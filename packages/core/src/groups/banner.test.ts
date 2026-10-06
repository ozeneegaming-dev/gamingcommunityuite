import { describe, expect, test } from "vitest";
import { isSafeBanner } from "./banner";

describe("isSafeBanner", () => {
  test("acceptă o culoare sau un gradient liniar între două culori", () => {
    expect(isSafeBanner("#D62839")).toBe(true);
    expect(isSafeBanner("linear-gradient(135deg, #D62839, #8B0F1C)")).toBe(true);
    expect(isSafeBanner("linear-gradient(#D62839 0%, #8B0F1C 100%)")).toBe(true);
  });
  test("refuză orice altceva (url-uri, expresii, CSS strecurat)", () => {
    for (const v of ["red", "url(https://x.example/a.png)", "#D62839; background: url(x)", "linear-gradient(135deg, #D62839, url(x))", "expression(alert(1))", 12, null]) {
      expect(isSafeBanner(v)).toBe(false);
    }
  });
});
