import { describe, expect, test } from "vitest";
import { testManifest } from "../../test/pluginFixtures";
import { isPluginKey, pluginCssScope, pluginSchema } from "./catalog";
import { defaultPluginSettings, manifestSettingFields, parsePluginManifest, validatePluginSetting } from "./manifest";

const issues = (raw: unknown) => {
  const r = parsePluginManifest(raw);
  return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`);
};

describe("manifestul unui plugin", () => {
  test("un manifest minimal valid primește valorile implicite", () => {
    const r = parsePluginManifest(testManifest());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.permissions).toEqual([]);
    expect(r.manifest.routes).toEqual({ pages: [], acp: [], api: [] });
    expect(r.manifest.menus).toEqual({ site: [], user: [] });
    expect(r.manifest.widgets[0]).toMatchObject({ key: "hello", fields: [], defaultConfig: {} });
  });

  test("cheia: vendor.nume, fără `__`, fără majuscule", () => {
    for (const key of ["acme", "acme.", "Acme.demo", "acme.demo.x", "acme.de__mo", "acme.demo_", "1acme.demo", "acme.demo-x", `${"a".repeat(25)}.b`]) {
      expect(isPluginKey(key)).toBe(false);
      expect(issues(testManifest({ key }))).toContain("key:invalid_plugin_key");
    }
    expect(isPluginKey("acme_games.top_list")).toBe(true);
    expect(pluginSchema("acme_games.top_list")).toBe("plugin_acme_games__top_list");
    expect(pluginCssScope("acme_games.top_list")).toBe("gcsp--acme_games--top_list");
    expect(pluginSchema("a_b.c")).not.toBe(pluginSchema("a.b_c"));
  });

  test("câmpurile necunoscute, versiunea și iconița invalide", () => {
    expect(issues(testManifest({ evil: true }))).toEqual(["(root):unrecognized_keys"]);
    expect(issues(testManifest({ version: "1.0" }))).toContain("version:invalid_version");
    expect(issues(testManifest({ icon: "fa-solid fa-x onerror=alert(1)" }))).toContain("icon:invalid_icon");
    expect(issues(testManifest({ capabilities: ["widgets", "root"] }))).toEqual(["capabilities.1:invalid_value"]);
  });

  test("fiecare declarație cere capabilitatea ei", () => {
    expect(issues(testManifest({ capabilities: [] }))).toContain("widgets:missing_capability:widgets");
    expect(issues(testManifest({ events: ["post.created"] }))).toContain("events:missing_capability:events");
    expect(issues(testManifest({ events: ["settings.updated"], capabilities: ["widgets", "events"] }))).toContain("events.0:invalid_value");
  });

  test("meniurile duc doar spre paginile pluginului", () => {
    const menu = (href: string) => testManifest({ capabilities: ["widgets", "menus"], menus: { user: [{ key: "x", label: "X", href }] } });
    expect(issues(menu("/p/acme.demo"))).toEqual([]);
    expect(issues(menu("/p/acme.demo/stats?tab=1"))).toEqual([]);
    for (const href of ["https://evil.example", "//evil.example", "/admin", "/p/acme.demoX", "/p/acme.demo/../../admin", "javascript:alert(1)"]) {
      expect(issues(menu(href))).toContain("menus.user.x.href:external_link");
    }
  });

  test("setările: valori implicite, alegeri, intervale și „Nelimitat”", () => {
    const manifest = testManifest({
      capabilities: ["widgets", "settings"],
      settings: {
        tabs: [
          {
            key: "general",
            label: "General",
            fields: [
              { type: "text", key: "greeting", label: "Salut", default: "Bună" },
              { type: "number", key: "limit", label: "Limită", default: 0, min: 1, max: 50, unlimited: true },
              { type: "toggle", key: "on", label: "Pornit", default: true },
              { type: "select", key: "mode", label: "Mod", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
              { type: "secret", key: "token", label: "Token" },
            ],
          },
        ],
      },
    });
    const r = parsePluginManifest(manifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(defaultPluginSettings(r.manifest)).toEqual({ greeting: "Bună", limit: 0, on: true, mode: "a", token: "" });
    const [text, num, toggle, select] = manifestSettingFields(r.manifest);
    expect(validatePluginSetting(num!, 0)).toEqual({ ok: true, value: 0 });
    expect(validatePluginSetting(num!, 51)).toEqual({ ok: false, code: "invalid_range" });
    expect(validatePluginSetting(text!, "x".repeat(201))).toEqual({ ok: false, code: "too_long" });
    expect(validatePluginSetting(toggle!, "da")).toEqual({ ok: false, code: "invalid_type" });
    expect(validatePluginSetting(select!, "c")).toEqual({ ok: false, code: "invalid_choice" });

    const bad = testManifest({
      capabilities: ["widgets", "settings"],
      settings: { tabs: [{ key: "g", label: "G", fields: [{ type: "number", key: "n", label: "N", default: 99, min: 1, max: 5 }, { type: "select", key: "s", label: "S", default: "z", options: [{ value: "a", label: "A" }] }] }] },
    });
    expect(issues(bad)).toEqual(["settings.n.default:out_of_range", "settings.s.default:invalid_choice"]);
  });

  test("permisiunile: tipul valorilor, containerul și referințele", () => {
    const perm = (p: Record<string, unknown>, extra: Record<string, unknown> = {}) => testManifest({ capabilities: ["widgets", "permissions", "pages"], permissions: [p], ...extra });
    expect(issues(perm({ key: "view", scope: "group", label: "V", default: { member: true } }))).toEqual([]);
    expect(issues(perm({ key: "view", scope: "group", label: "V", default: { member: 3 } }))).toEqual(["permissions.view.default.member:invalid_type"]);
    expect(issues(perm({ key: "use", scope: "container", label: "U" }))).toEqual(["permissions.use.containerType:required"]);
    expect(issues(perm({ key: "view", scope: "group", label: "V" }, { routes: { pages: [{ path: "/", permission: "nope" }] } }))).toEqual(["routes.pages./.permission:unknown_permission"]);
  });

  test("rutele: căi simple, cu parametri, fără duplicate", () => {
    const routes = (pages: unknown[]) => testManifest({ capabilities: ["widgets", "pages"], routes: { pages } });
    expect(issues(routes([{ path: "/" }, { path: "/item/:id" }]))).toEqual([]);
    expect(issues(routes([{ path: "/x" }, { path: "/x" }]))).toEqual(["routes.pages./x:duplicate_key"]);
    for (const path of ["", "x", "/../admin", "/a//b", "/A", "/a/*"]) expect(issues(routes([{ path }]))).toContain("routes.pages.0.path:invalid_route");
  });
});
