import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSettingDef } from "@gcs/core";
import { serverWidgets } from "../widgets";
import { GcsBridgeAdmins } from "./bridge/admins";
import { BRIDGE_PERMISSION, BRIDGE_SETTING_DEFS, BRIDGE_SETTINGS_SECTION, SERVER_ADMINS_ACP_SECTION, SERVER_MAPS_ACP_SECTION } from "./bridge/config";
import { POLL_INTERVAL_SETTING, RETENTION_SETTING, SHOW_PLAYERS_SETTING } from "./poller";
import { SERVERS_ACP_SECTION } from "./service";
import { serverStatTiles } from "./stats";

const GLOBAL_STAFF = { root_admin: true, admin: true, super_moderator: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat). */
const MEMBERS = {
  ...GLOBAL_STAFF,
  moderator: true,
  vip_bronze: true,
  vip_silver: true,
  vip_gold: true,
  vip_legend: true,
  member: true,
  new_member: true,
} as const;
/** Cine vede serverele (și lista jucătorilor): toate grupurile, mai puțin Banat. */
const EVERYONE = { ...MEMBERS, guest: true } as const;

const permissions: GcsPermissionDef[] = [
  { key: "servers.view", scope: "group", labelKey: "permissions.servers.view", default: { ...EVERYONE } },
  { key: "servers.view_players", scope: "group", labelKey: "permissions.servers.view_players", default: { ...EVERYONE } },
  // Puntea cu serverele de joc (specul 2026-10-08-servere-bridge §15.1).
  { key: BRIDGE_PERMISSION.statsView, scope: "group", labelKey: "permissions.servers.stats_view", default: { ...EVERYONE } },
  { key: BRIDGE_PERMISSION.bansView, scope: "group", labelKey: "permissions.servers.bans_view", default: { ...EVERYONE } },
  { key: BRIDGE_PERMISSION.sanction, scope: "group", labelKey: "permissions.servers.sanction", default: { ...GLOBAL_STAFF } },
  { key: BRIDGE_PERMISSION.viewIps, scope: "group", labelKey: "permissions.servers.view_ips", default: { root_admin: true, admin: true } },
  { key: BRIDGE_PERMISSION.ticketsCreate, scope: "group", labelKey: "permissions.servers.tickets_create", default: { ...MEMBERS } },
  { key: BRIDGE_PERMISSION.ticketsManage, scope: "group", labelKey: "permissions.servers.tickets_manage", default: { ...GLOBAL_STAFF } },
  { key: BRIDGE_PERMISSION.linkIdentity, scope: "group", labelKey: "permissions.servers.link_identity", default: { ...MEMBERS } },
  { key: BRIDGE_PERMISSION.playersManage, scope: "group", labelKey: "permissions.servers.players_manage", default: { ...GLOBAL_STAFF } },
];

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");

/** ACP → Gaming → Servere → Setări (`/admin/settings/servers`) și Bridge și ELO (`/admin/settings/servers_bridge`). */
const settings: GcsSettingDef[] = [
  { key: POLL_INTERVAL_SETTING, type: "number", default: 30, section: "servers", labelKey: "settings.servers.poll_interval", validate: int(30, 300) },
  { key: RETENTION_SETTING, type: "number", default: 90, section: "servers", labelKey: "settings.servers.retention_days", validate: int(7, 365) },
  { key: SHOW_PLAYERS_SETTING, type: "boolean", default: true, section: "servers", labelKey: "settings.servers.show_players" },
  ...BRIDGE_SETTING_DEFS,
];

/** ACP → Gaming → Servere (etapa Gaming; Clanurile, Discord-ul și evenimentele vin în aceeași aplicație ACP). */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "gaming",
    title: "acp.menu.gaming.servers_group",
    icon: "fa-solid fa-server",
    items: [
      { key: SERVERS_ACP_SECTION, labelKey: "acp.menu.gaming.servers", href: "/admin/gaming/servers", section: SERVERS_ACP_SECTION, icon: "fa-solid fa-server" },
      { key: SERVER_ADMINS_ACP_SECTION, labelKey: "acp.menu.gaming.server_admins", href: "/admin/gaming/server-admins", section: SERVER_ADMINS_ACP_SECTION, icon: "fa-solid fa-user-shield" },
      { key: SERVER_MAPS_ACP_SECTION, labelKey: "acp.menu.gaming.server_maps", href: "/admin/gaming/server-maps", section: SERVER_MAPS_ACP_SECTION, icon: "fa-solid fa-map" },
      { key: "gaming.servers_settings", labelKey: "acp.menu.gaming.servers_settings", href: "/admin/settings/servers", section: "system.settings_servers", icon: "fa-solid fa-sliders" },
      { key: "gaming.servers_bridge_settings", labelKey: "acp.menu.gaming.servers_bridge", href: `/admin/settings/${BRIDGE_SETTINGS_SECTION}`, section: `system.settings_${BRIDGE_SETTINGS_SECTION}`, icon: "fa-solid fa-plug" },
    ],
  },
];

/**
 * Aplicația Servere (specul 2026-10-07-servere): statusul live al serverelor de joc ale comunității (CS 1.6, CS2 /
 * CS:GO, Minecraft Java și Bedrock), pagina `/servers` și pagina fiecărui server, widget-ul și plăcile de statistici.
 * Puntea cu serverele de joc (specul 2026-10-08-servere-bridge): pluginurile, adminii, sancțiunile, statisticile,
 * meciurile mix, contestațiile și hărțile.
 */
export const serversModule: GcsModule = {
  key: "servers",
  app: { optional: true, labelKey: "apps.servers", icon: "fa-solid fa-server" },
  permissions,
  settings,
  acpMenu,
  eventListeners: [],
  notificationTypes: [
    { key: "servers.ticket_new", labelKey: "notifications.type.servers.ticket_new", important: false, defaultEmail: "DIGEST" },
    { key: "servers.ticket_update", labelKey: "notifications.type.servers.ticket_update", important: false, defaultEmail: "DIGEST" },
    { key: "servers.player_linked", labelKey: "notifications.type.servers.player_linked", important: false, defaultEmail: "OFF" },
  ],
  // Presetările de admin implicite (Moderator, Admin, Head admin), o singură dată.
  seed: ({ tx }) => GcsBridgeAdmins.seedPresets(tx),
  widgets: serverWidgets,
  stats: serverStatTiles,
  // Imediat după Forum (macheta aprobată); adus de actualizarea meniului `nav:v3`.
  nav: [{ key: "servers", labelKey: "site.nav.servers", icon: "fa-solid fa-server", href: "/servers", position: 2, since: "nav:v3" }],
  navPrevious: [],
};
