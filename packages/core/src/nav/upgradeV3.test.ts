import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { seedDefaults } from "../install/seed";
import type { GcsModule } from "../modules/registry";
import { NAV_MARKS } from "./service";

// Meniul de bază (din `nav:v2`) și o aplicație opțională nouă, adusă de `nav:v3` (ca Servere), între primii doi itemi.
const site: GcsModule = {
  key: "v3site",
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
const servers: GcsModule = {
  key: "v3servers",
  app: { optional: true, labelKey: "apps.v3servers", icon: "fa-solid fa-server" },
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [{ key: "servers", labelKey: "nav.servers", icon: "fa-solid fa-server", href: "/servers", position: 3, since: "nav:v3" }],
  navPrevious: [],
};

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld([site, servers]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const menu = async () =>
  (await w.db.navItem.findMany({ where: { parentId: null }, orderBy: [{ position: "asc" }, { id: "asc" }] })).map((r) => [r.href, r.enabled, r.appKey]);

/** O instalare care are deja meniul `nav:v2` (dat), dar nu și marcajul `nav:v3`. */
async function v2Install(items: { label: object; icon: string; href: string }[]): Promise<void> {
  await w.db.navItem.deleteMany({});
  for (const [position, it] of items.entries()) {
    await w.db.navItem.create({ data: { position, label: it.label, icon: it.icon, href: it.href, groups: [] } });
  }
  const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
  await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: state.seedMarks.filter((m) => m !== "nav:v3") } });
}

const V2 = [
  { label: { key: "nav.forum" }, icon: "fa-solid fa-comments", href: "/" },
  { label: { key: "nav.activity" }, icon: "fa-solid fa-bolt", href: "/activity" },
];

describe("actualizarea meniului la nav:v3 (Servere)", () => {
  test("o instalare nouă are Servere la locul lui, activ, și toate marcajele", async () => {
    expect(await menu()).toEqual([
      ["/", true, null],
      ["/servers", true, "v3servers"],
      ["/activity", true, null],
    ]);
    const { seedMarks } = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    expect(seedMarks).toEqual(expect.arrayContaining(["nav", ...NAV_MARKS]));
  });

  test("meniul nav:v2 nemodificat e înlocuit: Servere apare activ, după Forum", async () => {
    await v2Install(V2);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      ["/", true, null],
      ["/servers", true, "v3servers"],
      ["/activity", true, null],
    ]);
  });

  test("un meniu personalizat rămâne; Servere se adaugă la coadă, dezactivat, o singură dată", async () => {
    await v2Install([V2[1]!, { label: { ro: "Acasă" }, icon: "fa-solid fa-house", href: "/" }]);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      ["/activity", true, null],
      ["/", true, null],
      ["/servers", false, "v3servers"],
    ]);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toHaveLength(3);
  });

  test("un meniu care are deja linkul /servers nu primește un al doilea", async () => {
    await v2Install([...V2, { label: { ro: "Serverele noastre" }, icon: "fa-solid fa-server", href: "/servers" }]);
    await seedDefaults(w.db, w.registry);
    expect((await menu()).filter(([href]) => href === "/servers")).toHaveLength(1);
  });
});
