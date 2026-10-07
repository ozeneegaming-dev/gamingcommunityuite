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
