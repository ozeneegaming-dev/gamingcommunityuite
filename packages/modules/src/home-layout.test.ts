import { defaultWidgetLayout, type GcsModuleRegistry } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { createRegistry } from "./registry";

/**
 * Prima pagină (macheta HomeComplete, 2026-11-04): layout-ul implicit al instalărilor noi (anunțul și „Acum în
 * comunitate” sus; chat-ul în coloana din stânga; în dreapta serverele, obiectivul lunii, cine e online, topul
 * săptămânii, ultimele postări și meciurile live; panoul de statistici jos) și widget-urile noi / câmpurile lor.
 */
describe("prima pagină implicită (instalările noi)", () => {
  const registry = createRegistry();
  const def = (key: string) => registry.widgetDef(key)!.def;

  test("zonele și ordinea, cu configurările coloanei înguste", () => {
    const layout = defaultWidgetLayout(registry, "index");
    expect(layout.filter((p) => p.zone === "top").map((p) => p.type)).toEqual(["core.announcement", "core.nowCommunity"]);
    expect(layout.filter((p) => p.zone === "main").map((p) => p.type)).toEqual(["chat.shoutbox"]);
    expect(layout.filter((p) => p.zone === "sidebar").map((p) => p.type)).toEqual(["servers.list", "vip.donationGoal", "core.online", "core.ranking", "forums.recentPosts", "servers.liveMatches"]);
    expect(layout.filter((p) => p.zone === "bottom").map((p) => p.type)).toEqual(["core.statsPanel"]);
    const config = (type: string) => layout.find((p) => p.type === type)?.config;
    expect(config("servers.list")).toEqual({ limit: 5, game: "", layout: "compact" });
    expect(config("core.ranking")).toEqual({ metric: "posts", period: "week", tabs: "community" });
    // Fiecare configurare implicită trece validarea widget-ului (ca la „Restabilește implicit”).
    for (const p of layout) expect(def(p.type).config(p.config ?? def(p.type).defaultConfig), p.type).not.toBeNull();
    // „Ultimele realizări” nu mai e implicit pe prima pagină (rămâne în catalog).
    expect(layout.some((p) => p.type === "profile.recentBadges")).toBe(false);
    expect(def("profile.recentBadges")).toBeDefined();
  });

  test("un widget necunoscut (aplicația lipsă) se sare: fără Servere, coloana începe cu cine e online", () => {
    // Registrul văzut fără widget-urile aplicației Servere (ca o instalare fără ea).
    const withoutServers = { all: () => registry.all(), widgetDef: (k: string) => (k.startsWith("servers.") ? undefined : registry.widgetDef(k)) } as unknown as GcsModuleRegistry;
    const layout = defaultWidgetLayout(withoutServers, "index");
    expect(layout.filter((p) => p.zone === "sidebar").map((p) => p.type)).toEqual(["vip.donationGoal", "core.online", "core.ranking", "forums.recentPosts"]);
  });

  test("„Meciuri live”: widget-ul aplicației Servere, cu câte meciuri arată", () => {
    const w = registry.widgetDef("servers.liveMatches")!;
    expect(w.module).toBe("servers");
    expect(w.def.icon).toBe("fa-solid fa-tower-broadcast");
    expect(w.def.zones).toEqual(["top", "bottom", "sidebar", "main"]);
    expect(w.def.config({ limit: 3 })).toEqual({ limit: 3, icon: "" });
    expect(w.def.config({})).toEqual({ limit: 3, icon: "" });
    expect(w.def.config({ limit: 11 })).toBeNull();
  });

  test("câmpurile noi: aspectul serverelor și tab-urile clasamentului (amplasările vechi primesc valorile de până acum)", () => {
    expect(def("servers.list").config({ limit: 5, game: "" })).toEqual({ limit: 5, game: "", layout: "full", icon: "" });
    expect(def("servers.list").config({ layout: "compact" })).toMatchObject({ layout: "compact" });
    expect(def("servers.list").config({ layout: "mini" })).toBeNull();
    expect(def("core.ranking").config({ metric: "posts", period: "day" })).toEqual({ tabs: "forum", metric: "posts", period: "day", icon: "" });
    expect(def("core.ranking").config({ tabs: "community", period: "week" })).toMatchObject({ tabs: "community", period: "week" });
    expect(def("core.ranking").config({ tabs: "clans" })).toBeNull();
  });

  test("„Acum în comunitate”: widget lat (sus, coloana din stânga, jos), cu meciul live și serverele afișate sau ascunse", () => {
    const w = registry.widgetDef("core.nowCommunity")!;
    expect(w.def.zones).toEqual(["top", "main", "bottom"]);
    expect(w.def.config({})).toEqual({ live: "show", servers: "show" });
    expect(w.def.config({ live: "hide", servers: "show" })).toEqual({ live: "hide", servers: "show" });
    expect(w.def.config({ servers: "maybe" })).toBeNull();
    expect(w.def.fields?.map((f) => f.key)).toEqual(["live", "servers"]);
  });
});
