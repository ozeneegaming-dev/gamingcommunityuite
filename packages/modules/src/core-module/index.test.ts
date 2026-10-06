import { GcsModuleRegistry, settingValueError } from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { describe, expect, test } from "vitest";
import { coreModule, DEFAULT_GROUP_KEYS } from "./index";

describe("coreModule", () => {
  test("se înregistrează fără chei duplicate", () => {
    const registry = new GcsModuleRegistry();
    expect(() => registry.register(coreModule)).not.toThrow();
  });

  test("declară setările din plan, cu valorile implicite valide pentru tipul lor", () => {
    const keys = coreModule.settings.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "site.name",
        "site.url",
        "site.locale",
        "site.timezone",
        "site.theme",
        "email.smtp_host",
        "email.smtp_port",
        "email.smtp_user",
        "email.smtp_pass",
        "email.from",
        "auth.registration_open",
        "auth.email_confirm",
        "auth.discord_client_id",
        "auth.discord_client_secret",
        "auth.steam_api_key",
        "auth.turnstile_site_key",
        "auth.turnstile_secret",
        "system.maintenance",
      ]),
    );
    for (const def of coreModule.settings) {
      expect(settingValueError(def, def.default), def.key).toBeNull();
    }
    const byKey = new Map(coreModule.settings.map((s) => [s.key, s]));
    expect(byKey.get("site.name")?.default).toBe("Comunitatea mea");
    expect(byKey.get("email.smtp_port")?.default).toBe(587);
    for (const secret of ["email.smtp_pass", "auth.discord_client_secret", "auth.steam_api_key", "auth.turnstile_secret"]) {
      expect(byKey.get(secret)?.type, secret).toBe("secret");
    }
  });

  test("core.view_public e true pentru toate grupurile implicite", () => {
    const viewPublic = coreModule.permissions.find((p) => p.key === "core.view_public");
    for (const group of DEFAULT_GROUP_KEYS) expect(viewPublic?.default[group], group).toBe(true);
  });

  test("acp.access e dat doar adminilor", () => {
    const acp = coreModule.permissions.find((p) => p.key === "acp.access");
    expect(acp?.default).toEqual({ root_admin: true, admin: true });
  });

  test("meniul ACP acoperă aplicațiile system, members și appearance, cu chei unice", () => {
    expect(new Set(coreModule.acpMenu.map((s) => s.app))).toEqual(new Set(["system", "members", "appearance"]));
    const items = coreModule.acpMenu.flatMap((s) => s.items);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const item of items) expect(item.href.startsWith("/admin")).toBe(true);
  });

  test("fiecare secțiune și intrare din meniul ACP are o iconiță Font Awesome validă", () => {
    for (const section of coreModule.acpMenu) {
      expect(isGcsIcon(section.icon), section.title).toBe(true);
      for (const item of section.items) expect(isGcsIcon(item.icon), item.key).toBe(true);
    }
  });
});
