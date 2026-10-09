import { describe, expect, test } from "vitest";
import type { GcsAcpMenuSection } from "../modules/registry";
import { acpAreaForPath, acpAreas, GCS_ACP_AREAS } from "./areas";

const item = (key: string, href: string, extra: Partial<GcsAcpMenuSection["items"][number]> = {}) => ({ key, labelKey: `l.${key}`, href, section: key, ...extra });

const menu: GcsAcpMenuSection[] = [
  { app: "system", title: "acp.menu.system.overview", items: [item("system.dashboard", "/admin"), item("system.files", "/admin/system/files")] },
  { app: "system", title: "acp.menu.system.settings", items: [item("system.settings_general", "/admin/settings/general")] },
  // Moderarea: secțiunile aplicației Membri, afișate în zona Comunitate (înregistrate înaintea forumului).
  { app: "members", area: "community", title: "acp.menu.members.moderation", items: [item("members.queue", "/admin/members/moderation/queue")] },
  { app: "members", title: "acp.menu.members.members", items: [item("members.members", "/admin/members"), item("members.groups", "/admin/groups")] },
  // O scurtătură în zona Aplicații spre o pagină din Sistem.
  { app: "system", area: "apps", title: "acp.menu.system.apps_manage", items: [item("system.applications_shortcut", "/admin/system/applications", { alias: true })] },
  { app: "system", title: "acp.menu.system.site_features", items: [item("system.applications", "/admin/system/applications")] },
  { app: "community", title: "acp.menu.community.forums_group", items: [item("community.forums", "/admin/community/forums")] },
  // O intrare mutată în altă zonă și sub alt grup decât ale secțiunii ei.
  {
    app: "gaming",
    title: "acp.menu.gaming.servers_group",
    items: [item("gaming.servers", "/admin/gaming/servers"), item("stats.servers", "/admin/stats/servers", { area: "stats", group: "acp.menu.stats.apps" })],
  },
  // Un plugin: grup nou (titlul = numele pluginului), în zona Aplicații.
  { app: "system", area: "apps", title: "plugin.gcs.hello.name", items: [item("plugin.gcs.hello.acp", "/admin/plugins/gcs.hello")] },
];

describe("acpAreas", () => {
  const areas = acpAreas(menu);

  test("zonele apar în ordinea fixă; Dashboard-ul nu e în nicio zonă; zonele fără pagini lipsesc", () => {
    expect(areas.map((a) => a.key)).toEqual(["system", "community", "members", "gaming", "stats", "apps"]);
    expect(GCS_ACP_AREAS.indexOf("system")).toBeLessThan(GCS_ACP_AREAS.indexOf("apps"));
    expect(areas.flatMap((a) => a.groups.flatMap((g) => g.items)).some((i) => i.href === "/admin")).toBe(false);
  });

  test("grupurile urmează ordinea cunoscută a nucleului, nu ordinea înregistrării", () => {
    const community = areas.find((a) => a.key === "community")!;
    expect(community.groups.map((g) => g.title)).toEqual(["acp.menu.community.forums_group", "acp.menu.members.moderation"]);
    const apps = areas.find((a) => a.key === "apps")!;
    expect(apps.groups.map((g) => g.title)).toEqual(["acp.menu.system.apps_manage", "plugin.gcs.hello.name"]);
  });

  test("intrarea cu altă zonă și alt grup ajunge acolo; secțiunile cu același titlu se unesc", () => {
    const stats = areas.find((a) => a.key === "stats")!;
    expect(stats.groups).toEqual([{ title: "acp.menu.stats.apps", items: [{ key: "stats.servers", labelKey: "l.stats.servers", href: "/admin/stats/servers", alias: false }] }]);
    const gaming = areas.find((a) => a.key === "gaming")!;
    expect(gaming.groups[0]!.items.map((i) => i.key)).toEqual(["gaming.servers"]);
  });

  test("scurtăturile sunt marcate", () => {
    const apps = areas.find((a) => a.key === "apps")!;
    expect(apps.groups[0]!.items[0]).toMatchObject({ key: "system.applications_shortcut", alias: true });
  });
});

describe("acpAreaForPath", () => {
  const areas = acpAreas(menu);

  test("potrivirea exactă sau cea mai lungă cale-părinte; scurtăturile nu decid zona", () => {
    expect(acpAreaForPath(areas, "/admin/groups")).toEqual({ area: "members", item: "members.groups" });
    expect(acpAreaForPath(areas, "/admin/members/12")).toEqual({ area: "members", item: "members.members" });
    expect(acpAreaForPath(areas, "/admin/members/moderation/queue")).toEqual({ area: "community", item: "members.queue" });
    expect(acpAreaForPath(areas, "/admin/system/applications/plugins/gcs.hello")).toEqual({ area: "system", item: "system.applications" });
    expect(acpAreaForPath(areas, "/admin/plugins/gcs.hello/settings")).toEqual({ area: "apps", item: "plugin.gcs.hello.acp" });
  });

  test("Dashboard-ul și căile necunoscute nu au zonă", () => {
    expect(acpAreaForPath(areas, "/admin")).toBeNull();
    expect(acpAreaForPath(areas, "/admin/nimic")).toBeNull();
  });
});
