import { isIP } from "node:net";
import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";
import type { GcsEloConfig } from "./elo";
import { DEFAULT_MAP_IMAGE_MODE, MAP_IMAGE_MODES, isMapImageMode, mapTemplateError, mapTemplateHttpAllowed } from "./mapImages";

/**
 * Setările punții (specul 2026-10-08-servere-bridge §15.2), în ACP → Gaming → Servere → Bridge și ELO
 * (`/admin/settings/servers_bridge`), plus cheile ACP, permisiunile și tipurile atașamentelor aplicației.
 */

export const BRIDGE_SETTINGS_SECTION = "servers_bridge";

export const BRIDGE_SETTING = {
  heartbeat: "servers.bridge_heartbeat",
  events: "servers.bridge_events",
  eloStart: "servers.elo_start",
  eloK: "servers.elo_k",
  eloKNew: "servers.elo_k_new",
  eloProvisional: "servers.elo_provisional",
  eloPerformance: "servers.elo_performance",
  mixMinRounds: "servers.mix_min_rounds",
  rankMinMinutes: "servers.rank_min_minutes",
  adminInactiveDays: "servers.admin_inactive_days",
  tempbanMax: "servers.tempban_max",
  retentionDays: "servers.bridge_retention_days",
  mapTemplateCs16: "servers.map_template_cs16",
  mapTemplateCs2: "servers.map_template_cs2",
  /** Modul șablonului pe joc: `direct` (implicit, browserul încarcă imaginea de la adresă) sau `copy` (jobul o aduce). */
  mapModeCs16: "servers.map_mode_cs16",
  mapModeCs2: "servers.map_mode_cs2",
  /** Înrolarea automată a serverelor necunoscute (specul plugin-v2 §5), pornită implicit; aprobarea rămâne manuală. */
  enrollEnabled: "servers.enroll_enabled",
  /** IP-urile / CIDR-urile care nu se pot înrola (butonul „Blochează IP” din ACP adaugă aici). */
  enrollBlockedIps: "servers.enroll_blocked_ips",
  /** Demo-urile meciurilor mix (specul 2026-10-08-servere-hltv §2.3): păstrarea, mărimea maximă pe demo și cota totală. */
  demoRetentionDays: "servers.demo_retention_days",
  demoMaxMb: "servers.demo_max_mb",
  demoQuotaGb: "servers.demo_quota_gb",
} as const;

/** Secțiunile ACP ale punții. */
export const SERVER_ADMINS_ACP_SECTION = "gaming.server_admins";
export const SERVER_MAPS_ACP_SECTION = "gaming.server_maps";

/** Permisiunile de grup ale punții (§15.1). */
export const BRIDGE_PERMISSION = {
  statsView: "servers.stats_view",
  bansView: "servers.bans_view",
  sanction: "servers.sanction",
  viewIps: "servers.view_ips",
  ticketsCreate: "servers.tickets_create",
  ticketsManage: "servers.tickets_manage",
  linkIdentity: "servers.link_identity",
  playersManage: "servers.players_manage",
  /** Descărcarea demo-urilor meciurilor mix (specul 2026-10-08-servere-hltv §2.3). */
  demosDownload: "servers.demos_download",
} as const;

/** Atașamentele: imaginea unei hărți (publică) și dovezile unei sancțiuni / unui tichet. */
export const MAP_IMAGE = "servers.map";
export const SANCTION_EVIDENCE = "servers.sanction";
export const TICKET_EVIDENCE = "servers.ticket";

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");

/** Cheile șablonului și ale modului pe joc (doar jocurile cu punte au imagini de hărți). */
export const mapTemplateSetting = (game: string): string | null => (game === "cs2" ? BRIDGE_SETTING.mapTemplateCs2 : game === "cs16" ? BRIDGE_SETTING.mapTemplateCs16 : null);
export const mapModeSetting = (game: string): string | null => (game === "cs2" ? BRIDGE_SETTING.mapModeCs2 : game === "cs16" ? BRIDGE_SETTING.mapModeCs16 : null);

/** Un șablon de adresă la salvare: gol sau https cu `{map}` (http doar în dezvoltare); vezi `mapTemplateError`. */
const validMapTemplate = (v: unknown) => mapTemplateError(v, { allowHttp: mapTemplateHttpAllowed() });
const validMapMode = (v: unknown) => (isMapImageMode(v) ? null : "invalid_choice");

/** Lista IP-urilor blocate la înrolare: gol sau IP-uri / CIDR-uri valide, separate prin virgulă sau spațiu (max 500). */
export function enrollBlockedError(v: unknown): string | null {
  if (v === "") return null;
  if (typeof v !== "string" || v.length > 4000) return "invalid_ip_list";
  const entries = v.split(/[\s,]+/).filter(Boolean);
  if (entries.length > 500) return "invalid_ip_list";
  for (const e of entries) {
    const [address, prefix, ...rest] = e.split("/");
    const family = isIP(address ?? "");
    if (family === 0 || rest.length > 0) return "invalid_ip_list";
    if (prefix !== undefined && !(/^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 6 ? 128 : 32))) return "invalid_ip_list";
  }
  return null;
}

