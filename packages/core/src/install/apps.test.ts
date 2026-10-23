import { describe, expect, test } from "vitest";
import type { GcsModuleRegistry } from "../modules/registry";
import { GCS_PREMIUM_APPS, installAppChoices, landingSettingValue, resolveAppSelection } from "./apps";

/** Un registry minim: doar `module(key).app`, cât folosește selecția aplicațiilor. */
type FakeApp = { optional?: boolean; landing?: { home?: boolean }; requires?: string[] };
function registry(apps: Record<string, FakeApp>): GcsModuleRegistry {
  return {
    module: (key: string) =>
      key in apps ? { key, app: { labelKey: `apps.${key}`, icon: "fa-solid fa-cube", descriptionKey: null, ...apps[key] } } : undefined,
  } as unknown as GcsModuleRegistry;
}

const REG = registry({
  forums: { landing: { home: true } },
  gallery: { optional: true, landing: {} },
  downloads: { optional: true },
  chat: { optional: true, landing: {} },
  servers: { optional: true, landing: {} },
  chat_pro: { optional: true, requires: ["chat"] },
  vip_studio: { optional: true },
});
const STANDARD = { apps: [] as string[] };
const WITH_PREMIUM = { apps: ["servers", "chat_pro"] };

describe("aplicațiile din wizard", () => {
  test("doar aplicațiile existente; Forumul blocat; premium disponibile doar cu licența", () => {
    const choices = installAppChoices(REG, STANDARD);
    // Ordinea catalogului; Paginile, Clanurile, Calendarul, VIP, Magazinul și Grupuri Pro nu există în acest registry.
    expect(choices.map((c) => c.key)).toEqual(["forums", "gallery", "downloads", "chat", "servers", "vip_studio", "chat_pro"]);
    expect(choices.find((c) => c.key === "forums")).toMatchObject({ locked: true, available: true, tier: "standard" });
    expect(choices.find((c) => c.key === "servers")).toMatchObject({ tier: "premium", available: false });
    expect(installAppChoices(REG, WITH_PREMIUM).find((c) => c.key === "servers")).toMatchObject({ available: true });
    expect(GCS_PREMIUM_APPS).toEqual(expect.arrayContaining(["servers", "chat_pro", "vip_studio"]));
  });

  test("alegerea → aplicațiile pornite și cele instalate oprite; Forumul mereu pornit", () => {
    const r = resolveAppSelection(REG, STANDARD, { selected: ["gallery"], landing: "forums" });
    // Aplicațiile premium neincluse în licență se instalează și ele oprite (se pornesc când licența le include).
    expect(r).toEqual({ ok: true, selection: { enabled: ["gallery"], disabled: ["downloads", "chat", "servers", "vip_studio", "chat_pro"], landing: "forums" } });
  });

  test("o aplicație premium neinclusă în licență e refuzată; inclusă, se poate porni", () => {
    expect(resolveAppSelection(REG, STANDARD, { selected: ["servers"], landing: "forums" })).toEqual({ ok: false, error: "premium_not_licensed", app: "servers" });
    const r = resolveAppSelection(REG, WITH_PREMIUM, { selected: ["servers", "chat", "chat_pro"], landing: "servers" });
    expect(r).toMatchObject({ ok: true, selection: { landing: "servers" } });
    if (r.ok) {
      expect(r.selection.enabled).toEqual(expect.arrayContaining(["servers", "chat", "chat_pro"]));
      expect(r.selection.disabled).toEqual(expect.arrayContaining(["gallery", "downloads", "vip_studio"]));
    }
  });

  test("dependențele: Chat Pro fără Chat e refuzat", () => {
    expect(resolveAppSelection(REG, WITH_PREMIUM, { selected: ["chat_pro"], landing: "forums" })).toEqual({ ok: false, error: "requires", app: "chat_pro" });
  });

  test("aplicația de pornire: bifată și cu pagină de pornire; implicit Forumul", () => {
    expect(resolveAppSelection(REG, STANDARD, { selected: [], landing: "gallery" })).toMatchObject({ ok: false, error: "landing_invalid" });
    expect(resolveAppSelection(REG, STANDARD, { selected: ["downloads"], landing: "downloads" })).toMatchObject({ ok: false, error: "landing_invalid" });
    expect(resolveAppSelection(REG, STANDARD, { selected: [], landing: "" })).toMatchObject({ ok: true, selection: { landing: "forums" } });
    expect(resolveAppSelection(REG, STANDARD, { selected: ["nope"], landing: "forums" })).toEqual({ ok: false, error: "unknown_app", app: "nope" });
  });

  test("setarea apps.landing: gol pentru aplicația „acasă”, altfel cheia", () => {
    expect(landingSettingValue(REG, "forums")).toBe("");
    expect(landingSettingValue(REG, "gallery")).toBe("gallery");
  });
});
