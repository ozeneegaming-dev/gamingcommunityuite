import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { NAV_SEED_MARK, seedDefaults } from "../install/seed";
import { NAV_MARKS } from "./service";
import type { GcsModule } from "../modules/registry";

// Un modul cu meniul „nou” (submeniu, itemi noi) și meniul lui anterior; plus o aplicație opțională nouă în meniu.
const site: GcsModule = {
  key: "navsite",
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
      ],
    },
    { key: "rules", labelKey: "nav.rules", icon: "fa-solid fa-scale-balanced", href: "/rules", position: 60 },
  ],
  navPrevious: [
    { key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 },
    { key: "members", labelKey: "nav.members", icon: "fa-solid fa-users", href: "/members", position: 20 },
    { key: "staff", labelKey: "nav.staff", icon: "fa-solid fa-shield-halved", href: "/staff", position: 30 },
  ],
};
const vip: GcsModule = {
  key: "navvip",
  app: { optional: true, labelKey: "apps.navvip", icon: "fa-solid fa-crown" },
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [{ key: "vip", labelKey: "nav.vip", icon: "fa-solid fa-crown", href: "/vip", position: 50 }],
  navPrevious: [],
};

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld([site, vip]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

type Dump = { label: unknown; href: string | null; enabled: boolean; appKey: string | null; children: { label: unknown; href: string | null }[] };

/** Meniul din bază, ca arbore simplu (în ordinea afișată). */
async function menu(): Promise<Dump[]> {
  const rows = await w.db.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  return rows
    .filter((r) => r.parentId === null)
    .map((r) => ({
      label: r.label,
      href: r.href,
      enabled: r.enabled,
      appKey: r.appKey,
      children: rows.filter((c) => c.parentId === r.id).map((c) => ({ label: c.label, href: c.href })),
    }));
}

/** Simulează o instalare făcută înainte de `nav:v2`: meniul anterior (eventual modificat) și doar marcajul `nav` (fără `NAV_MARKS`). */
async function legacyInstall(items: { label: object; icon: string; href: string; enabled?: boolean }[]): Promise<void> {
  await w.db.navItem.deleteMany({});
  for (const [position, it] of items.entries()) {
    await w.db.navItem.create({ data: { position, label: it.label, icon: it.icon, href: it.href, groups: [], enabled: it.enabled ?? true } });
  }
  const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
  await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: state.seedMarks.filter((m) => !NAV_MARKS.includes(m)) } });
}

const LEGACY = [
  { label: { key: "nav.forum" }, icon: "fa-solid fa-comments", href: "/" },
  { label: { key: "nav.members" }, icon: "fa-solid fa-users", href: "/members" },
  { label: { key: "nav.staff" }, icon: "fa-solid fa-shield-halved", href: "/staff" },
];

const CURRENT: Dump[] = [
  { label: { key: "nav.forum" }, href: "/", enabled: true, appKey: null, children: [] },
  { label: { key: "nav.activity" }, href: "/activity", enabled: true, appKey: null, children: [] },
  {
    label: { key: "nav.members" },
    href: "/members",
    enabled: true,
    appKey: null,
    children: [
      { label: { key: "nav.all" }, href: "/members" },
      { label: { key: "nav.staff" }, href: "/staff" },
    ],
  },
  { label: { key: "nav.vip" }, href: "/vip", enabled: true, appKey: "navvip", children: [] },
  { label: { key: "nav.rules" }, href: "/rules", enabled: true, appKey: null, children: [] },
];

describe("actualizarea meniului implicit (nav:v2)", () => {
  test("o instalare nouă primește direct meniul nou, cu submeniul și ambele marcaje", async () => {
    expect(await menu()).toEqual(CURRENT);
    const { seedMarks } = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    expect(seedMarks).toEqual(expect.arrayContaining(["nav", NAV_SEED_MARK]));
  });

  test("un meniu vechi nemodificat e înlocuit cu cel nou, o singură dată", async () => {
    await legacyInstall(LEGACY);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual(CURRENT);
    // Adminul golește meniul după actualizare: repornirea nu-l mai reface.
    await w.db.navItem.deleteMany({});
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([]);
  });

  test("un meniu modificat de admin rămâne; itemii noi lipsă se adaugă la coadă, dezactivați", async () => {
    await legacyInstall([
      { label: { ro: "Comunitate" }, icon: "fa-solid fa-comments", href: "/" },
      { label: { key: "nav.members" }, icon: "fa-solid fa-users", href: "/members" },
      { label: { ro: "Regulament" }, icon: "fa-solid fa-book", href: "/rules" },
    ]);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      { label: { ro: "Comunitate" }, href: "/", enabled: true, appKey: null, children: [] },
      { label: { key: "nav.members" }, href: "/members", enabled: true, appKey: null, children: [] },
      { label: { ro: "Regulament" }, href: "/rules", enabled: true, appKey: null, children: [] },
      // Doar cele al căror link lipsea (Membri și Reguli existau deja), fără să atingă ce a făcut adminul.
      { label: { key: "nav.activity" }, href: "/activity", enabled: false, appKey: null, children: [] },
      { label: { key: "nav.vip" }, href: "/vip", enabled: false, appKey: "navvip", children: [] },
    ]);
    // Idempotent: repornirea nu mai adaugă nimic.
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toHaveLength(5);
  });

  test("o diferență mică (un item dezactivat, o iconiță schimbată) contează ca modificare", async () => {
    await legacyInstall(LEGACY.map((it, i) => (i === 2 ? { ...it, enabled: false } : it)));
    await seedDefaults(w.db, w.registry);
    const after = await menu();
    expect(after.slice(0, 3).map((i) => [i.href, i.enabled])).toEqual([
      ["/", true],
      ["/members", true],
      ["/staff", false],
    ]);
    expect(after.slice(3).map((i) => [i.href, i.enabled])).toEqual([
      ["/activity", false],
      ["/vip", false],
      ["/rules", false],
    ]);

    await legacyInstall(LEGACY.map((it, i) => (i === 0 ? { ...it, icon: "fa-solid fa-house" } : it)));
    await seedDefaults(w.db, w.registry);
    expect((await menu())[0]).toMatchObject({ href: "/", label: { key: "nav.forum" } });
    expect(await w.db.navItem.count({ where: { enabled: false } })).toBe(3);
  });
});
