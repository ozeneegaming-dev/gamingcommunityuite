import { describe, expect, test } from "vitest";
import { hoverCardArrowX, placeHoverCard } from "./hoverCardPosition";

/** Un nume de 90×20 px la (x, y) — dreptunghiul din `getBoundingClientRect()`. */
const name = (x: number, y: number) => ({ top: y, bottom: y + 20, left: x, right: x + 90 });
const viewport = { width: 1280, height: 800 };

describe("placeHoverCard (hover card-ul lângă nume, după mărimea măsurată)", () => {
  test("dedesubt, la 8 px sub nume, aliniat la stânga numelui, când încape", () => {
    expect(placeHoverCard(name(200, 100), { width: 340, height: 290 }, viewport)).toEqual({ top: 128, left: 200, side: "below", maxHeight: null });
  });

  test("deasupra, la 8 px deasupra numelui, după înălțimea reală (nu o estimare)", () => {
    // Numele la y = 600: dedesubt ar trebui 620 + 8 + 290 > 800 − 12. Cardul de vizitator (184 px) stă la 8 px de nume.
    expect(placeHoverCard(name(200, 600), { width: 340, height: 184 }, viewport)).toEqual({ top: 600 - 8 - 184, left: 200, side: "above", maxHeight: null });
    expect(placeHoverCard(name(200, 600), { width: 340, height: 290 }, viewport)).toEqual({ top: 600 - 8 - 290, left: 200, side: "above", maxHeight: null });
  });

  test("un card înalt de lângă marginea de jos se lipește tot de nume (cardul cu câmpuri, 420 px)", () => {
    const r = placeHoverCard(name(40, 700), { width: 340, height: 420 }, viewport);
    expect(r).toEqual({ top: 700 - 8 - 420, left: 40, side: "above", maxHeight: null });
  });

  test("dedesubt încă încape exact (marginea de 12 px inclusă)", () => {
    // 500 + 20 + 8 + 260 = 788 = 800 − 12; un pixel în plus → deasupra (acolo e loc).
    expect(placeHoverCard(name(10, 500), { width: 340, height: 260 }, viewport)).toEqual({ top: 528, left: 12, side: "below", maxHeight: null });
    expect(placeHoverCard(name(10, 500), { width: 340, height: 261 }, viewport)).toEqual({ top: 500 - 8 - 261, left: 12, side: "above", maxHeight: null });
  });

  test("nu încape nicăieri: partea cu mai mult loc, cu înălțimea limitată la ea (derulează), fără să acopere numele", () => {
    const small = { width: 1280, height: 400 };
    // Mai mult loc dedesubt (nume sus): 8 px sub nume, până la 12 px de marginea de jos.
    expect(placeHoverCard(name(10, 60), { width: 340, height: 360 }, small)).toEqual({ top: 88, left: 12, side: "below", maxHeight: 400 - 12 - 88 });
    // Mai mult loc deasupra (nume jos): de la 12 px de sus până la 8 px deasupra numelui.
    expect(placeHoverCard(name(10, 300), { width: 340, height: 360 }, small)).toEqual({ top: 12, left: 12, side: "above", maxHeight: 300 - 8 - 12 });
    expect(placeHoverCard(name(10, 300), { width: 340, height: 500 }, small)).toEqual({ top: 12, left: 12, side: "above", maxHeight: 280 });
  });

  test("orizontal rămâne în ecran (12 px de margine), și pe ecrane înguste", () => {
    expect(placeHoverCard(name(1200, 100), { width: 340, height: 200 }, viewport).left).toBe(1280 - 12 - 340);
    expect(placeHoverCard(name(4, 100), { width: 340, height: 200 }, viewport).left).toBe(12);
    // Telefonul (375 px): cardul are 351 px (100vw − 24px).
    expect(placeHoverCard(name(200, 100), { width: 351, height: 200 }, { width: 375, height: 700 }).left).toBe(12);
  });

  test("un card mai lat decât ecranul fără margini (370 px, cel mult 100vw − 16 px) stă centrat", () => {
    // 375 px: cardul are 359 px → 8 px de fiecare parte, oriunde ar fi numele.
    expect(placeHoverCard(name(200, 100), { width: 359, height: 200 }, { width: 375, height: 700 }).left).toBe(8);
    expect(placeHoverCard(name(4, 100), { width: 359, height: 200 }, { width: 375, height: 700 }).left).toBe(8);
  });

  test("săgeata stă la mijlocul numelui, dar nu în colțurile rotunjite ale cardului", () => {
    // Numele 200–290, cardul de la 200 (lat de 370): mijlocul numelui e la 45 px în card.
    expect(hoverCardArrowX({ left: 200, right: 290 }, 200, 370)).toBe(45);
    // Cardul centrat pe telefon (de la 8 px): numele 12–60 → 28 px în card.
    expect(hoverCardArrowX({ left: 12, right: 60 }, 8, 359)).toBe(28);
    // Un nume foarte scurt la margine sau un nume dincolo de card: săgeata rămâne la 20 px de colțuri.
    expect(hoverCardArrowX({ left: 0, right: 10 }, 8, 359)).toBe(20);
    expect(hoverCardArrowX({ left: 1300, right: 1360 }, 900, 370)).toBe(350);
  });

  test("valorile sunt întregi (fără margini neclare)", () => {
    const r = placeHoverCard({ top: 100.4, bottom: 120.6, left: 33.3 }, { width: 340.5, height: 200.2 }, viewport);
    expect(Number.isInteger(r.top) && Number.isInteger(r.left)).toBe(true);
  });
});
