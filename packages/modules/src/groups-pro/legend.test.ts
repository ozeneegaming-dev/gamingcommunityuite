import { describe, expect, test } from "vitest";
import {
  addCategory,
  buildLegend,
  categoryKeyFor,
  DEFAULT_LEGEND_CATEGORIES,
  DEFAULT_LEGEND_DISPLAY,
  findGroup,
  LEGEND_TRAY,
  legendDisplay,
  legendPlaces,
  legendTree,
  legendTreeErrors,
  moveCategory,
  moveGroup,
  removeCategory,
  setDisplay,
  updateCategory,
  validLegendCategories,
  validLegendDisplay,
  type GcsGroupLegendPlace,
  type GcsLegendCount,
  type GcsLegendSourceGroup,
  type GcsLegendTree,
} from "./legend";

const g = (id: number, key: string, priority: number, extra: Partial<GcsLegendSourceGroup> = {}): GcsLegendSourceGroup => ({
  id,
  key,
  name: key,
  color: null,
  icon: null,
  public: true,
  description: "",
  inLegend: true,
  priority,
  position: id,
  ...extra,
});

/** Root Admin, Admin (staff), Moderator, VIP Gold, Membru, Vizitator (ascuns din legendă de setarea grupului). */
const GROUPS = [g(1, "root_admin", 100), g(2, "admin", 90), g(3, "moderator", 70), g(4, "vip_gold", 50), g(5, "member", 10), g(6, "guest", 0, { inLegend: false })];
const PLACES = new Map<number, GcsGroupLegendPlace>([
  [1, { category: "staff", parentId: null }],
  [2, { category: "staff", parentId: null }],
  [3, { category: "moderators", parentId: null }],
  [4, { category: "vip", parentId: null }],
  [5, { category: "members", parentId: null }],
  [6, { category: "", parentId: null }],
]);
const COUNTS = new Map<number, GcsLegendCount>([
  [1, { members: 2, secondary: 1, online: 1, onlineSecondary: 1 }],
  [2, { members: 0, secondary: 0, online: 0, onlineSecondary: 0 }],
  [3, { members: 3, secondary: 0, online: 2, onlineSecondary: 0 }],
  [4, { members: 5, secondary: 5, online: 1, onlineSecondary: 1 }],
  [5, { members: 40, secondary: 0, online: 7, onlineSecondary: 0 }],
]);

const tree = (): GcsLegendTree => legendTree({ categories: DEFAULT_LEGEND_CATEGORIES, places: PLACES, groups: GROUPS, display: DEFAULT_LEGEND_DISPLAY });
const ids = (t: GcsLegendTree, key: string) => t.lists[key]!.map((s) => (s.children.length > 0 ? `${s.id}>${s.children.join(",")}` : String(s.id)));

describe("legenda Grupuri Pro: validarea setărilor", () => {
  test("categoriile: chei unice, etichete scurte, iconiță Font Awesome și „ascunsă” opționale", () => {
    expect(validLegendCategories(DEFAULT_LEGEND_CATEGORIES)).toBe(true);
    expect(validLegendCategories([{ key: "staff", label: "", icon: "fa-solid fa-crown", hidden: true }])).toBe(true);
    expect(validLegendCategories([{ key: "staff", label: "", icon: "javascript:alert(1)" }])).toBe(false);
    expect(validLegendCategories([{ key: "staff", label: "", hidden: "da" }])).toBe(false);
    expect(validLegendCategories([{ key: "staff", label: "x".repeat(33) }])).toBe(false);
    expect(validLegendCategories(Array.from({ length: 13 }, (_, i) => ({ key: `c${i}`, label: "" })))).toBe(false);
  });

  test("opțiunile de afișare: complete și corecte; o valoare veche se completează cu cele implicite", () => {
    expect(validLegendDisplay(DEFAULT_LEGEND_DISPLAY)).toBe(true);
    expect(validLegendDisplay({ ...DEFAULT_LEGEND_DISPLAY, columns: 5 })).toBe(false);
    expect(validLegendDisplay({ ...DEFAULT_LEGEND_DISPLAY, extra: true })).toBe(false);
    expect(validLegendDisplay({ columns: 3 })).toBe(false);
    expect(legendDisplay({ columns: 4, hideEmpty: true, junk: 1 })).toEqual({ ...DEFAULT_LEGEND_DISPLAY, columns: 4, hideEmpty: true });
    expect(legendDisplay(null)).toEqual(DEFAULT_LEGEND_DISPLAY);
  });
});