const S = BRIDGE_SETTINGS_SECTION;
export const BRIDGE_SETTING_DEFS: GcsSettingDef[] = [
  { key: BRIDGE_SETTING.heartbeat, type: "number", default: 30, section: S, labelKey: "settings.servers.bridge_heartbeat", validate: int(15, 120) },
  { key: BRIDGE_SETTING.events, type: "number", default: 10, section: S, labelKey: "settings.servers.bridge_events", validate: int(5, 60) },
  { key: BRIDGE_SETTING.eloStart, type: "number", default: 1000, section: S, labelKey: "settings.servers.elo_start", validate: int(100, 3000) },
  { key: BRIDGE_SETTING.eloK, type: "number", default: 25, section: S, labelKey: "settings.servers.elo_k", validate: int(1, 100) },
  { key: BRIDGE_SETTING.eloKNew, type: "number", default: 40, section: S, labelKey: "settings.servers.elo_k_new", validate: int(1, 100) },
  { key: BRIDGE_SETTING.eloProvisional, type: "number", default: 10, section: S, labelKey: "settings.servers.elo_provisional", validate: int(0, 100) },
  { key: BRIDGE_SETTING.eloPerformance, type: "number", default: 25, section: S, labelKey: "settings.servers.elo_performance", validate: int(0, 50) },
  { key: BRIDGE_SETTING.mixMinRounds, type: "number", default: 10, section: S, labelKey: "settings.servers.mix_min_rounds", validate: int(1, 30) },
  { key: BRIDGE_SETTING.rankMinMinutes, type: "number", default: 30, section: S, labelKey: "settings.servers.rank_min_minutes", validate: int(0, 6000) },
  { key: BRIDGE_SETTING.adminInactiveDays, type: "number", default: 7, section: S, labelKey: "settings.servers.admin_inactive_days", validate: int(1, 365) },
  { key: BRIDGE_SETTING.tempbanMax, type: "number", default: 10_080, section: S, labelKey: "settings.servers.tempban_max", validate: int(1, 525_600) },
  { key: BRIDGE_SETTING.retentionDays, type: "number", default: 180, section: S, labelKey: "settings.servers.bridge_retention_days", validate: int(30, 730) },
  // Șablonul gol implicit: GCS nu livrează nicio adresă de imagini; fiecare site își pune sursa lui.
  { key: BRIDGE_SETTING.mapTemplateCs16, type: "string", default: "", section: S, labelKey: "settings.servers.map_template_cs16", validate: validMapTemplate },
  { key: BRIDGE_SETTING.mapModeCs16, type: "string", default: DEFAULT_MAP_IMAGE_MODE, section: S, labelKey: "settings.servers.map_mode_cs16", options: [...MAP_IMAGE_MODES], validate: validMapMode },
  { key: BRIDGE_SETTING.mapTemplateCs2, type: "string", default: "", section: S, labelKey: "settings.servers.map_template_cs2", validate: validMapTemplate },
  { key: BRIDGE_SETTING.mapModeCs2, type: "string", default: DEFAULT_MAP_IMAGE_MODE, section: S, labelKey: "settings.servers.map_mode_cs2", options: [...MAP_IMAGE_MODES], validate: validMapMode },
  { key: BRIDGE_SETTING.enrollEnabled, type: "boolean", default: true, section: S, labelKey: "settings.servers.enroll_enabled" },
  { key: BRIDGE_SETTING.enrollBlockedIps, type: "string", default: "", section: S, labelKey: "settings.servers.enroll_blocked_ips", validate: enrollBlockedError, multiline: true },
  { key: BRIDGE_SETTING.demoRetentionDays, type: "number", default: 14, section: S, labelKey: "settings.servers.demo_retention_days", validate: int(1, 365) },
  { key: BRIDGE_SETTING.demoMaxMb, type: "number", default: 300, section: S, labelKey: "settings.servers.demo_max_mb", validate: int(10, 2000) },
  { key: BRIDGE_SETTING.demoQuotaGb, type: "number", default: 20, section: S, labelKey: "settings.servers.demo_quota_gb", validate: int(1, 2000) },
];

/** Configurația ELO din setări. */
export async function eloConfig(settings: GcsSettingsService): Promise<GcsEloConfig & { start: number; minRounds: number }> {
  const [k, kNew, provisional, performance, start, minRounds] = await Promise.all([
    settings.get<number>(BRIDGE_SETTING.eloK),
    settings.get<number>(BRIDGE_SETTING.eloKNew),
    settings.get<number>(BRIDGE_SETTING.eloProvisional),
    settings.get<number>(BRIDGE_SETTING.eloPerformance),
    settings.get<number>(BRIDGE_SETTING.eloStart),
    settings.get<number>(BRIDGE_SETTING.mixMinRounds),
  ]);
  return { k, kNew, provisional, performance: performance / 100, start, minRounds };
}

/** Jocurile cu punte (pluginuri): CS 1.6 (AMX Mod X) și CS2 (CounterStrikeSharp). */
export const BRIDGE_GAMES = ["cs16", "cs2"] as const;
export const isBridgeGame = (game: string) => (BRIDGE_GAMES as readonly string[]).includes(game);
