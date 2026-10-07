import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSettingDef } from "@gcs/core";
import { serverWidgets } from "../widgets";
import { POLL_INTERVAL_SETTING, RETENTION_SETTING, SHOW_PLAYERS_SETTING } from "./poller";
import { SERVERS_ACP_SECTION } from "./service";
import { serverStatTiles } from "./stats";

/** Cine vede serverele (și lista jucătorilor): toate grupurile, mai puțin Banat. */
const EVERYONE = {
  root_admin: true,
  admin: true,
  super_moderator: true,
  moderator: true,
  vip_bronze: true,
  vip_silver: true,
  vip_gold: true,
  vip_legend: true,
  member: true,
  new_member: true,
  guest: true,
} as const;

const permissions: GcsPermissionDef[] = [
  { key: "servers.view", scope: "group", labelKey: "permissions.servers.view", default: { ...EVERYONE } },
  { key: "servers.view_players", scope: "group", labelKey: "permissions.servers.view_players", default: { ...EVERYONE } },
];

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");

/** ACP → Gaming → Servere → Setări (`/admin/settings/servers`). */
const settings: GcsSettingDef[] = [
  { key: POLL_INTERVAL_SETTING, type: "number", default: 30, section: "servers", labelKey: "settings.servers.poll_interval", validate: int(30, 300) },
  { key: RETENTION_SETTING, type: "number", default: 90, section: "servers", labelKey: "settings.servers.retention_days", validate: int(7, 365) },
  { key: SHOW_PLAYERS_SETTING, type: "boolean", default: true, section: "servers", labelKey: "settings.servers.show_players" },
];

/** ACP → Gaming → Servere (etapa Gaming; Clanurile, Discord-ul și evenimentele vin în aceeași aplicație ACP). */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "gaming",
    title: "acp.menu.gaming.servers_group",
    icon: "fa-solid fa-server",
    items: [
      { key: SERVERS_ACP_SECTION, labelKey: "acp.menu.gaming.servers", href: "/admin/gaming/servers", section: SERVERS_ACP_SECTION, icon: "fa-solid fa-server" },
      { key: "gaming.servers_settings", labelKey: "acp.menu.gaming.servers_settings", href: "/admin/settings/servers", section: "system.settings_servers", icon: "fa-solid fa-sliders" },
    ],
  },
];

/**
 * Aplicația Servere (specul 2026-10-07-servere): statusul live al serverelor de joc ale comunității (CS 1.6, CS2 /
 * CS:GO, Minecraft Java și Bedrock), pagina `/servers` și pagina fiecărui server, widget-ul și plăcile de statistici.
 */
export const serversModule: GcsModule = {
  key: "servers",
  app: { optional: true, labelKey: "apps.servers", icon: "fa-solid fa-server" },
  permissions,
  settings,
  acpMenu,
  eventListeners: [],
  widgets: serverWidgets,
  stats: serverStatTiles,
  // Imediat după Forum (macheta aprobată); adus de actualizarea meniului `nav:v3`.
  nav: [{ key: "servers", labelKey: "site.nav.servers", icon: "fa-solid fa-server", href: "/servers", position: 2, since: "nav:v3" }],
  navPrevious: [],
};