describe("legenda Grupuri Pro: construirea legendei", () => {
  test("categoriile în ordine, grupurile după prioritate; tăvița și grupurile ascunse lipsesc", () => {
    const legend = buildLegend({ categories: DEFAULT_LEGEND_CATEGORIES, places: PLACES, groups: GROUPS, counts: COUNTS, display: DEFAULT_LEGEND_DISPLAY });
    expect(legend.map((c) => [c.key, c.groups.map((x) => x.key)])).toEqual([
      ["staff", ["root_admin", "admin"]],
      ["moderators", ["moderator"]],
      ["vip", ["vip_gold"]],
      ["members", ["member"]],
    ]);
    expect(legend[0]!.members).toBe(2);
  });

  test("poziția din editor bate prioritatea; grupul legat apare în dropdown-ul părintelui", () => {
    const t = moveGroup(moveGroup(tree(), 2, { category: "staff", parentId: null, index: 0 }), 3, { category: "staff", parentId: 2, index: 0 });
    const legend = buildLegend({ categories: t.categories, places: legendPlaces(t), groups: GROUPS, counts: COUNTS, display: DEFAULT_LEGEND_DISPLAY });
    const staff = legend.find((c) => c.key === "staff")!;
    expect(staff.groups.map((x) => x.key)).toEqual(["admin", "root_admin"]);
    expect(staff.groups[0]!.children.map((x) => x.key)).toEqual(["moderator"]);
    expect(staff.groups[0]!.childMembers).toBe(3);
    // Moderatori a rămas fără grupuri: categoria lipsește.
    expect(legend.some((c) => c.key === "moderators")).toBe(false);
  });

  test("fără membrii secundari, grupurile goale ascunse, categoriile ascunse", () => {
    const categories = DEFAULT_LEGEND_CATEGORIES.map((c) => (c.key === "members" ? { ...c, hidden: true } : c));
    const display = { ...DEFAULT_LEGEND_DISPLAY, countSecondary: false, hideEmpty: true };
    const legend = buildLegend({ categories, places: PLACES, groups: GROUPS, counts: COUNTS, display });
    expect(legend.map((c) => c.key)).toEqual(["staff", "moderators"]);
    // Root Admin: 2 membri, 1 secundar → 1; Admin (0) și VIP (5, toți secundari) dispar.
    expect(legend[0]!.groups.map((x) => [x.key, x.count.members, x.count.online])).toEqual([["root_admin", 1, 0]]);
  });

  test("un părinte gol rămâne dacă grupurile lui legate au membri", () => {
    const t = moveGroup(tree(), 3, { category: "staff", parentId: 2, index: 0 });
    const legend = buildLegend({ categories: t.categories, places: legendPlaces(t), groups: GROUPS, counts: COUNTS, display: { ...DEFAULT_LEGEND_DISPLAY, hideEmpty: true } });
    expect(legend[0]!.groups.map((x) => x.key)).toEqual(["root_admin", "admin"]);
  });
});

