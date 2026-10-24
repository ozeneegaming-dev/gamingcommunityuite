import { jsonStrings } from "@gcs/db";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { seedDefaults } from "../install/seed";
import type { GcsModule } from "../modules/registry";
import { NAV_MARKS } from "./service";

// Meniul standard: Membri cu submeniu (Toți, Staff, Clasament), Clasament și pe primul nivel; plus o aplicație (Clanuri).
const site: GcsModule = {
  key: "v5site",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [
    { key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 },
    { key: "activity", labelKey: "nav.activity", icon: "fa-solid fa-bolt", href: "/activity", position: 5 },
    {
      key: "members",
      labelKey: "nav.members",
      icon: "fa-solid fa-users",
      href: "/members",
      position: 20,
      children: [
        { key: "all", labelKey: "nav.all", icon: "fa-solid fa-user-group", href: "/members" },
        { key: "staff", labelKey: "nav.staff", icon: "fa-solid fa-shield-halved", href: "/staff" },
        { key: "top", labelKey: "nav.leaderboard", icon: "fa-solid fa-ranking-star", href: "/leaderboard" },
      ],
    },
    { key: "leaderboard", labelKey: "nav.leaderboard", icon: "fa-solid fa-ranking-star", href: "/leaderboard", position: 40 },
  ],
};
const clans: GcsModule = {
  key: "v5clans",
  app: { optional: true, labelKey: "apps.v5clans", icon: "fa-solid fa-people-group" },
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [{ key: "clans", labelKey: "nav.clans", icon: "fa-solid fa-people-group", href: "/clans", position: 3, since: "nav:v4" }],
};

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld([site, clans]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

type Item = { label: object; icon?: string; href: string; appKey?: string; enabled?: boolean; children?: Item[] };

/** Un meniu personalizat, cu marcajele până la `nav:v4` (fără `nav:v5`), ca pe un site actualizat înainte de regula nouă. */
async function v4Install(items: Item[]): Promise<void> {
  await w.db.navItem.deleteMany({});
  const create = async (it: Item, position: number, parentId: number | null) => {
    const row = await w.db.navItem.create({
      data: { parentId, position, label: it.label, icon: it.icon ?? null, href: it.href, appKey: it.appKey ?? null, groups: [], enabled: it.enabled ?? true },
    });
    for (const [i, c] of (it.children ?? []).entries()) await create(c, i, row.id);
  };
  for (const [i, it] of items.entries()) await create(it, i, null);
  const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
  await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: jsonStrings(state.seedMarks).filter((m) => m !== "nav:v5") } });
}

async function menu() {
  const rows = await w.db.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  return rows
    .filter((r) => r.parentId === null)
    .map((r) => ({ href: r.href, enabled: r.enabled, children: rows.filter((c) => c.parentId === r.id).map((c) => c.href) }));
}

// Ca preview-ul: Forum, Membri fără submeniu, Staff mutat de admin pe primul nivel (cu un copil propriu), un item propriu
// dezactivat de admin și itemii adăugați dezactivați de actualizările vechi (Activitate, Clasament, Clanuri).
const CUSTOM: Item[] = [
  { label: { key: "nav.forum" }, icon: "fa-solid fa-comments", href: "/" },
  { label: { key: "nav.members" }, icon: "fa-solid fa-users", href: "/members" },
  { label: { key: "nav.staff" }, icon: "fa-solid fa-shield-halved", href: "/staff", children: [{ label: { ro: "Staff Servere" }, href: "/staff servere" }] },
  { label: { ro: "Magazin" }, href: "/shop", enabled: false },
  { label: { key: "nav.activity" }, icon: "fa-solid fa-bolt", href: "/activity", enabled: false },
  { label: { key: "nav.leaderboard" }, icon: "fa-solid fa-ranking-star", href: "/leaderboard", enabled: false },
  { label: { key: "nav.clans" }, icon: "fa-solid fa-people-group", href: "/clans", appKey: "v5clans", enabled: false },
];

describe("actualizarea meniului la nav:v5 (aplicațiile apar singure în meniu)", () => {
  test("o instalare nouă are toate marcajele și meniul implicit pornit", async () => {
    const { seedMarks } = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    expect(seedMarks).toEqual(expect.arrayContaining(["nav", ...NAV_MARKS]));
    expect(NAV_MARKS).toContain("nav:v5");
    expect((await menu()).every((i) => i.enabled)).toBe(true);
  });

  test("pornește itemii impliciți adăugați dezactivați și completează submeniul Membri, o singură dată", async () => {
    await v4Install(CUSTOM);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      { href: "/", enabled: true, children: [] },
      // Staff e deja pe primul nivel (pus de admin): nu se dublează; Clasament e implicit pe ambele niveluri.
      { href: "/members", enabled: true, children: ["/members", "/leaderboard"] },
      { href: "/staff", enabled: true, children: ["/staff servere"] },
      // Itemul propriu al adminului rămâne cum l-a lăsat.
      { href: "/shop", enabled: false, children: [] },
      { href: "/activity", enabled: true, children: [] },
      { href: "/leaderboard", enabled: true, children: [] },
      { href: "/clans", enabled: true, children: [] },
    ]);

    // Adminul ascunde din nou un item: repornirea nu-l mai pornește.
    await w.db.navItem.updateMany({ where: { href: "/activity" }, data: { enabled: false } });
    await seedDefaults(w.db, w.registry);
    expect((await menu()).find((i) => i.href === "/activity")?.enabled).toBe(false);
    expect((await menu()).find((i) => i.href === "/members")?.children).toHaveLength(2);
  });

  test("un item redenumit de admin sau un submeniu propriu nu se schimbă", async () => {
    await v4Install([
      { label: { ro: "Comunitate" }, href: "/activity", enabled: false },
      { label: { key: "nav.members" }, icon: "fa-solid fa-users", href: "/members", children: [{ label: { ro: "Echipa" }, href: "/team" }] },
    ]);
    await seedDefaults(w.db, w.registry);
    const after = await menu();
    expect(after.find((i) => i.href === "/activity")?.enabled).toBe(false);
    expect(after.find((i) => i.href === "/members")?.children).toEqual(["/team"]);
  });
});
