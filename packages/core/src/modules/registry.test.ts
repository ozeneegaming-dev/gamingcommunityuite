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
});
