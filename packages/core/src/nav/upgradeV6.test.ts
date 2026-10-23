import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { seedDefaults } from "../install/seed";
import type { GcsModule } from "../modules/registry";
import { GcsNavService, NAV_MARKS } from "./service";

// Meniul standard (Forum, Membri cu submeniu) și o aplicație (Servere) al cărei item primește submeniul la `nav:v6`.
const site: GcsModule = {
  key: "v6site",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [
    { key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 },
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
  ],
};
const servers: GcsModule = {
  key: "v6servers",
  app: { optional: true, labelKey: "apps.v6servers", icon: "fa-solid fa-server" },
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [
    {
      key: "servers",
      labelKey: "nav.servers",
      icon: "fa-solid fa-server",
      href: "/servers",
      position: 2,
      since: "nav:v3",
      children: [
        { key: "servers_all", labelKey: "nav.serversAll", icon: "fa-solid fa-server", href: "/servers", since: "nav:v6" },
        { key: "bans", labelKey: "nav.bans", icon: "fa-solid fa-gavel", href: "/bans", since: "nav:v6" },
        { key: "admins", labelKey: "nav.serverAdmins", icon: "fa-solid fa-user-shield", href: "/servers/admins", since: "nav:v6" },
      ],
    },
  ],
};

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld([site, servers]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

type Item = { label: object; icon?: string; href: string; appKey?: string; enabled?: boolean; children?: Item[] };

/** Un meniu dat, cu toate marcajele mai puțin cele date (ca pe un site actualizat înainte de ele). */
async function install(items: Item[], without: string[] = ["nav:v6"]): Promise<void> {
  await w.db.navItem.deleteMany({});
  const create = async (it: Item, position: number, parentId: number | null) => {
    const row = await w.db.navItem.create({
      data: { parentId, position, label: it.label, icon: it.icon ?? null, href: it.href, appKey: it.appKey ?? null, groups: [], enabled: it.enabled ?? true },
    });
    for (const [i, c] of (it.children ?? []).entries()) await create(c, i, row.id);
  };
  for (const [i, it] of items.entries()) await create(it, i, null);
  const state = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
  await w.db.systemState.update({ where: { id: 1 }, data: { seedMarks: state.seedMarks.filter((m) => !without.includes(m)) } });
}

async function menu() {
  const rows = await w.db.navItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  return rows
    .filter((r) => r.parentId === null)
    .map((r) => ({ href: r.href, enabled: r.enabled, children: rows.filter((c) => c.parentId === r.id).map((c) => `${c.href}${c.enabled ? "" : " (off)"}`) }));
}

const FORUM: Item = { label: { key: "nav.forum" }, icon: "fa-solid fa-comments", href: "/" };
const SERVERS: Item = { label: { key: "nav.servers" }, icon: "fa-solid fa-server", href: "/servers", appKey: "v6servers" };
const MEMBERS: Item = {
  label: { key: "nav.members" },
  icon: "fa-solid fa-users",
  href: "/members",
  children: [
    { label: { key: "nav.all" }, icon: "fa-solid fa-user-group", href: "/members" },
    { label: { key: "nav.staff" }, icon: "fa-solid fa-shield-halved", href: "/staff" },
  ],
};

describe("actualizarea meniului la nav:v6 (submeniul Servere)", () => {
  test("o instalare nouă are toate marcajele și submeniul Servere, activ", async () => {
    const { seedMarks } = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    expect(NAV_MARKS).toContain("nav:v6");
    expect(seedMarks).toEqual(expect.arrayContaining(["nav", ...NAV_MARKS]));
    expect((await menu()).find((i) => i.href === "/servers")).toEqual({ href: "/servers", enabled: true, children: ["/servers", "/bans", "/servers/admins"] });
  });

  test("sub itemul Servere neschimbat se adaugă copiii noi, activi, o singură dată; restul meniului rămâne", async () => {
    // Un meniu personalizat: Membri fără Staff (scos de admin), un item propriu, Servere fără submeniu.
    await install([FORUM, { ...MEMBERS, children: [MEMBERS.children![0]!] }, { label: { ro: "Magazin" }, href: "/shop", enabled: false }, SERVERS]);
    await seedDefaults(w.db, w.registry);
    expect(await menu()).toEqual([
      { href: "/", enabled: true, children: [] },
      // Copiii mai vechi scoși de admin nu revin (doar copiii aduși de `nav:v6`).
      { href: "/members", enabled: true, children: ["/members"] },
      { href: "/shop", enabled: false, children: [] },
      { href: "/servers", enabled: true, children: ["/servers", "/bans", "/servers/admins"] },
    ]);
    const { seedMarks } = await w.db.systemState.findUniqueOrThrow({ where: { id: 1 } });
    expect(seedMarks).toContain("nav:v6");

    // Adminul ascunde un copil: repornirea nu-l mai atinge și nu dublează nimic.
    await w.db.navItem.updateMany({ where: { href: "/bans" }, data: { enabled: false } });
    await seedDefaults(w.db, w.registry);
    expect((await menu()).find((i) => i.href === "/servers")?.children).toEqual(["/servers", "/bans (off)", "/servers/admins"]);
  });

  test("copiii proprii ai adminului rămân primii; un link pus de admin pe primul nivel nu se dublează", async () => {
    await install([
      FORUM,
      { ...SERVERS, children: [{ label: { ro: "Regulament servere" }, href: "/rules" }, { label: { ro: "Admini" }, href: "/servers/admins" }] },
      { label: { ro: "Banuri" }, href: "/bans" },
    ]);
    await seedDefaults(w.db, w.registry);
    const after = await menu();
    // `/servers/admins` există deja (redenumit de admin): nu se adaugă din nou; `/bans` e pe primul nivel.
    expect(after.find((i) => i.href === "/servers")?.children).toEqual(["/rules", "/servers/admins", "/servers"]);
    expect(after.find((i) => i.href === "/bans")).toEqual({ href: "/bans", enabled: true, children: [] });
  });

  test("un item Servere redenumit, mutat pe alt link sau fără aplicație nu primește submeniul", async () => {
    await install([
      FORUM,
      { label: { ro: "Serverele noastre" }, icon: "fa-solid fa-server", href: "/servers", appKey: "v6servers" },
      { label: { key: "nav.servers" }, icon: "fa-solid fa-server", href: "/servere" },
    ]);
    await seedDefaults(w.db, w.registry);
    expect((await menu()).every((i) => i.children.length === 0)).toBe(true);
  });

  test("copiii aduși de nav:v6 nu strică recunoașterea meniului nemodificat la marcajele vechi", async () => {
    // Meniul implicit dinaintea lui `nav:v6`: Servere fără copii.
    await install([FORUM, SERVERS, MEMBERS], ["nav:v6"]);
    const result = await w.db.$transaction((tx) => GcsNavService.upgradeDefaults(tx, w.registry, "nav:v4"));
    expect(result).toBe("replaced");
  });
});
