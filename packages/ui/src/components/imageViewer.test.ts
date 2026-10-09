import { describe, expect, test } from "vitest";
import { clampPan, clampZoom, fitSize, swipeDirection, VIEW_RESET, VIEWER_MAX_ZOOM, wrapIndex, zoomAt } from "./imageViewer";

describe("calculele vizualizatorului de imagini", () => {
  test("mărirea rămâne între 1 și maxim; valorile invalide revin la 1", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(50)).toBe(VIEWER_MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  test("mărirea în jurul unui punct îl ține pe loc; la 1 imaginea se recentrează", () => {
    const t = zoomAt(VIEW_RESET, 2, 100, 50);
    // Punctul (100, 50) al scenei arată același punct al imaginii: (p - t) / scale e constant.
    expect((100 - t.x) / t.scale).toBeCloseTo(100);
    expect((50 - t.y) / t.scale).toBeCloseTo(50);
    expect(t).toEqual({ scale: 2, x: -100, y: -50 });
    expect(zoomAt(t, 0.5, 10, 10)).toEqual(VIEW_RESET);
  });

  test("deplasarea nu scoate imaginea mărită din scenă; pe axa mai mică rămâne centrată", () => {
    const fit = { w: 400, h: 200 };
    const stage = { w: 600, h: 400 };
    // La 2×: 800×400 → pe orizontală se poate muta cu (800-600)/2 = 100, pe verticală cu 0.
    expect(clampPan({ scale: 2, x: 500, y: -300 }, fit, stage)).toEqual({ scale: 2, x: 100, y: 0 });
    expect(clampPan({ scale: 2, x: -40, y: 0 }, fit, stage)).toEqual({ scale: 2, x: -40, y: 0 });
  });

  test("încadrarea nu mărește peste dimensiunea naturală", () => {
    expect(fitSize({ w: 2000, h: 1000 }, { w: 1000, h: 800 })).toEqual({ w: 1000, h: 500 });
    expect(fitSize({ w: 200, h: 100 }, { w: 1000, h: 800 })).toEqual({ w: 200, h: 100 });
    expect(fitSize({ w: 0, h: 100 }, { w: 1000, h: 800 })).toEqual({ w: 0, h: 0 });
  });

  test("glisarea: stânga = următoarea, dreapta = anterioara; scurtă, verticală sau lentă = nimic", () => {
    expect(swipeDirection(-120, 10, 200)).toBe(1);
    expect(swipeDirection(90, -20, 300)).toBe(-1);
    expect(swipeDirection(-30, 0, 100)).toBe(0);
    expect(swipeDirection(-80, 120, 200)).toBe(0);
    expect(swipeDirection(-200, 0, 1200)).toBe(0);
  });

  test("indexul e circular", () => {
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(2, 4)).toBe(2);
    expect(wrapIndex(5, 0)).toBe(0);
  });
});
