import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsStatTile, GcsStatsContext } from "@gcs/core";
import { clanWidgets } from "../widgets";
import { clanMemberGrants } from "./forum";
import { CLAN_SETTINGS } from "./options";
import { CLANS_ACP_SECTION, CLANS_SETTINGS_ACP_SECTION } from "./service";

const STAFF = { root_admin: true, admin: true, super_moderator: true, moderator: true } as const;
const GLOBAL_MODS = { root_admin: true, admin: true, super_moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat). */
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;
const EVERYONE = { ...MEMBERS, guest: true } as const;

const permissions: GcsPermissionDef[] = [
  { key: "clans.view", scope: "group", labelKey: "permissions.clans.view", default: { ...EVERYONE } },
  // Doar VIP-urile și staff-ul creează clanuri (decizia proprietarului); grupurile se schimbă din ACP.
  { key: "clans.create", scope: "group", labelKey: "permissions.clans.create", default: { ...VIPS, ...STAFF } },
  { key: "clans.join", scope: "group", labelKey: "permissions.clans.join", default: { ...MEMBERS } },
  // Limita de membri a unui clan după grupurile liderului (-1 = nelimitat); câștigă valoarea cea mai mare.
  {
    key: "clans.max_members",
    scope: "group",
    labelKey: "permissions.clans.max_members",
    default: { new_member: 20, member: 20, vip_bronze: 25, vip_silver: 35, vip_gold: 50, vip_legend: 100, moderator: -1, super_moderator: -1, admin: -1, root_admin: -1 },
  },
  // Staff-ul pe site: vede clanurile în așteptare, editează, blochează, desființează orice clan, transferă conducerea.
  { key: "clans.moderate", scope: "group", labelKey: "permissions.clans.moderate", default: { ...GLOBAL_MODS } },
];

/** ACP → Gaming → Clanuri. */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "gaming",
    title: "acp.menu.gaming.clans_group",
    icon: "fa-solid fa-people-group",
    items: [
      { key: CLANS_ACP_SECTION, labelKey: "acp.menu.gaming.clans", href: "/admin/gaming/clans", section: CLANS_ACP_SECTION, icon: "fa-solid fa-people-group" },
      { key: "gaming.clans_settings", labelKey: "acp.menu.gaming.clans_settings", href: "/admin/gaming/clans/settings", section: CLANS_SETTINGS_ACP_SECTION, icon: "fa-solid fa-sliders" },
    ],
  },
];

/** Placa „Clanuri” din panoul de statistici: clanurile active (lipsește fără niciun clan). */
async function clanStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const total = await db.clan.count({ where: { status: "ACTIVE" } });
  if (total === 0) return [];
  return [{ key: "clans.count", labelKey: "stats.tiles.clans", value: total, icon: "fa-solid fa-people-group", href: "/clans", color: "#F4B740" }];
}

/**
 * Aplicația Clanuri (specul 2026-10-08-clanuri): tag, logo, banner, rolurile Lider / Ofițer / Membru, cererile și
 * invitațiile, forumul privat (drepturi date membrilor, nu grupurilor), clasamentul, widget-ul și placa.
 */
export const clansModule: GcsModule = {
  key: "clans",
  app: { optional: true, labelKey: "apps.clans", icon: "fa-solid fa-people-group" },
  permissions,
  settings: CLAN_SETTINGS,
  acpMenu,
  eventListeners: [],
  notificationTypes: [
    { key: "clans.invite", labelKey: "notifications.type.clans.invite", important: false, defaultEmail: "DIGEST" },
    { key: "clans.request", labelKey: "notifications.type.clans.request", important: false, defaultEmail: "DIGEST", countEach: true },
    { key: "clans.membership", labelKey: "notifications.type.clans.membership", important: false, defaultEmail: "DIGEST" },
    { key: "clans.review", labelKey: "notifications.type.clans.review", important: false, defaultEmail: "INSTANT" },
  ],
  widgets: clanWidgets,
  stats: clanStatTiles,
  // După Servere; adus de actualizarea meniului `nav:v4`.
  nav: [{ key: "clans", labelKey: "site.nav.clans", icon: "fa-solid fa-people-group", href: "/clans", position: 3, since: "nav:v4" }],
  navPrevious: [],
  memberGrants: clanMemberGrants,
};
