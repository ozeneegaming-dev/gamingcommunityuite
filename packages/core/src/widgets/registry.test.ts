import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsAppService } from "../apps/service";
import { GcsForbidden, GcsNotFound } from "../errors";
import type { GcsModule, GcsWidgetDef } from "../modules/registry";
import { GcsNavService, isSafeHref, reorderAppItems } from "../nav/service";
import type { GcsActor } from "../permissions/types";
import { seedDefaults } from "../install/seed";
import { GcsSettingsService } from "../settings/service";
import { fieldsConfig } from "./fields";
import { GcsWidgetService } from "./service";

const limited = (key: string, extra: Partial<GcsWidgetDef> = {}): GcsWidgetDef => ({
  key,
  labelKey: `w.${key}`,
  icon: "fa-solid fa-chart-simple",
  zones: ["top", "bottom", "sidebar"],
  defaultConfig: { limit: 5 },
  config: (raw) => {
    const limit = (raw as { limit?: unknown } | null)?.limit;
    return Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 20 ? { limit } : null;
  },
  ...extra,
});

const base: GcsModule = {
  key: "basew",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  widgets: [limited("base.recent"), limited("base.sidebarOnly", { zones: ["sidebar"] }), limited("base.indexOnly", { pages: ["index"] })],
  nav: [{ key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 }],
};
const optional: GcsModule = {
  key: "optapp",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  app: { optional: true, labelKey: "apps.optapp", icon: "fa-solid fa-gamepad" },
  widgets: [limited("opt.box")],
  nav: [{ key: "opt", labelKey: "nav.opt", icon: "fa-solid fa-gamepad", href: "/opt", position: 1 }],
};