describe("legenda Grupuri Pro: editorul (arborele)", () => {
  test("arborele din locurile salvate: grupurile ascunse din legendă stau în „Neafișate”", () => {
    const t = tree();
    expect(ids(t, "staff")).toEqual(["1", "2"]);
    expect(ids(t, LEGEND_TRAY)).toEqual(["6"]);
    const places = legendPlaces(t);
    expect(places.get(6)).toEqual({ category: "", parentId: null, position: 5 });
    expect(places.get(1)).toEqual({ category: "staff", parentId: null, position: 0 });
  });

  test("mutarea între categorii, în tăviță, sub alt grup și înapoi", () => {
    let t = moveGroup(tree(), 4, { category: "staff", parentId: null, index: 1 });
    expect(ids(t, "staff")).toEqual(["1", "4", "2"]);
    expect(ids(t, "vip")).toEqual([]);
    t = moveGroup(t, 2, { category: "staff", parentId: 1, index: 0 });
    expect(ids(t, "staff")).toEqual(["1>2", "4"]);
    expect(findGroup(t, 2)).toEqual({ category: "staff", parentId: 1, index: 0 });
    // Părintele mutat în altă categorie își ia grupurile legate cu el.
    t = moveGroup(t, 1, { category: "members", parentId: null, index: 0 });
    expect(ids(t, "members")).toEqual(["1>2", "5"]);
    // Un părinte care devine legat le lasă pe ale lui pe primul nivel (un singur nivel).
    t = moveGroup(t, 1, { category: "members", parentId: 5, index: 0 });
    expect(ids(t, "members")).toEqual(["2", "5>1"]);
    // În tăviță: fără copii.
    t = moveGroup(t, 5, { category: LEGEND_TRAY, parentId: null, index: 0 });
    expect(ids(t, "members")).toEqual(["2", "1"]);
    expect(ids(t, LEGEND_TRAY)).toEqual(["5", "6"]);
    // Ținte imposibile: nimic nu se schimbă.
    expect(moveGroup(t, 5, { category: LEGEND_TRAY, parentId: 6, index: 0 })).toBe(t);
    expect(moveGroup(t, 2, { category: "members", parentId: 2, index: 0 })).toBe(t);
    expect(moveGroup(t, 2, { category: "nope", parentId: null, index: 0 })).toBe(t);
    expect(moveGroup(t, 99, { category: "members", parentId: null, index: 0 })).toBe(t);
  });

  test("reordonarea în aceeași listă (tastatura: sus / jos)", () => {
    const t = moveGroup(tree(), 1, { category: "staff", parentId: null, index: 1 });
    expect(ids(t, "staff")).toEqual(["2", "1"]);
    expect(moveGroup(t, 1, { category: "staff", parentId: null, index: 0 }).lists.staff!.map((s) => s.id)).toEqual([1, 2]);
  });

  test("categoriile: adaugă (cheie din etichetă), redenumește, iconiță, ascunde, reordonează, șterge", () => {
    let t = addCategory(tree(), "Echipa de servere", "fa-solid fa-server");
    const added = t.categories.at(-1)!;
    expect(added).toEqual({ key: "echipa_de_servere", label: "Echipa de servere", icon: "fa-solid fa-server" });
    expect(t.lists.echipa_de_servere).toEqual([]);
    expect(categoryKeyFor("Șefi!", ["sefi"])).toBe("sefi_2");
    expect(categoryKeyFor("!!!", [])).toBe("cat");
    t = updateCategory(t, "echipa_de_servere", { label: "Servere", hidden: true, icon: "" });
    expect(t.categories.at(-1)).toEqual({ key: "echipa_de_servere", label: "Servere", hidden: true });
    t = moveCategory(t, "echipa_de_servere", 0);
    expect(t.categories.map((c) => c.key)).toEqual(["echipa_de_servere", "staff", "moderators", "vip", "members"]);
    t = moveGroup(t, 2, { category: "echipa_de_servere", parentId: null, index: 0 });
    t = moveGroup(t, 3, { category: "echipa_de_servere", parentId: 2, index: 0 });
    t = removeCategory(t, "echipa_de_servere");
    expect(t.categories.map((c) => c.key)).toEqual(["staff", "moderators", "vip", "members"]);
    expect(ids(t, LEGEND_TRAY)).toEqual(["6", "2", "3"]);
    // Măcar o categorie rămâne; maximum 12.
    let one: GcsLegendTree = { categories: [{ key: "a", label: "A" }], lists: { a: [], [LEGEND_TRAY]: [] }, display: DEFAULT_LEGEND_DISPLAY };
    expect(removeCategory(one, "a")).toBe(one);
    for (let i = 0; i < 20; i++) one = addCategory(one, `C${i}`);
    expect(one.categories).toHaveLength(12);
    expect(addCategory(tree(), "   ")).toEqual(tree());
  });

  test("opțiunile de afișare și erorile la salvare", () => {
    const t = setDisplay(tree(), "columns", 4);
    expect(t.display.columns).toBe(4);
    const groupIds = new Set(GROUPS.map((x) => x.id));
    expect(legendTreeErrors(t, groupIds)).toEqual({});
    expect(legendTreeErrors({ ...t, lists: { ...t.lists, staff: [{ id: 1, children: [1] }] } }, groupIds)).toEqual({ groups: "invalid_choice" });
    expect(legendTreeErrors({ ...t, lists: { ...t.lists, staff: [{ id: 99, children: [] }] } }, groupIds)).toEqual({ groups: "invalid_choice" });
    expect(legendTreeErrors({ ...t, lists: { ...t.lists, ghost: [] } }, groupIds)).toEqual({ groups: "invalid_choice" });
    expect(legendTreeErrors({ ...t, lists: { ...t.lists, [LEGEND_TRAY]: [{ id: 6, children: [5] }] } }, groupIds).groups).toBe("invalid_choice");
    expect(legendTreeErrors({ ...t, display: { ...t.display, columns: 7 as 2 } }, groupIds)).toEqual({ display: "invalid_value" });
  });
});
