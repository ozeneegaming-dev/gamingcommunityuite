import { acpAreas, buildAcpMenu, type GcsAcpRights } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { createRegistry } from "./registry";

/**
 * Navigația ACP pe zone (specul 2026-10-09-acp-navigatie-aplicatii §1.2), cu toate modulele aplicației și toate
 * drepturile: zonele, grupurile și paginile lor, în ordine.
 */
function allAreas() {
  const registry = createRegistry();
  const rights: GcsAcpRights = {};
  for (const s of registry.acpMenu()) for (const i of s.items) rights[i.section] = { view: true, edit: true, delete: true };
  return { registry, areas: acpAreas(buildAcpMenu(registry, rights)) };
}

const shape = (areas: ReturnType<typeof acpAreas>) =>
  Object.fromEntries(areas.map((a) => [a.key, a.groups.map((g) => [g.title, g.items.map((i) => i.key)])]));

describe("zonele ACP ale aplicației", () => {
  test("zonele și grupurile, în ordinea din spec", () => {
    const { areas } = allAreas();
    expect(areas.map((a) => a.key)).toEqual(["system", "community", "members", "appearance", "gaming", "vip", "stats", "apps"]);
    expect(shape(areas)).toEqual({
      system: [
        ["acp.menu.system.overview", ["system.files", "system.status"]],
        ["acp.menu.system.site_features", ["system.applications", "system.integrations", "system.api", "system.webhooks", "system.rss_import"]],
        [
          "acp.menu.system.settings",
          [
            "system.settings_general",
            "system.settings_terms",
            "system.settings_rules",
            "system.settings_posting",
            "system.settings_email",
            "system.settings_languages",
            "system.settings_auth",
            "system.settings_contact",
            "system.settings_2fa",
            "system.settings_advanced",
            "system.settings_pwa",
          ],
        ],
        ["acp.menu.system.discovery", ["system.search", "system.streams", "system.rss", "system.tags"]],
        ["acp.menu.system.promotion", ["system.ads", "system.seo", "system.share"]],
        ["acp.menu.system.support", ["system.logs", "system.cache"]],
        ["acp.menu.system.conversions", ["system.import"]],
      ],
      community: [
        ["acp.menu.community.forums_group", ["community.forums", "community.prefixes", "community.saved_actions", "community.forum_settings"]],
        ["acp.menu.community.chat_group", ["community.chat_channels", "community.chat_settings"]],
        ["acp.menu.community.chat_pro_group", ["community.chat_pro_settings", "community.chat_pro_bar", "community.chat_pro_emotes"]],
        ["acp.menu.members.moderation", ["members.queue", "members.reports", "members.antispam", "members.warnings", "members.tickets"]],
      ],
      members: [
        ["acp.menu.members.members", ["members.members", "members.groups", "members.promotions", "members.ip_tools", "members.gdpr", "members.groups_legend"]],
        ["acp.menu.members.staff", ["members.moderators", "members.acp_roles", "members.staff_page"]],
        ["acp.menu.members.member_settings", ["members.profiles", "members.reputation", "members.notifications", "members.bans", "members.referral"]],
        ["acp.menu.members.achievements", ["members.achievement_rules", "members.ranks", "members.badges", "members.achievement_settings"]],
        ["acp.menu.members.communication", ["members.bulk_mail"]],
      ],
      appearance: [
        ["acp.menu.appearance.style", ["appearance.themes", "appearance.templates", "appearance.css"]],
        ["acp.menu.appearance.layout", ["appearance.widgets", "appearance.footer", "system.menu_manager"]],
      ],
      gaming: [
        ["acp.menu.gaming.servers_group", ["gaming.servers", "gaming.server_admins", "gaming.server_maps", "gaming.servers_settings", "gaming.servers_bridge_settings"]],
        ["acp.menu.gaming.clans_group", ["gaming.clans", "gaming.clans_settings"]],
      ],
      vip: [["acp.menu.vip.vip_group", ["vip.tiers", "vip.subscribers", "vip.history", "vip.name_styles", "vip.frames", "vip.page"]]],
      stats: [
        ["acp.menu.stats.overview_group", ["stats.overview"]],
        ["acp.menu.stats.activity", ["stats.registrations", "stats.members", "stats.content", "stats.online"]],
        ["acp.menu.stats.apps", ["stats.vip", "stats.servers", "stats.clans"]],
      ],
      apps: [
        ["acp.menu.system.apps_manage", ["system.applications_shortcut"]],
        ["acp.menu.system.apps_dev", ["system.hooks", "system.porting"]],
      ],
    });
  });

  test("fiecare pagină din meniu (în afară de Dashboard) e într-o zonă; doar scurtătura Aplicații apare de două ori", () => {
    const { registry, areas } = allAreas();
    const hrefs = registry
      .acpMenu()
      .flatMap((s) => s.items)
      .filter((i) => !i.alias && i.href !== "/admin")
      .map((i) => i.href);
    const shown = areas.flatMap((a) => a.groups.flatMap((g) => g.items.filter((i) => !i.alias).map((i) => i.href)));
    expect(new Set(shown)).toEqual(new Set(hrefs));
    const aliases = areas.flatMap((a) => a.groups.flatMap((g) => g.items.filter((i) => i.alias)));
    expect(aliases.map((i) => i.href)).toEqual(["/admin/system/applications"]);
  });

  test("cu drept doar pe Grupuri: doar zona Membri, cu o singură pagină (Grupuri Pro oprită)", () => {
    const registry = createRegistry();
    const rights = { "members.groups": { view: true, edit: false, delete: false } };
    const areas = acpAreas(buildAcpMenu(registry, rights, () => false));
    expect(shape(areas)).toEqual({ members: [["acp.menu.members.members", ["members.groups"]]] });
    // Cu Grupuri Pro pornită: și „Legenda grupurilor”, cu același drept.
    expect(shape(acpAreas(buildAcpMenu(registry, rights, () => true)))).toEqual({ members: [["acp.menu.members.members", ["members.groups", "members.groups_legend"]]] });
  });
});
