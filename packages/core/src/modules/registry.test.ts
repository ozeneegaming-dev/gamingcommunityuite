import { describe, expect, test } from "vitest";
import { GcsModuleRegistry, type GcsModule } from "./registry";

function mod(key: string, extra: Partial<GcsModule> = {}): GcsModule {
  return { key, permissions: [], settings: [], acpMenu: [], eventListeners: [], ...extra };
}

const setting = (key: string) =>
  ({ key, type: "string", default: "", section: "general", labelKey: `settings.${key}` }) as const;
const permission = (key: string) => ({ key, scope: "group", labelKey: `perm.${key}`, default: {} }) as const;

describe("GcsModuleRegistry", () => {
  test("adună setările, permisiunile și meniul din toate modulele", () => {
    const registry = new GcsModuleRegistry();
    registry.register(
      mod("a", {
        settings: [setting("a.x")],
        permissions: [permission("a.view")],
        acpMenu: [{ app: "system", title: "acp.a", items: [] }],
      }),
    );
    registry.register(mod("b", { settings: [setting("b.y")] }));

    expect(registry.all().map((m) => m.key)).toEqual(["a", "b"]);
    expect(registry.settingDefs().map((s) => s.key)).toEqual(["a.x", "b.y"]);
    expect(registry.permissionDefs().map((p) => p.key)).toEqual(["a.view"]);
    expect(registry.acpMenu()).toHaveLength(1);
  });

  test("o cheie de modul duplicată aruncă eroare", () => {
    const registry = new GcsModuleRegistry();
    registry.register(mod("a"));
    expect(() => registry.register(mod("a"))).toThrow(/a/);
  });

  test("o cheie de setare duplicată aruncă eroare și modulul nu e înregistrat", () => {
    const registry = new GcsModuleRegistry();
    registry.register(mod("a", { settings: [setting("site.name")] }));
    expect(() => registry.register(mod("b", { settings: [setting("site.name")] }))).toThrow(/site\.name/);
    expect(registry.all().map((m) => m.key)).toEqual(["a"]);
  });

  test("o cheie de setare duplicată în același modul aruncă eroare", () => {
    const registry = new GcsModuleRegistry();
    expect(() => registry.register(mod("a", { settings: [setting("x"), setting("x")] }))).toThrow(/x/);
  });

  test("o cheie de permisiune duplicată aruncă eroare", () => {
    const registry = new GcsModuleRegistry();
    registry.register(mod("a", { permissions: [permission("acp.access")] }));
    expect(() => registry.register(mod("b", { permissions: [permission("acp.access")] }))).toThrow(
      /acp\.access/,
    );
  });

  test("settingDef găsește definiția după cheie", () => {
    const registry = new GcsModuleRegistry();
    registry.register(mod("a", { settings: [setting("a.x")] }));
    expect(registry.settingDef("a.x")?.key).toBe("a.x");
    expect(registry.settingDef("lipsa")).toBeUndefined();
  });

  test("unregister scoate modulul (pluginurile la dezactivare), iar amprenta permisiunilor se schimbă", () => {
    const registry = new GcsModuleRegistry();
    registry.register(mod("core", { permissions: [permission("acp.access")] }));
    const before = registry.permissionsFingerprint();
    registry.register(mod("plugin.acme.demo", { settings: [setting("plugin.acme.demo.x")], permissions: [permission("plugin.acme.demo.view")] }));
    const loaded = registry.permissionsFingerprint();
    expect(loaded).not.toBe(before);
    expect(registry.permissionDef("plugin.acme.demo.view")).toBeDefined();

    expect(registry.unregister("plugin.acme.demo")).toBe(true);
    expect(registry.unregister("plugin.acme.demo")).toBe(false);
    expect(registry.module("plugin.acme.demo")).toBeUndefined();
    expect(registry.permissionDef("plugin.acme.demo.view")).toBeUndefined();
    expect(registry.settingDef("plugin.acme.demo.x")).toBeUndefined();
    expect(registry.permissionsFingerprint()).toBe(before);
    // Se poate înregistra din nou (activare după dezactivare).
    registry.register(mod("plugin.acme.demo", { permissions: [permission("plugin.acme.demo.view")] }));
    expect(registry.permissionsFingerprint()).toBe(loaded);
  });
});

describe("panourile de membru (Membri v2)", () => {
  test("pe suprafață, în ordinea pozițiilor, cu modulul lor; cheile duplicate se ignoră", () => {
    const registry = new GcsModuleRegistry();
    const panel = (key: string, position: number, surfaces: ("acp" | "profile")[], kind: "card" | "tab" = "card") => ({ key, labelKey: `x.${key}`, icon: "fa-solid fa-star", position, kind, surfaces });
    registry.register(mod("clans", { memberPanels: [panel("clan", 50, ["acp", "profile"])] }));
    registry.register(mod("servers", { memberPanels: [panel("sanctions", 30, ["acp"], "tab"), panel("clan", 10, ["acp"])] }));
    expect(registry.memberPanels("acp").map((p) => [p.module, p.def.key])).toEqual([
      ["servers", "sanctions"],
      ["clans", "clan"],
    ]);
    expect(registry.memberPanels("profile").map((p) => p.def.key)).toEqual(["clan"]);
  });
});

describe("evenimentele de realizări (Realizări v2)", () => {
  test("adunate din module, cu modulul lor; o cheie repetată o păstrează pe prima; unregister le scoate", () => {
    const registry = new GcsModuleRegistry();
    const ev = (key: string) => ({ key, labelKey: `x.${key}`, icon: "fa-solid fa-star", kind: "count" as const });
    registry.register(mod("forums", { achievementEvents: [ev("forums.post"), ev("forums.topic")] }));
    registry.register(mod("servers", { achievementEvents: [ev("servers.kills"), ev("forums.post")] }));
    expect(registry.achievementEvents().map((e) => [e.module, e.def.key])).toEqual([
      ["forums", "forums.post"],
      ["forums", "forums.topic"],
      ["servers", "servers.kills"],
    ]);
    registry.unregister("servers");
    expect(registry.achievementEvents().map((e) => e.def.key)).toEqual(["forums.post", "forums.topic"]);
  });
});
