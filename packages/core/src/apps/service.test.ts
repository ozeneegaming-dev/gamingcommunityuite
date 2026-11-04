import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsValidationError } from "../errors";
import type { GcsModule } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import { GcsSettingsService } from "../settings/service";
import { APP_SETTING_DEFS, GcsAppService } from "./service";

/**
 * Aplicațiile (specul 2026-10-09-acp-navigatie-aplicatii §2): accesul pe grup (permisiunea `<app>.app_access`, generată),
 * aplicația de pornire, ordinea și rutele aplicațiilor.
 */
const forums: GcsModule = {
  key: "forums",
  permissions: [{ key: "forums.search", scope: "group", labelKey: "p", default: { member: true, guest: true } }],
  // Setările aplicațiilor (în aplicație le declară modulul nucleului).
  settings: APP_SETTING_DEFS,
  acpMenu: [],
  eventListeners: [],
  app: {
    optional: false,
    locked: true,
    labelKey: "apps.forums",
    icon: "fa-solid fa-comments",
    landing: { href: "/forum", home: true },
    sections: [{ key: "search", labelKey: "s.search", icon: "fa-solid fa-magnifying-glass", href: "/search", permission: "forums.search" }],
  },
};
const servers: GcsModule = {
  key: "srv",
  permissions: [
    { key: "srv.view", scope: "group", labelKey: "p", default: { member: true, guest: true } },
    { key: "srv.max", scope: "group", labelKey: "p", default: { member: 3 } },
  ],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  app: {
    optional: true,
    labelKey: "apps.srv",
    icon: "fa-solid fa-server",
    descriptionKey: "apps.descriptions.srv",
    routes: ["/srv", "/api/srv"],
    landing: { href: "/srv" },
    sections: [
      { key: "list", labelKey: "s.list", icon: "fa-solid fa-list", href: "/srv", permission: "srv.view" },
      { key: "stats", labelKey: "s.stats", icon: "fa-solid fa-chart-line", href: "/srv/stats" },
    ],
  },
};
const chat: GcsModule = {
  key: "chatx",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  app: { optional: true, labelKey: "apps.chatx", icon: "fa-solid fa-comment" },
};
/** O aplicație care depinde de alta (ca Chat Pro de Chat), marcată premium. */
const chatPlus: GcsModule = {
  key: "chatplus",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  app: { optional: true, labelKey: "apps.chatplus", icon: "fa-solid fa-star", requires: ["chatx"], premium: true },
};
const plugin: GcsModule = {
  key: "plugin.gcs.hello",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  app: { optional: false, labelKey: "plugin.gcs.hello.name", icon: "fa-solid fa-puzzle-piece", routes: ["/p/gcs.hello", "/api/plugins/gcs.hello"] },
};

let w: GcsTestWorld;
let apps: GcsAppService;
let root: GcsActor;
let member: GcsActor;
let newbie: GcsActor;
let guest: GcsActor;

