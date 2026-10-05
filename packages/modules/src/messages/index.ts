import type { GcsModule, GcsPermissionDef, GcsSettingDef } from "@gcs/core";

const ADMINS = { root_admin: true, admin: true } as const;
const STAFF = { ...ADMINS, super_moderator: true, moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;

/**
 * Mesajele private (specul etapei 3, §6). `pm.max_conversations` și `pm.flood_seconds` există din etapa 1
 * (modulul core).
 */
const permissions: GcsPermissionDef[] = [
  { key: "pm.send", scope: "group", labelKey: "permissions.pm.send", default: { ...MEMBERS } },
  {
    key: "pm.max_participants",
    scope: "group",
    labelKey: "permissions.pm.max_participants",
    merge: "max",
    default: {
      new_member: 5,
      member: 5,
      vip_bronze: 10,
      vip_silver: 10,
      vip_gold: 10,
      vip_legend: 10,
      moderator: 25,
      super_moderator: 25,
      admin: 25,
      root_admin: 25,
    },
  },
];

const settings: GcsSettingDef[] = [
  {
    key: "pm.messages_per_page",
    type: "number",
    default: 20,
    section: "messages",
    labelKey: "settings.pm.messages_per_page",
    validate: (v) => (Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 100 ? null : "invalid_range"),
  },
];

/** Modulul Mesaje private (specul etapei 3). */
export const messagesModule: GcsModule = {
  key: "messages",
  permissions,
  settings,
  acpMenu: [],
  eventListeners: [],
};
