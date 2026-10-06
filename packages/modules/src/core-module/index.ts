import type { GcsAcpApp, GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsSettingDef } from "@gcs/core";

/** Grupurile create la instalare (spec §6.1). */
export const DEFAULT_GROUP_KEYS = [
  "root_admin",
  "admin",
  "super_moderator",
  "moderator",
  "member",
  "new_member",
  "banned",
  "guest",
  "vip_bronze",
  "vip_silver",
  "vip_gold",
  "vip_legend",
] as const;

const ADMINS = { root_admin: true, admin: true } as const;
const STAFF = { ...ADMINS, super_moderator: true, moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;

function setting(
  key: string,
  type: GcsSettingDef["type"],
  defaultValue: unknown,
  section: string,
  validate?: GcsSettingDef["validate"],
): GcsSettingDef {
  const def: GcsSettingDef = { key, type, default: defaultValue, section, labelKey: `settings.${key}` };
  if (validate) def.validate = validate;
  return def;
}

const isPort = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536 ? null : "invalid_port");
const isUrlOrEmpty = (v: unknown) => (v === "" || URL.canParse(v as string) ? null : "invalid_url");
const isEmailOrEmpty = (v: unknown) => (v === "" || /^[^\s@]+@[^\s@]+$/.test(v as string) ? null : "invalid_email");
const oneOf = (values: string[]) => (v: unknown) => (values.includes(v as string) ? null : "invalid_choice");
const notEmpty = (v: unknown) => ((v as string).trim() === "" ? "required" : null);

const settings: GcsSettingDef[] = [
  setting("site.name", "string", "RED-LINE", "general", notEmpty),
  setting("site.url", "string", "", "general", isUrlOrEmpty),
  { ...setting("site.locale", "string", "ro", "general", oneOf(["ro", "en"])), options: ["ro", "en"] },
  setting("site.timezone", "string", "Europe/Bucharest", "general", notEmpty),
  { ...setting("site.theme", "string", "dark", "general", oneOf(["dark", "light", "auto"])), options: ["dark", "light", "auto"] },
  setting("email.smtp_host", "string", "", "email"),
  setting("email.smtp_port", "number", 587, "email", isPort),
  setting("email.smtp_user", "string", "", "email"),
  setting("email.smtp_pass", "secret", "", "email"),
  setting("email.from", "string", "", "email", isEmailOrEmpty),
  setting("auth.registration_open", "boolean", true, "auth"),
  setting("auth.email_confirm", "boolean", true, "auth"),
  setting("auth.discord_client_id", "string", "", "auth"),
  setting("auth.discord_client_secret", "secret", "", "auth"),
  setting("auth.steam_api_key", "secret", "", "auth"),
  setting("auth.turnstile_site_key", "string", "", "auth"),
  setting("auth.turnstile_secret", "secret", "", "auth"),
  setting("system.maintenance", "boolean", false, "advanced"),
  // Ora (în fusul site-ului) la care pleacă digestul zilnic al notificărilor (etapa 4).
  setting("notifications.digest_hour", "number", 8, "notifications", (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? null : "invalid_range")),
];

function groupPermission(key: string, defaults: GcsPermissionDef["default"], merge?: "max" | "min"): GcsPermissionDef {
  const def: GcsPermissionDef = { key, scope: "group", labelKey: `permissions.${key}`, default: defaults };
  if (merge) def.merge = merge;
  return def;
}

/**
 * Setări de grup implicite. Valorile numerice: `-1` = nelimitat, `0` = interzis.
 * Toate se pot schimba din ACP → Grupuri.
 */
const permissions: GcsPermissionDef[] = [
  groupPermission("core.view_public", Object.fromEntries(DEFAULT_GROUP_KEYS.map((g) => [g, true]))),
  groupPermission("acp.access", { ...ADMINS }),
  groupPermission("mod.access", { ...STAFF }),
  groupPermission("pm.max_conversations", {
    new_member: 10,
    member: 50,
    vip_bronze: 100,
    vip_silver: 150,
    vip_gold: 250,
    vip_legend: -1,
    moderator: 200,
    super_moderator: 200,
    admin: -1,
    root_admin: -1,
  }),
  // Secunde între două mesaje private: mai puțin e mai permisiv, deci câștigă minimul.
  groupPermission(
    "pm.flood_seconds",
    {
      new_member: 60,
      member: 30,
      vip_bronze: 10,
      vip_silver: 10,
      vip_gold: 10,
      vip_legend: 10,
      moderator: 0,
      super_moderator: 0,
      admin: 0,
      root_admin: 0,
    },
    "min",
  ),
  groupPermission("upload.max_mb", {
    new_member: 2,
    member: 10,
    vip_bronze: 20,
    vip_silver: 30,
    vip_gold: 50,
    vip_legend: 100,
    moderator: 50,
    super_moderator: 50,
    admin: -1,
    root_admin: -1,
  }),
  groupPermission("signature.max_chars", {
    member: 300,
    vip_bronze: 500,
    vip_silver: 500,
    vip_gold: 800,
    vip_legend: 1000,
    moderator: 1000,
    super_moderator: 1000,
    admin: -1,
    root_admin: -1,
  }),
  groupPermission("profile.styled_name", { ...VIPS, ...ADMINS }),
  groupPermission("profile.avatar_frame", { ...VIPS, ...ADMINS }),
  groupPermission("profile.animated_cover", { vip_gold: true, vip_legend: true, ...ADMINS }),
  // După câte postări aprobate un Membru nou devine Membru.
  groupPermission("new_member.post_threshold", { new_member: 5 }),
];