beforeEach(async () => {
  w = await createWorld([forums, servers, chat, chatPlus, plugin]);
  const settings = new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry });
  apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
  newbie = await w.actorFor(await w.createUser("Nou", "new_member"));
  guest = { userId: null, groupIds: [w.groups.guest!], primaryGroupId: w.groups.guest!, isBanned: false, ip: "203.0.113.9" };
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("accesul pe grup", () => {
  test("fiecare aplicație care se poate opri (și pluginurile) are permisiunea de acces, implicit pentru orice grup", async () => {
    expect(w.registry.permissionDef("srv.app_access")).toMatchObject({ scope: "group", fallback: true, app: "srv", default: {} });
    expect(w.registry.permissionDef("plugin.gcs.hello.app_access")).toMatchObject({ app: "plugin.gcs.hello" });
    expect(w.registry.permissionDef("forums.app_access")).toBeUndefined();
    for (const actor of [member, newbie, guest, root]) expect(await apps.canAccess(actor, "srv")).toBe(true);
    // Un grup creat din ACP primește și el accesul (valoarea `fallback`).
    const custom = await w.groupService.create({ name: "Testeri" }, root);
    const tester = await w.actorFor(await w.createUser("Tester", "member"));
    expect(await apps.canAccess({ ...tester, groupIds: [custom.id], primaryGroupId: custom.id }, "srv")).toBe(true);
    expect(await apps.restrictedApps()).toEqual(new Set());
  });

  test("setAccess: doar grupurile alese; Root Admin are mereu acces; jurnal și cache invalidat", async () => {
    expect(await apps.canAccess(member, "srv")).toBe(true);
    await apps.setAccess(root, "srv.app_access", [w.groups.admin!, w.groups.member!]);
    expect(await apps.canAccess(member, "srv")).toBe(true);
    expect(await apps.canAccess(guest, "srv")).toBe(false);
    expect(await apps.canAccess(newbie, "srv")).toBe(false);
    expect(await apps.canAccess(root, "srv")).toBe(true);
    expect(await apps.restrictedApps()).toEqual(new Set(["srv"]));
    const allowed = await apps.accessGroups("srv.app_access");
    expect(allowed).toEqual(expect.arrayContaining([w.groups.admin, w.groups.member, w.groups.root_admin]));
    expect(allowed).not.toContain(w.groups.guest);
    expect(await w.db.auditLog.count({ where: { action: "app.access" } })).toBe(1);
    // O permisiune a unei secțiuni (booleană, de grup) a aplicației se editează la fel.
    await apps.setAccess(root, "srv.view", [w.groups.admin!]);
    expect(await w.permissions.can(member, "srv.view")).toBe(false);
    expect(await apps.accessGroups("srv.view")).toEqual(expect.arrayContaining([w.groups.admin, w.groups.root_admin]));
  });

  test("setAccess: validarea și dreptul ACP", async () => {
    const fields = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => (e instanceof GcsValidationError ? e.fields : e),
      );
    expect(await fields(apps.setAccess(root, "nu.exista", []))).toEqual({ permission: "invalid" });
    // O permisiune care nu e a unei aplicații, sau una numerică a aplicației, nu se editează de aici.
    expect(await fields(apps.setAccess(root, "acp.access", []))).toEqual({ permission: "invalid" });
    expect(await fields(apps.setAccess(root, "srv.max", []))).toEqual({ permission: "invalid" });
    expect(await fields(apps.setAccess(root, "srv.app_access", [999_999]))).toEqual({ groups: "invalid" });
    await expect(apps.setAccess(member, "srv.app_access", [])).rejects.toBeInstanceOf(GcsForbidden);
    // O aplicație blocată nu are acces pe grup, dar permisiunile secțiunilor ei se editează.
    expect(await fields(apps.setAccess(root, "forums.app_access", []))).toEqual({ permission: "invalid" });
    await apps.setAccess(root, "forums.search", [w.groups.member!]);
    expect(await w.permissions.can(guest, "forums.search")).toBe(false);
  });

  test("o aplicație oprită nu e accesibilă nimănui; filtrul pentru meniu și widget-uri", async () => {
    await apps.setAccess(root, "srv.app_access", [w.groups.admin!]);
    const forMember = await apps.accessFilter(member);
    expect([forMember("srv"), forMember("chatx"), forMember("forums"), forMember("core"), forMember("nu-exista")]).toEqual([false, true, true, true, false]);
    expect((await apps.accessFilter(root))("srv")).toBe(true);
    await apps.setEnabled(root, "srv", false);
    expect(await apps.canAccess(root, "srv")).toBe(false);
    expect((await apps.accessFilter(root))("srv")).toBe(false);
  });

  test("rutele aplicațiilor (prefixe de cale)", () => {
    expect(apps.routeApp("/srv")).toBe("srv");
    expect(apps.routeApp("/srv/12-test")).toBe("srv");
    expect(apps.routeApp("/api/srv/status")).toBe("srv");
    expect(apps.routeApp("/p/gcs.hello/pagina")).toBe("plugin.gcs.hello");
    expect(apps.routeApp("/srvx")).toBeNull();
    expect(apps.routeApp("/")).toBeNull();
  });
});

describe("dependențele aplicațiilor", () => {
  test("o aplicație cu `requires` e activă doar cu dependențele active; pornirea ei cere dependențele pornite", async () => {
    expect(await apps.enabled("chatplus")).toBe(true);
    await apps.setEnabled(root, "chatx", false);
    // Dependența oprită: aplicația nu mai e activă (meniu, widget-uri, pagini), deși starea ei proprie e „pornită”.
    expect(await apps.enabled("chatplus")).toBe(false);
    expect((await apps.enabledFilter())("chatplus")).toBe(false);
    expect(await apps.canAccess(member, "chatplus")).toBe(false);
    expect((await apps.catalog()).find((a) => a.key === "chatplus")).toMatchObject({ enabled: true, requires: ["chatx"], premium: true });
    await apps.setEnabled(root, "chatplus", false);
    await expect(apps.setEnabled(root, "chatplus", true)).rejects.toMatchObject({ fields: { app: "requires" }, params: { requires: "chatx" } });
    await apps.setEnabled(root, "chatx", true);
    await apps.setEnabled(root, "chatplus", true);
    expect(await apps.enabled("chatplus")).toBe(true);
    expect((await apps.catalog()).find((a) => a.key === "srv")).toMatchObject({ requires: [], premium: false });
  });
});

