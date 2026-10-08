import { communityRulesSetting } from "../community/rules";
import { coreWidgets } from "../widgets";
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

/** Limbile interfeței (specul etapei 5): pachetele `de`, `es`, `fr`, `ru` sunt generate automat. */
export const GCS_LOCALE_KEYS = ["ro", "en", "de", "es", "fr", "ru"] as const;

const isPort = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536 ? null : "invalid_port");
const isUrlOrEmpty = (v: unknown) => (v === "" || URL.canParse(v as string) ? null : "invalid_url");
const isEmailOrEmpty = (v: unknown) => (v === "" || /^[^\s@]+@[^\s@]+$/.test(v as string) ? null : "invalid_email");
const oneOf = (values: string[]) => (v: unknown) => (values.includes(v as string) ? null : "invalid_choice");
const notEmpty = (v: unknown) => ((v as string).trim() === "" ? "required" : null);

const settings: GcsSettingDef[] = [
  setting("site.name", "string", "Comunitatea mea", "general", notEmpty),
  // Descrierea din `<meta name="description">` (motoarele de căutare); goală → un text generic cu numele site-ului.
  setting("site.description", "string", "", "general", (v) => ((v as string).length > 300 ? "too_long" : null)),
  setting("site.url", "string", "", "general", isUrlOrEmpty),
  { ...setting("site.locale", "string", "ro", "general", oneOf([...GCS_LOCALE_KEYS])), options: [...GCS_LOCALE_KEYS] },
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
  setting("auth.google_client_id", "string", "", "auth"),
  setting("auth.google_client_secret", "secret", "", "auth"),
  setting("auth.steam_api_key", "secret", "", "auth"),
  setting("auth.turnstile_site_key", "string", "", "auth"),
  setting("auth.turnstile_secret", "secret", "", "auth"),
  setting("system.maintenance", "boolean", false, "advanced"),
  // Limbile și traducerea automată (etapa 5): limbile oferite membrilor și providerul butonului „Traduce”.
  setting("i18n.locales", "json", [...GCS_LOCALE_KEYS], "languages", (v) =>
    Array.isArray(v) && v.length > 0 && v.every((l) => GCS_LOCALE_KEYS.includes(l as (typeof GCS_LOCALE_KEYS)[number])) ? null : "invalid_choice",
  ),
  { ...setting("i18n.translate_provider", "string", "libretranslate", "languages", oneOf(["libretranslate", "deepl", "off"])), options: ["libretranslate", "deepl", "off"] },
  setting("i18n.libretranslate_url", "string", "http://translate:5000", "languages", isUrlOrEmpty),
  setting("i18n.deepl_key", "secret", "", "languages"),
  // Ora (în fusul site-ului) la care pleacă digestul zilnic al notificărilor (etapa 4).
  setting("notifications.digest_hour", "number", 8, "notifications", (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? null : "invalid_range")),
  // Regulile comunității (pagina `/rules`), editate cu editorul postărilor în ACP → Setări → Reguli comunitate.
  communityRulesSetting,
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
  // Etapa 5: butonul „Traduce” la conținut (membrii) și listele de membri / staff (toți, inclusiv vizitatorii).
  groupPermission("core.translate", { ...STAFF, ...VIPS, member: true, new_member: true }),
  groupPermission("core.members_list", Object.fromEntries(DEFAULT_GROUP_KEYS.filter((g) => g !== "banned").map((g) => [g, true]))),
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

type MenuItem = [key: string, href: string, icon: string];

/** O secțiune a meniului ACP: titlul și intrările, fiecare cu iconița ei Font Awesome. */
function menuSection(app: GcsAcpApp, group: string, icon: string, items: MenuItem[]): GcsAcpMenuSection {
  return {
    app,
    title: `acp.menu.${app}.${group}`,
    icon,
    items: items.map(([key, href, itemIcon]) => ({
      key: `${app}.${key}`,
      labelKey: `acp.menu.${app}.${key}`,
      href,
      section: `${app}.${key}`,
      icon: itemIcon,
    })),
  };
}

/** Meniul ACP din spec §12.1, pentru aplicațiile Sistem și Membri. */
const acpMenu: GcsAcpMenuSection[] = [
  menuSection("system", "overview", "fa-solid fa-gauge", [
    ["dashboard", "/admin", "fa-solid fa-gauge-high"],
    ["files", "/admin/system/files", "fa-solid fa-folder-open"],
  ]),
  menuSection("system", "site_features", "fa-solid fa-puzzle-piece", [
    ["applications", "/admin/system/applications", "fa-solid fa-cubes"],
    ["hooks", "/admin/system/hooks", "fa-solid fa-code-branch"],
    ["integrations", "/admin/system/integrations", "fa-solid fa-plug"],
    ["menu_manager", "/admin/system/menu", "fa-solid fa-bars-staggered"],
    ["api", "/admin/system/api", "fa-solid fa-code"],
    ["webhooks", "/admin/system/webhooks", "fa-solid fa-satellite-dish"],
    ["rss_import", "/admin/system/rss-import", "fa-solid fa-square-rss"],
  ]),
  menuSection("system", "settings", "fa-solid fa-sliders", [
    ["settings_general", "/admin/settings/general", "fa-solid fa-gear"],
    ["settings_terms", "/admin/settings/terms", "fa-solid fa-file-contract"],
    ["settings_rules", "/admin/settings/rules", "fa-solid fa-scale-balanced"],
    ["settings_posting", "/admin/settings/posting", "fa-solid fa-pen-to-square"],
    ["settings_email", "/admin/settings/email", "fa-solid fa-envelope"],
    ["settings_languages", "/admin/settings/languages", "fa-solid fa-language"],
    ["settings_auth", "/admin/settings/auth", "fa-solid fa-right-to-bracket"],
    ["settings_contact", "/admin/settings/contact", "fa-solid fa-address-card"],
    ["settings_2fa", "/admin/settings/2fa", "fa-solid fa-shield-halved"],
    ["settings_advanced", "/admin/settings/advanced", "fa-solid fa-screwdriver-wrench"],
    ["settings_pwa", "/admin/settings/pwa", "fa-solid fa-mobile-screen"],
  ]),
  menuSection("system", "discovery", "fa-solid fa-compass", [
    ["search", "/admin/system/search", "fa-solid fa-magnifying-glass"],
    ["streams", "/admin/system/streams", "fa-solid fa-list-ul"],
    ["rss", "/admin/system/rss", "fa-solid fa-rss"],
    ["tags", "/admin/system/tags", "fa-solid fa-tags"],
  ]),
  menuSection("system", "promotion", "fa-solid fa-bullhorn", [
    ["ads", "/admin/system/ads", "fa-solid fa-rectangle-ad"],
    ["seo", "/admin/system/seo", "fa-solid fa-magnifying-glass-chart"],
    ["share", "/admin/system/share", "fa-solid fa-share-nodes"],
  ]),
  menuSection("system", "support", "fa-solid fa-life-ring", [
    ["status", "/admin/system/status", "fa-solid fa-heart-pulse"],
    ["logs", "/admin/logs", "fa-solid fa-clipboard-list"],
    ["cache", "/admin/system/cache", "fa-solid fa-bolt"],
  ]),
  menuSection("system", "conversions", "fa-solid fa-right-left", [
    ["import", "/admin/system/import", "fa-solid fa-file-import"],
    ["porting", "/admin/system/porting", "fa-solid fa-code-compare"],
  ]),

  menuSection("members", "members", "fa-solid fa-users", [
    ["members", "/admin/members", "fa-solid fa-user"],
    ["groups", "/admin/groups", "fa-solid fa-users"],
    ["promotions", "/admin/members/promotions", "fa-solid fa-arrow-trend-up"],
    ["ip_tools", "/admin/members/ip-tools", "fa-solid fa-network-wired"],
    ["gdpr", "/admin/members/gdpr", "fa-solid fa-scale-balanced"],
  ]),
  menuSection("members", "achievements", "fa-solid fa-trophy", [
    ["achievement_rules", "/admin/members/achievements/rules", "fa-solid fa-list-check"],
    ["ranks", "/admin/members/achievements/ranks", "fa-solid fa-ranking-star"],
    ["badges", "/admin/members/achievements/badges", "fa-solid fa-award"],
    ["achievement_settings", "/admin/members/achievements/settings", "fa-solid fa-sliders"],
  ]),
  menuSection("members", "member_settings", "fa-solid fa-user-gear", [
    ["profiles", "/admin/members/settings/profiles", "fa-solid fa-id-card"],
    ["reputation", "/admin/members/settings/reputation", "fa-solid fa-thumbs-up"],
    ["notifications", "/admin/members/settings/notifications", "fa-solid fa-bell"],
    ["bans", "/admin/members/settings/bans", "fa-solid fa-ban"],
    ["referral", "/admin/members/settings/referral", "fa-solid fa-user-plus"],
  ]),
  menuSection("members", "moderation", "fa-solid fa-gavel", [
    ["queue", "/admin/members/moderation/queue", "fa-solid fa-inbox"],
    ["reports", "/admin/members/moderation/reports", "fa-solid fa-flag"],
    ["antispam", "/admin/members/moderation/antispam", "fa-solid fa-shield-virus"],
    ["warnings", "/admin/members/moderation/warnings", "fa-solid fa-triangle-exclamation"],
    ["tickets", "/admin/members/moderation/tickets", "fa-solid fa-ticket"],
  ]),
  menuSection("members", "staff", "fa-solid fa-user-tie", [
    ["moderators", "/admin/members/staff/moderators", "fa-solid fa-user-shield"],
    ["acp_roles", "/admin/staff/roles", "fa-solid fa-user-lock"],
    ["staff_page", "/admin/members/staff/page", "fa-solid fa-address-book"],
  ]),
  menuSection("members", "bulk_mail", "fa-solid fa-envelopes-bulk", [["bulk_mail", "/admin/members/bulk-mail", "fa-solid fa-envelopes-bulk"]]),

  // Etapa 5: temele și widget-urile se editează direct pe site; aici sunt listele și linkurile spre editoare.
  menuSection("appearance", "appearance", "fa-solid fa-palette", [
    ["themes", "/admin/appearance/themes", "fa-solid fa-brush"],
    ["templates", "/admin/appearance/templates", "fa-solid fa-file-code"],
    ["css", "/admin/appearance/css", "fa-brands fa-css3-alt"],
    ["widgets", "/admin/appearance/widgets", "fa-solid fa-table-cells-large"],
  ]),
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
  widgets: coreWidgets,
};