let w: GcsTestWorld;
let apps: GcsAppService;
let widgets: GcsWidgetService;
let nav: GcsNavService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  w = await createWorld([base, optional]);
  apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings: new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry }) });
  widgets = new GcsWidgetService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, apps });
  nav = new GcsNavService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, apps, isIcon: (n) => n.startsWith("fa-solid fa-") });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("aplicații", () => {
  test("doar modulele opționale apar în listă; o aplicație dezactivată devine inactivă, cu jurnal", async () => {
    expect(await apps.list()).toEqual([{ key: "optapp", labelKey: "apps.optapp", icon: "fa-solid fa-gamepad", enabled: true }]);
    expect(await apps.enabled("basew")).toBe(true);
    await apps.setEnabled(root, "optapp", false);
    expect(await apps.enabled("optapp")).toBe(false);
    expect(await apps.enabled("nu-exista")).toBe(false);
    expect(await w.db.auditLog.count({ where: { action: "app.toggle" } })).toBe(1);
    await expect(apps.setEnabled(root, "basew", false)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(apps.setEnabled(member, "optapp", true)).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("widget-uri", () => {
  test("layout-ul salvat apare în ordine; vizibilitatea pe grup și aplicațiile dezactivate sunt respectate", async () => {
    await widgets.save(root, "index", [
      { zone: "sidebar", type: "base.recent", config: { limit: 3 } },
      { zone: "sidebar", type: "opt.box" },
      { zone: "top", type: "base.indexOnly", groups: [w.groups.admin!] },
    ]);
    const forMember = await widgets.layout("index", member);
    expect(forMember.sidebar.map((p) => [p.type, p.position, p.config])).toEqual([
      ["base.recent", 0, { limit: 3 }],
      ["opt.box", 1, { limit: 5 }],
    ]);
    expect(forMember.top).toEqual([]);
    expect((await widgets.layout("index", member, { all: true })).top.map((p) => p.type)).toEqual(["base.indexOnly"]);

    await apps.setEnabled(root, "optapp", false);
    expect((await widgets.layout("index", member)).sidebar.map((p) => p.type)).toEqual(["base.recent"]);
    expect((await widgets.catalog("index")).map((c) => c.key).sort()).toEqual(["base.indexOnly", "base.recent", "base.sidebarOnly"]);
    expect((await widgets.catalog("topic")).map((c) => c.key)).not.toContain("base.indexOnly");
    expect(await w.db.auditLog.count({ where: { action: "layout.save" } })).toBe(1);
  });

  test("validarea: tip necunoscut, zonă nepermisă, pagină nepermisă, config invalid, grup inexistent, fără drept", async () => {
    const bad = async (input: Parameters<GcsWidgetService["save"]>[2], page: unknown = "index") =>
      widgets.save(root, page, input).then(
        () => null,
        (e: { fields?: Record<string, string> }) => e.fields,
      );
    expect(await bad([{ zone: "top", type: "nu.exista" }])).toEqual({ "placements.0.type": "unknown" });
    expect(await bad([{ zone: "top", type: "base.sidebarOnly" }])).toEqual({ "placements.0.zone": "invalid" });
    expect(await bad([{ zone: "top", type: "base.indexOnly" }], "topic")).toEqual({ "placements.0.type": "not_on_page" });
    expect(await bad([{ zone: "top", type: "base.recent", config: { limit: 99 } }])).toEqual({ "placements.0.config": "invalid" });
    expect(await bad([{ zone: "top", type: "base.recent", groups: [99999] }])).toEqual({ "placements.0.groups": "invalid" });
    expect(await bad([], "admin")).toEqual({ page: "invalid" });
    await expect(widgets.save(member, "index", [])).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("seed-ul layout-ului implicit e idempotent și nu suprascrie un layout salvat", async () => {
    await w.db.$transaction((tx) => GcsWidgetService.seedDefaults(tx, { index: [{ zone: "sidebar", type: "base.recent" }] }));
    await w.db.$transaction((tx) => GcsWidgetService.seedDefaults(tx, { index: [{ zone: "sidebar", type: "base.recent" }] }));
    expect(await w.db.widgetPlacement.count()).toBe(1);
  });
});

describe("meniu", () => {
  test("seed-ul pune itemii modulelor; aplicațiile dezactivate și vizibilitatea pe grup sunt respectate", async () => {
    const tree = await nav.tree(member, "ro");
    expect(tree.map((i) => [i.label, i.href])).toEqual([
      [{ key: "nav.forum" }, "/"],
      [{ key: "nav.opt" }, "/opt"],
    ]);
    await apps.setEnabled(root, "optapp", false);
    expect((await nav.tree(member, "ro")).map((i) => i.href)).toEqual(["/"]);

    await nav.save(root, [
      { label: { key: "nav.forum" }, icon: "fa-solid fa-comments", href: "/" },
      {
        label: { ro: "Comunitate", en: "Community" },
        icon: "fa-solid fa-users",
        children: [
          { label: { ro: "Regulament" }, href: "/rules" },
          { label: { ro: "Discord" }, href: "https://discord.gg/x", newTab: true },
        ],
      },
      { label: { ro: "Doar staff" }, href: "/staff-only", groups: [w.groups.admin!] },
    ]);
    const en = await nav.tree(member, "en");
    expect(en.map((i) => i.label)).toEqual([{ key: "nav.forum" }, { text: "Community" }]);
    expect(en[1]!.children.map((c) => [c.label, c.href, c.newTab])).toEqual([
      [{ text: "Regulament" }, "/rules", false],
      [{ text: "Discord" }, "https://discord.gg/x", true],
    ]);
    const admin = await w.actorFor(await w.createUser("Adm", "admin"));
    expect((await nav.tree(admin, "ro")).map((i) => i.href)).toContain("/staff-only");
    expect((await nav.tree(member, "ro")).map((i) => i.href)).not.toContain("/staff-only");
    expect(await w.db.auditLog.count({ where: { action: "nav.save" } })).toBe(1);
  });

  test("accesul pe grup la o aplicație ascunde itemii ei din meniu și widget-urile ei (nu și în modul de editare)", async () => {
    await widgets.save(root, "index", [{ zone: "sidebar", type: "opt.box" }]);
    expect((await widgets.layout("index", member)).sidebar.map((p) => p.type)).toEqual(["opt.box"]);
    await apps.setAccess(root, "optapp.app_access", [w.groups.admin!]);
    expect((await nav.tree(member, "ro")).map((i) => i.href)).toEqual(["/"]);
    expect((await nav.tree(root, "ro")).map((i) => i.href)).toEqual(["/", "/opt"]);
    expect((await widgets.layout("index", member)).sidebar).toEqual([]);
    expect((await widgets.layout("index", member, { all: true })).sidebar.map((p) => p.type)).toEqual(["opt.box"]);
    expect((await widgets.layout("index", root)).sidebar.map((p) => p.type)).toEqual(["opt.box"]);
  });

  test("ordinea aplicațiilor mută itemii lor de pe primul nivel între ei; ceilalți itemi rămân pe loc", async () => {
    const rows = [
      { id: 1, appKey: null },
      { id: 2, appKey: "a" },
      { id: 3, appKey: null },
      { id: 4, appKey: "b" },
      { id: 5, appKey: "c" },
    ];
    expect(reorderAppItems(rows, ["c", "b"]).map((r) => r.id)).toEqual([1, 5, 3, 4, 2]);
    expect(reorderAppItems(rows, []).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);

    await nav.save(root, [
      { label: { key: "nav.opt" }, href: "/opt", appKey: "optapp" },
      { label: { key: "nav.forum" }, href: "/" },
      { label: { ro: "Al doilea" }, href: "/doi", appKey: "basew" },
    ]);
    await nav.applyAppOrder(root, ["basew", "optapp"]);
    expect((await nav.tree(root, "ro")).map((i) => i.href)).toEqual(["/doi", "/", "/opt"]);
    await expect(nav.applyAppOrder(member, [])).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("validarea meniului: linkuri periculoase, iconițe invalide, adâncime, fără drept", async () => {
    const fields = (items: Parameters<GcsNavService["save"]>[1]) =>
      nav.save(root, items).then(
        () => null,
        (e: { fields?: Record<string, string> }) => e.fields,
      );
    expect(await fields([{ label: { ro: "x" }, href: "javascript:alert(1)" }])).toEqual({ "items.0.href": "invalid" });
    expect(await fields([{ label: { ro: "x" }, href: "//evil.com" }])).toEqual({ "items.0.href": "invalid" });
    expect(await fields([{ label: { ro: "x" }, href: "/a", icon: "fa-evil" }])).toEqual({ "items.0.icon": "invalid" });
    expect(await fields([{ label: { xx: "x" }, href: "/a" }])).toEqual({ "items.0.label": "invalid" });
    expect(await fields([{ label: { ro: "a" }, children: [{ label: { ro: "b" }, children: [{ label: { ro: "c" }, href: "/c" }] }] }])).toEqual({
      "items.0.children.0.children": "too_deep",
    });
    await expect(nav.save(member, [])).rejects.toBeInstanceOf(GcsForbidden);
    expect(isSafeHref("/members")).toBe(true);
    expect(isSafeHref("https://x.ro/a")).toBe(true);
    for (const bad of ["data:text/html,x", "/\\evil", "", "ftp://x"]) expect(isSafeHref(bad)).toBe(false);
  });

  test("mega meniul: descrierea pe limbi și insigna fixă; itemii cu cheie primesc cheia descrierii implicite", async () => {
    await nav.save(root, [
      {
        label: { ro: "Gaming" },
        children: [
          { label: { key: "site.nav.servers" }, href: "/servers" },
          { label: { ro: "Mix" }, description: { ro: "Meciuri live și ELO", en: "Live matches and ELO", fr: "  " }, badge: "NOU", href: "/mix" },
        ],
      },
    ]);
    const [gaming] = await nav.tree(member, "en");
    expect(gaming!.description).toBeNull();
    expect(gaming!.children.map((c) => [c.description, c.badge])).toEqual([
      [{ key: "site.navDesc.servers" }, null],
      [{ text: "Live matches and ELO" }, "NOU"],
    ]);
    // Textele goale nu se salvează; editorul primește descrierea și insigna înapoi.
    const edit = await nav.editable();
    expect(edit[0]!.children[1]).toMatchObject({ description: { ro: "Meciuri live și ELO", en: "Live matches and ELO" }, badge: "NOU" });

    const fields = (items: Parameters<GcsNavService["save"]>[1]) =>
      nav.save(root, items).then(
        () => null,
        (e: { fields?: Record<string, string> }) => e.fields,
      );
    expect(await fields([{ label: { ro: "x" }, href: "/a", description: { ro: "x".repeat(101) } }])).toEqual({ "items.0.description": "invalid" });
    expect(await fields([{ label: { ro: "x" }, href: "/a", description: { xx: "nu" } }])).toEqual({ "items.0.description": "invalid" });
    expect(await fields([{ label: { ro: "x" }, href: "/a", badge: "<b>" }])).toEqual({ "items.0.badge": "invalid" });
    expect(await fields([{ label: { ro: "x" }, href: "/a", badge: "FOARTE LUNGĂ INSIGNĂ" }])).toEqual({ "items.0.badge": "invalid" });
  });
});

describe("câmpurile și layout-ul implicit", () => {
  test("fieldsConfig completează valorile implicite și refuză valorile din afara câmpurilor", () => {
    const config = fieldsConfig(
      [
        { key: "limit", labelKey: "l", type: "number", min: 1, max: 20 },
        { key: "period", labelKey: "p", type: "select", options: [{ value: "week", labelKey: "w" }, { value: "all", labelKey: "a" }] },
        { key: "channel", labelKey: "c", type: "select", optionsFrom: "chat.channels" },
        { key: "title", labelKey: "t", type: "text", maxLength: 5 },
      ],
      { limit: 5, period: "week", channel: "", title: "" },
    );
    expect(config({})).toEqual({ limit: 5, period: "week", channel: "", title: "" });
    expect(config({ limit: 7, period: "all", channel: "general", title: "Salut", extra: 1 })).toEqual({ limit: 7, period: "all", channel: "general", title: "Salut" });
    expect(config({ limit: 0 })).toBeNull();
    expect(config({ limit: 2.5 })).toBeNull();
    expect(config({ period: "year" })).toBeNull();
    expect(config({ channel: "../x" })).toBeNull();
    expect(config({ title: "prea lung" })).toBeNull();
  });

  test("fieldsConfig: câmpul `richtext` acceptă documentul valid după profil, textul vechi și golul", () => {
    const config = fieldsConfig([{ key: "body", labelKey: "b", type: "richtext", maxLength: 20, profile: "announcement" }], { body: "" });
    const doc = (...content: unknown[]) => ({ type: "doc", content });
    const formatted = doc({ type: "paragraph", content: [{ type: "text", text: "Bun venit", marks: [{ type: "bold" }] }] }, { type: "image", attrs: { src: "https://cdn.example/a.png" } });
    expect(config({})).toEqual({ body: "" });
    expect(config({ body: formatted })).toEqual({ body: formatted });
    expect(config({ body: "<p>anunț vechi</p>" })).toEqual({ body: "<p>anunț vechi</p>" });
    expect(config({ body: "x".repeat(21) })).toBeNull();
    expect(config({ body: doc({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }) })).toBeNull();
    expect(config({ body: doc({ type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } }) })).toBeNull();
    expect(config({ body: { type: "html", html: "<script>alert(1)</script>" } })).toBeNull();
    expect(config({ body: 42 })).toBeNull();
  });

  test("layout-ul implicit se pune o singură dată; o pagină golită de admin rămâne goală; „reset” îl readuce", async () => {
    const withDefaults: GcsModule = { ...base, key: "defaults", widgets: [], nav: [], widgetLayout: { index: [{ zone: "sidebar", type: "base.recent" }, { zone: "top", type: "base.sidebarOnly" }] } };
    const world = await createWorld([base, withDefaults]);
    const ws = new GcsWidgetService({ db: world.db, cache: world.cache, bus: world.bus, registry: world.registry, acp: world.acp, apps: new GcsAppService({ db: world.db, cache: world.cache, bus: world.bus, registry: world.registry, acp: world.acp, permissions: world.permissions, settings: new GcsSettingsService({ db: world.db, cache: world.cache, bus: world.bus, registry: world.registry }) }) });
    const admin = await world.actorFor(await world.createUser("Root2", "root_admin"));
    // `base.sidebarOnly` nu e permis sus: se sare.
    expect((await ws.layout("index", admin)).sidebar.map((p) => p.type)).toEqual(["base.recent"]);
    expect((await ws.layout("index", admin)).top).toEqual([]);

    await ws.save(admin, "index", []);
    await seedDefaults(world.db, world.registry);
    expect((await ws.layout("index", admin)).sidebar).toEqual([]);

    await ws.reset(admin, "index");
    expect((await ws.layout("index", admin)).sidebar.map((p) => p.type)).toEqual(["base.recent"]);
    await expect(ws.reset(await world.actorFor(await world.createUser("Ion2", "member")), "index")).rejects.toBeInstanceOf(GcsForbidden);
  });
});