describe("aplicația de pornire", () => {
  test("implicit Forum (fără rescriere); o aplicație aleasă e pornirea doar dacă e pornită și accesibilă", async () => {
    expect(await apps.landingKey()).toBe("forums");
    expect(await apps.landingFor(null)).toBeNull();
    await apps.setLanding(root, "srv");
    expect(await apps.landingKey()).toBe("srv");
    expect(await apps.landingFor(null)).toEqual({ key: "srv", href: "/srv" });
    expect(await apps.landingFor(member)).toEqual({ key: "srv", href: "/srv" });
    await apps.setAccess(root, "srv.app_access", [w.groups.admin!]);
    expect(await apps.landingFor(member)).toBeNull();
    expect(await apps.landingFor(root)).toEqual({ key: "srv", href: "/srv" });
    await apps.setEnabled(root, "srv", false);
    expect(await apps.landingFor(root)).toBeNull();
    expect(await apps.landingFor(null)).toBeNull();
  });

  test("doar o aplicație cu pagină de pornire, cu dreptul pe Aplicații", async () => {
    await expect(apps.setLanding(root, "chatx")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(apps.setLanding(root, "nu-exista")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(apps.setLanding(member, "srv")).rejects.toBeInstanceOf(GcsForbidden);
    await apps.setLanding(root, "srv");
    await apps.setLanding(root, "forums");
    expect(await apps.landingFor(null)).toBeNull();
  });
});

describe("ordinea și catalogul", () => {
  test("catalogul (fără pluginuri) urmează ordinea salvată; cheile necunoscute rămân în ordine, dar nu apar", async () => {
    expect((await apps.catalog()).map((a) => a.key)).toEqual(["forums", "srv", "chatx", "chatplus"]);
    await apps.setOrder(root, ["chatx", "plugin.gcs.vechi", "srv", "chatx"]);
    expect(await apps.order()).toEqual(["chatx", "plugin.gcs.vechi", "srv"]);
    expect((await apps.catalog()).map((a) => a.key)).toEqual(["chatx", "srv", "forums", "chatplus"]);
    await expect(apps.setOrder(member, [])).rejects.toBeInstanceOf(GcsForbidden);
    await expect(apps.setOrder(root, [5 as unknown as string])).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("fără ordine salvată: aplicațiile blocate întâi, apoi ordinea din meniul principal", async () => {
    await w.db.navItem.createMany({
      data: [
        { position: 0, label: { key: "nav.chat" }, href: "/chat", appKey: "chatx" },
        { position: 1, label: { key: "nav.forum" }, href: "/" },
        { position: 2, label: { key: "nav.srv" }, href: "/srv", appKey: "srv" },
      ],
    });
    expect((await apps.catalog()).map((a) => a.key)).toEqual(["forums", "chatx", "srv", "chatplus"]);
  });

  test("o intrare din catalog: blocarea, starea, accesul, secțiunile și pornirea", async () => {
    const list = await apps.catalog();
    expect(list.find((a) => a.key === "forums")).toMatchObject({ locked: true, enabled: true, access: null, landing: { href: "/forum", home: true } });
    expect(list.find((a) => a.key === "srv")).toEqual({
      key: "srv",
      labelKey: "apps.srv",
      icon: "fa-solid fa-server",
      descriptionKey: "apps.descriptions.srv",
      locked: false,
      optional: true,
      enabled: true,
      access: "srv.app_access",
      sections: servers.app!.sections,
      landing: { href: "/srv" },
      requires: [],
      premium: false,
    });
    expect(list.find((a) => a.key === "chatx")).toMatchObject({ descriptionKey: null, sections: [], landing: null });
  });
});

describe("licența declarată invalidă de Data Center (după perioada de grație)", () => {
  test("aplicațiile premium se opresc; cele standard rămân", async () => {
    const settings = new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry });
    let blocked = false;
    const gated = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings, premiumBlocked: async () => blocked });
    expect(await gated.enabled("chatplus")).toBe(true);
    blocked = true;
    expect(await gated.enabled("chatplus")).toBe(false);
    expect(await gated.enabled("chatx")).toBe(true);
    expect(await gated.enabled("srv")).toBe(true);
  });
});

describe("aplicațiile premium care nu sunt în licență (Marketplace)", () => {
  test("nu se pot porni până nu sunt cumpărate; fără licență salvată, fără restricție", async () => {
    const settings = new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry });
    let licensed: string[] | null = [];
    const gated = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings, licensedApps: async () => licensed });
    await gated.setEnabled(root, "chatplus", false);
    await expect(gated.setEnabled(root, "chatplus", true)).rejects.toMatchObject({ params: { reason: "app_not_licensed" } });
    licensed = ["chatplus"];
    await gated.setEnabled(root, "chatplus", true);
    expect(await gated.enabled("chatplus")).toBe(true);
    // Ieșită din licență (rambursare): oprită, deși starea ei e „pornită”; înapoi în licență, pornește iar.
    licensed = [];
    expect(await gated.enabled("chatplus")).toBe(false);
    licensed = ["chatplus"];
    expect(await gated.enabled("chatplus")).toBe(true);
    // Fără licență salvată (dezvoltare, teste): fără restricție.
    await gated.setEnabled(root, "chatplus", false);
    licensed = null;
    await gated.setEnabled(root, "chatplus", true);
    expect(await gated.enabled("chatplus")).toBe(true);
    // O aplicație standard nu ține de licență.
    licensed = [];
    await gated.setEnabled(root, "srv", false);
    await gated.setEnabled(root, "srv", true);
    expect(await gated.enabled("srv")).toBe(true);
  });
});
