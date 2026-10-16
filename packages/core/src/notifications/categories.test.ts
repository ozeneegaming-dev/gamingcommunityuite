import { describe, expect, test } from "vitest";
import { GcsModuleRegistry, type GcsModule } from "../modules/registry";
import { notificationCatalog, notificationCategoryOf, notificationTabs } from "./categories";

const mod = (key: string, extra: Partial<GcsModule>): GcsModule => ({ key, settings: [], permissions: [], acpMenu: [], eventListeners: [], ...extra });

function registry(): GcsModuleRegistry {
  const r = new GcsModuleRegistry();
  r.register(
    mod("forums", {
      notificationTypes: [
        { key: "forums.mention", labelKey: "n.mention", important: false, defaultEmail: "DIGEST" },
        { key: "forums.reply", labelKey: "n.reply", important: false, defaultEmail: "DIGEST" },
        { key: "forums.reaction", labelKey: "n.reaction", important: false, defaultEmail: "OFF" },
      ],
    }),
  );
  r.register(mod("messages", { notificationTypes: [{ key: "pm.message", labelKey: "n.pm", important: true, defaultEmail: "INSTANT" }] }));
  r.register(mod("servers", { app: { optional: true, labelKey: "a.servers", icon: "fa-solid fa-server" }, notificationTypes: [{ key: "servers.ticket_new", labelKey: "n.ticket", important: false }] }));
  // Un plugin cu categoria lui și un tip care o folosește.
  r.register(
    mod("plugin.tournaments", {
      notificationCategories: [{ key: "tournaments", labelKey: "n.cat.tournaments", icon: "fa-solid fa-trophy", position: 65, tab: true }],
      notificationTypes: [
        { key: "tournaments.match", labelKey: "n.match", important: true, category: "tournaments", mention: true },
        { key: "tournaments.lost", labelKey: "n.lost", important: false, category: "nope" },
      ],
    }),
  );
  return r;
}

describe("categoriile notificărilor", () => {
  test("tipurile vechi primesc categoria după cheie sau modul; tipurile noi o declară", () => {
    expect(notificationCategoryOf("forums", { key: "forums.reply" })).toBe("content");
    expect(notificationCategoryOf("forums", { key: "forums.reaction" })).toBe("social");
    expect(notificationCategoryOf("profile", { key: "profile.badge" })).toBe("achievements");
    expect(notificationCategoryOf("chat", { key: "chat.sanction" })).toBe("moderation");
    expect(notificationCategoryOf("plugin.x", { key: "x.thing" })).toBe("system");
    expect(notificationCategoryOf("plugin.x", { key: "x.thing", category: "vip" })).toBe("vip");
    // Prefixul cheii bate modulul: o realizare declarată de modulul profilului e în Realizări.
    expect(notificationCategoryOf("profile", { key: "achievements.rank_up" })).toBe("achievements");
    expect(notificationCategoryOf("messages", { key: "pm.message" })).toBe("messages");
  });

  test("catalogul: categoriile cu tipuri, în ordinea pozițiilor; o categorie necunoscută cade în Sistem", () => {
    const catalog = notificationCatalog(registry());
    expect(catalog.map((c) => [c.key, c.types.map((t) => t.key)])).toEqual([
      ["content", ["forums.mention", "forums.reply"]],
      ["social", ["forums.reaction"]],
      ["messages", ["pm.message"]],
      ["servers", ["servers.ticket_new"]],
      ["tournaments", ["tournaments.match"]],
      ["system", ["tournaments.lost"]],
    ]);
  });

  test("categoriile apar și dispar cu aplicația: Servere oprită → fără categoria Servere", () => {
    const catalog = notificationCatalog(registry(), (key) => key !== "servers");
    expect(catalog.map((c) => c.key)).not.toContain("servers");
    expect(notificationCatalog(registry(), (key) => key !== "plugin.tournaments").map((c) => c.key)).toEqual(["content", "social", "messages", "servers"]);
  });

  test("taburile: Toate, Mențiuni (tipurile mențiune), apoi categoriile cu tab", () => {
    const tabs = notificationTabs(notificationCatalog(registry()));
    expect(tabs.map((t) => [t.key, t.types])).toEqual([
      ["all", null],
      ["mentions", ["forums.mention", "tournaments.match"]],
      ["messages", ["pm.message"]],
      ["servers", ["servers.ticket_new"]],
      ["tournaments", ["tournaments.match"]],
    ]);
  });
});
