import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { seedDefaults } from "../install/seed";
import type { GcsModule } from "../modules/registry";
import { NAV_MARKS } from "./service";

// Meniul de bază (din `nav:v2`), Servere (adus de `nav:v3`) și Clanuri (adus de `nav:v4`), ca aplicațiile reale.
const site: GcsModule = {
  key: "v4site",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [
    { key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 },
    { key: "activity", labelKey: "nav.activity", icon: "fa-solid fa-bolt", href: "/activity", position: 5 },
  ],
  navPrevious: [{ key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 }],
};
const app = (key: string, href: string, position: number, since: string): GcsModule => ({
  key,
  app: { optional: true, labelKey: `apps.${key}`, icon: "fa-solid fa-server" },
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [{ key, labelKey: `nav.${key}`, icon: "fa-solid fa-server", href, position, since }],
  navPrevious: [],
});

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld([site, app("v4servers", "/servers", 2, "nav:v3"), app("v4clans", "/clans", 3, "nav:v4")]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const menu = async () =>
  (await w.db.navItem.findMany({ where: { parentId: null }, orderBy: [{ position: "asc" }, { id: "asc" }] })).map((r) => [r.href, r.enabled, r.appKey]);

/** O instalare care are deja meniul `nav:v3` (dat), dar nu și marcajul `nav:v4`. */
async function v3Install(items: { label: object; icon: string; href: string; appKey?: string }[]): Promise<void> {
  await w.db.navItem.deleteMany({});
  for (const [position, it] of items.entries()) {
    await w.db.navItem.create({ data: { position, label: it.label, icon: it.icon, href: it.href, appKey: it.appKey ?? null, groups: [] } });
  }
  const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
  await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: state.seedMarks.filter((m) => m !== "nav:v4") } });
}

const V3 = [
  { label: { key: "nav.forum" }, icon: "fa-solid fa-comments", href: "/" },
  { label: { key: "nav.v4servers" }, icon: "fa-solid fa-server", href: "/servers", appKey: "v4servers" },
  { label: { key: "nav.activity" }, icon: "fa-solid fa-bolt", href: "/activity" },
];

describe("actualizarea meniului la nav:v4 (Clanuri)", () => {
  test("o instalare nouă are Clanuri după Servere, activ, și toate marcajele", async () => {
    expect(await menu()).toEqual([
      ["/", true, null],
      ["/servers", true, "v4servers"],
      ["/clans", true, "v4clans"],
      ["/activity", true, null],
    ]);
    const { seedMarks } = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    expect(seedMarks).toEqual(expect.arrayContaining(["nav", ...NAV_MARKS]));
    expect(NAV_MARKS).toContain("nav:v4");
  });

  test("meniul nav:v3 nemodificat e înlocuit: Clanuri apare activ, după Servere", async () => {
    await v3Install(V3);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      ["/", true, null],
      ["/servers", true, "v4servers"],
      ["/clans", true, "v4clans"],
      ["/activity", true, null],
    ]);
  });

  test("un meniu personalizat rămâne; Clanuri se adaugă la coadă, activ, o singură dată", async () => {
    // Ca meniul personalizat al unui site existent, care avea deja Servere (adăugat la nav:v3).
    await v3Install([V3[2]!, V3[0]!, V3[1]!, { label: { ro: "Comunitatea" }, icon: "fa-solid fa-users", href: "/members" }]);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      ["/activity", true, null],
      ["/", true, null],
      ["/servers", true, "v4servers"],
      ["/members", true, null],
      ["/clans", true, "v4clans"],
    ]);
    await seedDefaults(w.db, w.registry);
    expect((await menu()).filter(([href]) => href === "/clans")).toHaveLength(1);
  });
});
