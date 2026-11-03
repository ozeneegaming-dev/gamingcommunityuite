import { describe, expect, test } from "vitest";
import { MEGA_ARROW_INSET, MEGA_SEPARATOR_HREF, megaColumns, megaGridColumns, megaPlacement, megaStep } from "./mega-menu";

type Child = { id: string; href: string; shortLink?: boolean };
const link = (id: string, shortLink = false): Child => ({ id, href: `/${id}`, shortLink });
const sep = (id: string): Child => ({ id, href: MEGA_SEPARATOR_HREF });
const ids = (list: Child[]) => list.map((c) => c.id);

describe("mega meniurile: grila și coloana linkurilor scurte", () => {
  test("linkurile marcate „Link scurt” trec în coloana din dreapta, în ordinea lor; restul rămân în grilă", () => {
    const { items, short } = megaColumns([link("membri"), link("reguli", true), link("clanuri"), link("staff", true), link("ajutor")]);
    expect(ids(items)).toEqual(["membri", "clanuri", "ajutor"]);
    expect(ids(short)).toEqual(["reguli", "staff"]);
  });

  test("fără linkuri scurte: totul în grilă, fără coloana din dreapta", () => {
    const { items, short } = megaColumns([link("a"), link("b")]);
    expect(ids(items)).toEqual(["a", "b"]);
    expect(short).toEqual([]);
  });

  test("toți scurți: stau toți în grilă (coloana singură ar lăsa panoul gol)", () => {
    const { items, short } = megaColumns([link("a", true), sep("s"), link("b", true)]);
    expect(ids(items)).toEqual(["a", "s", "b"]);
    expect(short).toEqual([]);
  });

  test("separatorii nu sunt linkuri scurte; cei rămași la capete sau dublați după mutare dispar", () => {
    const { items, short } = megaColumns([link("a", true), sep("s1"), link("b"), sep("s2"), link("c", true), sep("s3"), link("d"), { ...sep("s4"), shortLink: true }]);
    expect(ids(short)).toEqual(["a", "c"]);
    expect(ids(items)).toEqual(["b", "s2", "d"]);
  });

  test("coloanele grilei: 1 pentru un item, 2 până la 8 itemi, 3 de la 9", () => {
    expect([0, 1, 2, 4, 6, 8, 9, 14].map(megaGridColumns)).toEqual([1, 1, 2, 2, 2, 2, 3, 3]);
  });
});

describe("mega meniurile: panoul în ecran și săgeata deasupra butonului", () => {
  const base = { triggerWidth: 120, originLeft: 0, panelWidth: 880, viewportWidth: 1440 };

  test("are loc: panoul pornește de la marginea stângă a butonului, săgeata arată mijlocul lui", () => {
    const at = megaPlacement({ ...base, triggerLeft: 300, originLeft: 300 });
    expect(at).toEqual({ left: 0, arrow: 60 });
  });

  test("butonul spre dreapta: panoul intră în ecran (12 px de margine), săgeata rămâne pe buton", () => {
    const triggerLeft = 1200;
    const at = megaPlacement({ ...base, triggerLeft, originLeft: triggerLeft });
    const pageLeft = triggerLeft + at.left;
    expect(pageLeft + base.panelWidth).toBe(1440 - 12);
    const arrowX = pageLeft + at.arrow;
    expect(arrowX).toBeGreaterThanOrEqual(triggerLeft);
    expect(arrowX).toBeLessThanOrEqual(triggerLeft + base.triggerWidth);
    expect(arrowX).toBe(triggerLeft + 60);
  });

  test("butonul lângă marginea stângă: panoul nu iese din ecran", () => {
    const at = megaPlacement({ ...base, triggerLeft: 4, triggerWidth: 40, originLeft: 4 });
    expect(4 + at.left).toBe(12);
    expect(at.arrow).toBe(MEGA_ARROW_INSET);
  });

  test("panoul mai lat decât ecranul pornește de la margine; săgeata nu iese din colțuri", () => {
    const at = megaPlacement({ triggerLeft: 1000, triggerWidth: 100, originLeft: 1000, panelWidth: 1200, viewportWidth: 1100 });
    expect(1000 + at.left).toBe(12);
    expect(at.arrow).toBe(1000 + 50 - 12);
    const edge = megaPlacement({ triggerLeft: 1060, triggerWidth: 100, originLeft: 1060, panelWidth: 300, viewportWidth: 1100 });
    expect(edge.arrow).toBe(300 - MEGA_ARROW_INSET);
  });

  test("originea panoului (elementul poziționat) contează doar pentru `left`", () => {
    const a = megaPlacement({ ...base, triggerLeft: 500, originLeft: 480 });
    const b = megaPlacement({ ...base, triggerLeft: 500, originLeft: 500 });
    expect(a.left - b.left).toBe(20);
    expect(a.arrow).toBe(b.arrow);
  });
});

describe("mega meniurile: săgețile între itemi", () => {
  test("circular, iar din afara listei pornește de la primul (înainte) sau ultimul (înapoi)", () => {
    expect(megaStep(4, 0, 1)).toBe(1);
    expect(megaStep(4, 3, 1)).toBe(0);
    expect(megaStep(4, 0, -1)).toBe(3);
    expect(megaStep(4, -1, 1)).toBe(0);
    expect(megaStep(4, -1, -1)).toBe(3);
    expect(megaStep(0, -1, 1)).toBe(-1);
  });
});
