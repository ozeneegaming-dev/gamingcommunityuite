import { describe, expect, test } from "vitest";
import { placeHoverCard } from "./hoverCardPosition";

/** Un nume de 90×20 px la (x, y) — dreptunghiul din `getBoundingClientRect()`. */
const name = (x: number, y: number) => ({ top: y, bottom: y + 20, left: x, right: x + 90 });
const viewport = { width: 1280, height: 800 };

describe("placeHoverCard (hover card-ul lângă nume, după mărimea măsurată)", () => {
  test("dedesubt, la 8 px sub nume, aliniat la stânga numelui, când încape", () => {
    expect(placeHoverCard(name(200, 100), { width: 340, height: 290 }, viewport)).toEqual({ top: 128, left: 200, side: "below" });
  });

  test("deasupra, la 8 px deasupra numelui, după înălțimea reală (nu o estimare)", () => {
    // Numele la y = 600: dedesubt ar trebui 620 + 8 + 290 > 800 − 12. Cardul de vizitator (184 px) stă la 8 px de nume.
    expect(placeHoverCard(name(200, 600), { width: 340, height: 184 }, viewport)).toEqual({ top: 600 - 8 - 184, left: 200, side: "above" });
    expect(placeHoverCard(name(200, 600), { width: 340, height: 290 }, viewport)).toEqual({ top: 600 - 8 - 290, left: 200, side: "above" });
  });

  test("un card înalt de lângă marginea de jos se lipește tot de nume (cardul cu câmpuri, 420 px)", () => {
    const r = placeHoverCard(name(40, 700), { width: 340, height: 420 }, viewport);
    expect(r).toEqual({ top: 700 - 8 - 420, left: 40, side: "above" });
  });

  test("dedesubt încă încape exact (marginea de 12 px inclusă)", () => {
    // 500 + 20 + 8 + 260 = 788 = 800 − 12; un pixel în plus → deasupra (acolo e loc).
    expect(placeHoverCard(name(10, 500), { width: 340, height: 260 }, viewport)).toEqual({ top: 528, left: 12, side: "below" });
    expect(placeHoverCard(name(10, 500), { width: 340, height: 261 }, viewport)).toEqual({ top: 500 - 8 - 261, left: 12, side: "above" });
  });

  test("nu încape nicăieri: partea cu mai mult loc, limitat în ecran", () => {
    const small = { width: 1280, height: 400 };
    // Mai mult loc dedesubt (nume sus): începe sub nume, dar nu iese jos.
    expect(placeHoverCard(name(10, 60), { width: 340, height: 360 }, small)).toEqual({ top: 400 - 12 - 360, left: 12, side: "below" });
    // Mai mult loc deasupra (nume jos): urcă, dar nu iese sus.
    expect(placeHoverCard(name(10, 300), { width: 340, height: 360 }, small)).toEqual({ top: 12, left: 12, side: "above" });
    // Mai înalt decât ecranul: de la marginea de sus.
    expect(placeHoverCard(name(10, 300), { width: 340, height: 500 }, small).top).toBe(12);
  });

  test("orizontal rămâne în ecran (12 px de margine), și pe ecrane înguste", () => {
    expect(placeHoverCard(name(1200, 100), { width: 340, height: 200 }, viewport).left).toBe(1280 - 12 - 340);
    expect(placeHoverCard(name(4, 100), { width: 340, height: 200 }, viewport).left).toBe(12);
    // Telefonul (375 px): cardul are 351 px (100vw − 24px).
    expect(placeHoverCard(name(200, 100), { width: 351, height: 200 }, { width: 375, height: 700 }).left).toBe(12);
  });

  test("valorile sunt întregi (fără margini neclare)", () => {
    const r = placeHoverCard({ top: 100.4, bottom: 120.6, left: 33.3 }, { width: 340.5, height: 200.2 }, viewport);
    expect(Number.isInteger(r.top) && Number.isInteger(r.left)).toBe(true);
  });
});
