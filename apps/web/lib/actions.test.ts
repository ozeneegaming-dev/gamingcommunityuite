import { describe, expect, test } from "vitest";
import { isSameOrigin } from "./actions";

describe("isSameOrigin (CSRF)", () => {
  test("acceptă doar cererile de pe același host", () => {
    expect(isSameOrigin(new Headers({ origin: "https://forum.example.com", host: "forum.example.com" }))).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example.com", host: "forum.example.com" }))).toBe(false);
  });

  test("în spatele proxy-ului, folosește X-Forwarded-Host", () => {
    const h = new Headers({ origin: "https://forum.example.com", host: "web:3000", "x-forwarded-host": "forum.example.com" });
    expect(isSameOrigin(h)).toBe(true);
  });

  test("fără Origin sau cu un Origin invalid → refuzat", () => {
    expect(isSameOrigin(new Headers({ host: "forum.example.com" }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "null", host: "forum.example.com" }))).toBe(false);
  });
});