type MenuItem = [key: string, href: string];

function menuSection(app: GcsAcpApp, group: string, items: MenuItem[]): GcsAcpMenuSection {
  return {
    app,
    title: `acp.menu.${app}.${group}`,
    items: items.map(([key, href]) => ({
      key: `${app}.${key}`,
      labelKey: `acp.menu.${app}.${key}`,
      href,
      section: `${app}.${key}`,
    })),
  };
}

/** Meniul ACP din spec §12.1, pentru aplicațiile Sistem și Membri. */
const acpMenu: GcsAcpMenuSection[] = [
  menuSection("system", "overview", [
    ["dashboard", "/admin"],
    ["files", "/admin/system/files"],
  ]),
  menuSection("system", "site_features", [
    ["applications", "/admin/system/applications"],
    ["integrations", "/admin/system/integrations"],
    ["menu_manager", "/admin/system/menu"],
    ["api", "/admin/system/api"],
    ["webhooks", "/admin/system/webhooks"],
    ["rss_import", "/admin/system/rss-import"],
  ]),
  menuSection("system", "settings", [
    ["settings_general", "/admin/settings/general"],
    ["settings_terms", "/admin/settings/terms"],
    ["settings_posting", "/admin/settings/posting"],
    ["settings_email", "/admin/settings/email"],
    ["settings_auth", "/admin/settings/auth"],
    ["settings_contact", "/admin/settings/contact"],
    ["settings_2fa", "/admin/settings/2fa"],
    ["settings_advanced", "/admin/settings/advanced"],
    ["settings_pwa", "/admin/settings/pwa"],
  ]),
  menuSection("system", "discovery", [
    ["search", "/admin/system/search"],
    ["streams", "/admin/system/streams"],
    ["rss", "/admin/system/rss"],
    ["tags", "/admin/system/tags"],
  ]),
  menuSection("system", "promotion", [
    ["ads", "/admin/system/ads"],
    ["seo", "/admin/system/seo"],
    ["share", "/admin/system/share"],
  ]),
  menuSection("system", "support", [
    ["status", "/admin/system/status"],
    ["logs", "/admin/logs"],
    ["cache", "/admin/system/cache"],
  ]),
  menuSection("system", "conversions", [["import", "/admin/system/import"]]),

  menuSection("members", "members", [
    ["members", "/admin/members"],
    ["groups", "/admin/groups"],
    ["promotions", "/admin/members/promotions"],
    ["ip_tools", "/admin/members/ip-tools"],
    ["gdpr", "/admin/members/gdpr"],
  ]),
  menuSection("members", "achievements", [
    ["achievement_rules", "/admin/members/achievements/rules"],
    ["ranks", "/admin/members/achievements/ranks"],
    ["badges", "/admin/members/achievements/badges"],
    ["achievement_settings", "/admin/members/achievements/settings"],
  ]),
  menuSection("members", "member_settings", [
    ["profiles", "/admin/members/settings/profiles"],
    ["reputation", "/admin/members/settings/reputation"],
    ["notifications", "/admin/members/settings/notifications"],
    ["bans", "/admin/members/settings/bans"],
    ["referral", "/admin/members/settings/referral"],
  ]),
  menuSection("members", "moderation", [
    ["queue", "/admin/members/moderation/queue"],
    ["reports", "/admin/members/moderation/reports"],
    ["antispam", "/admin/members/moderation/antispam"],
    ["warnings", "/admin/members/moderation/warnings"],
    ["tickets", "/admin/members/moderation/tickets"],
  ]),
  menuSection("members", "staff", [
    ["moderators", "/admin/members/staff/moderators"],
    ["acp_roles", "/admin/staff/roles"],
    ["staff_page", "/admin/members/staff/page"],
  ]),
  menuSection("members", "bulk_mail", [["bulk_mail", "/admin/members/bulk-mail"]]),
];

/** Modulul „core”: setările, permisiunile de grup și meniul ACP de bază. */
export const coreModule: GcsModule = {
  key: "core",
  settings,
  permissions,
  acpMenu,
  notificationTypes: [
    { key: "core.warning", labelKey: "notifications.type.core.warning", important: true, defaultEmail: "INSTANT" },
  ],
  eventListeners: [],
};
