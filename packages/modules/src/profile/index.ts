import { coreAchievementEvents } from "./achievementEvents";
import { profileWidgets } from "../widgets";
import type { GcsModule, GcsPermissionDef, GcsSettingDef } from "@gcs/core";
import { seedProfileDemo } from "./demo";
import { seedProfile } from "./seed";

const ADMINS = { root_admin: true, admin: true } as const;
const STAFF = { ...ADMINS, super_moderator: true, moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat). */
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;

function groupPermission(key: string, defaults: GcsPermissionDef["default"], merge?: "max" | "min"): GcsPermissionDef {
  const def: GcsPermissionDef = { key, scope: "group", labelKey: `permissions.${key}`, default: defaults };
  if (merge) def.merge = merge;
  return def;
}

/**
 * Setările de grup ale profilului (specul etapei 3, §6). `profile.styled_name`, `profile.avatar_frame` și
 * `profile.animated_cover` există din etapa 1, în modulul core.
 */
const permissions: GcsPermissionDef[] = [
  groupPermission("profile.cover", { ...MEMBERS }),
  groupPermission("profile.wall_post", { ...MEMBERS }),
  // Textul afișat în locul rangului (ex. „Staff”); gol = rangul obținut.
  groupPermission("profile.rank_override", { root_admin: "Staff", admin: "Staff", super_moderator: "Staff", moderator: "Staff" }),
  groupPermission("profile.see_private_fields", { ...STAFF }),
  groupPermission("profile.moderate", { ...STAFF }),
];

const between = (min: number, max: number) => (v: unknown) =>
  typeof v === "number" && v >= min && v <= max ? null : "invalid_range";

const settings: GcsSettingDef[] = [
  { key: "profile.cover_max_mb", type: "number", default: 2, section: "profiles", labelKey: "settings.profile.cover_max_mb", validate: between(0.1, 50) },
  { key: "profile.wall_enabled", type: "boolean", default: true, section: "profiles", labelKey: "settings.profile.wall_enabled" },
  // Lungimea maximă a semnăturii (caractere de text), etapa 5.
  { key: "profile.signature_max_chars", type: "number", default: 500, section: "profiles", labelKey: "settings.profile.signature_max_chars", validate: between(0, 5000) },
  // Imaginile din semnătură (adrese https, afișate mici; 0 = niciuna), specul 2026-10-07-editor-campuri.
  { key: "profile.signature_max_images", type: "number", default: 1, section: "profiles", labelKey: "settings.profile.signature_max_images", validate: (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5 ? null : "invalid_range") },
  // Profil gaming v2: cheia FACEIT Data API (tabul FACEIT CS2 apare doar cu ea) și pragul insignei automate „Sponsor”
  // (suma donațiilor, în unități întregi ale monedei; 0 = fără insignă).
  { key: "profile.faceit_api_key", type: "secret", default: "", section: "profiles", labelKey: "settings.profile.faceit_api_key", validate: (v) => (typeof v === "string" && v.length <= 200 ? null : "too_long") },
  { key: "profile.sponsor_min_amount", type: "number", default: 50, section: "profiles", labelKey: "settings.profile.sponsor_min_amount", validate: between(0, 1_000_000) },
  // Realizări v2: grupurile excluse din reguli (nu primesc nimic) și pragul badge-urilor rare (% din membri).
  {
    key: "achievements.excluded_groups",
    type: "json",
    default: [],
    section: "achievements",
    labelKey: "settings.achievements.excluded_groups",
    validate: (v) => (Array.isArray(v) && v.length <= 100 && v.every((x) => Number.isInteger(x) && (x as number) > 0) ? null : "invalid_choice"),
  },
  { key: "achievements.rare_percent", type: "number", default: 5, section: "achievements", labelKey: "settings.achievements.rare_percent", validate: between(0.1, 100) },
  // Ordinea câmpurilor din postbit (cheile câmpurilor); cele marcate „în postbit” și nelistate vin la final (etapa 5).
  {
    key: "postbit.fields",
    type: "json",
    default: [],
    section: "postbit",
    labelKey: "settings.postbit.fields",
    validate: (v) => (Array.isArray(v) && v.length <= 50 && v.every((k) => typeof k === "string" && /^[a-z0-9_]{1,40}$/.test(k)) ? null : "invalid_choice"),
  },
];

/**
 * Modulul Profil (specul etapei 3): profil, social, realizări, promovări, cosmetice.
 * Intrările din meniul ACP (Realizări, Profiluri, Promovări) sunt deja declarate de modulul core (spec §12.1).
 */
export const profileModule: GcsModule = {
  key: "profile",
  achievementEvents: coreAchievementEvents,
  widgets: profileWidgets,
  // Coloana din dreapta a paginii de start (macheta HomeComplete): „Ultimele realizări”.
  widgetLayout: { index: [{ zone: "sidebar", type: "profile.recentBadges" }] },
  // Profil gaming v2: conturile externe legate (apar doar cu datele aduse și cu tabul lăsat vizibil de membru).
  profileTabs: [
    { key: "steam", labelKey: "profile.tabs.steam", icon: "fa-brands fa-steam", position: 30 },
    { key: "faceit", labelKey: "profile.tabs.faceit", icon: "fa-solid fa-trophy", position: 40 },
  ],
  // Membri v2: conturile legate (Steam, Discord, Google) pe fișa membrului din ACP.
  memberPanels: [{ key: "connections", labelKey: "acp.member.panels.connections", icon: "fa-solid fa-link", position: 100, kind: "card", surfaces: ["acp"] }],
  permissions,
  settings,
  acpMenu: [],
  notificationTypes: [
    { key: "profile.follower", labelKey: "notifications.type.profile.follower", important: false, defaultEmail: "DIGEST" },
    { key: "profile.wall", labelKey: "notifications.type.profile.wall", important: false, defaultEmail: "DIGEST" },
    { key: "profile.badge", labelKey: "notifications.type.profile.badge", important: false, defaultEmail: "OFF" },
  ],
  eventListeners: [],
  seed: seedProfile,
  seedDemo: seedProfileDemo,
};
