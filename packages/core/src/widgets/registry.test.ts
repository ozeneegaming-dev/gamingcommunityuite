import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsAppService } from "../apps/service";
import { GcsForbidden, GcsNotFound } from "../errors";
import type { GcsModule, GcsWidgetDef } from "../modules/registry";
import { GcsNavService, isSafeHref } from "../nav/service";
import type { GcsActor } from "../permissions/types";
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
  apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp });
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
});
