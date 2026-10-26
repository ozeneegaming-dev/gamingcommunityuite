import { FOOTER_SETTING, SOCIAL_NETWORKS, footerConfigError } from "../community/footer";
import { ANNOUNCEMENT_SETTING, announcementConfigError } from "../community/announcement";
import { communityRulesSetting } from "../community/rules";
import { coreWidgets } from "../widgets";
import { BOT_FEATURES_SETTING, BOT_WELCOME_SETTING, BOT_WELCOME_TITLE_SETTING } from "../bot/settings";
import { NOTIFICATION_SETTING_DEFS } from "../notifications/settings";
import { DEFAULT_THEME_TOGGLE, THEME_TOGGLE_SETTING, WARNINGS_ACK_SETTING, themeTogglePairError, APP_SETTING_DEFS, type GcsAcpApp, type GcsAcpArea, type GcsAcpMenuSection, type GcsModule, type GcsPermissionDef, type GcsSettingDef } from "@gcs/core";

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
const range = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const maxLen = (max: number) => (v: unknown) => (typeof v === "string" && v.length <= max ? null : "too_long");
const notEmpty = (v: unknown) => ((v as string).trim() === "" ? "required" : null);
/** `{ [funcție]: boolean }` (comutatoarele botului). */
const botFeaturesError = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "boolean") ? null : "invalid";

const settings: GcsSettingDef[] = [
  setting("site.name", "string", "Comunitatea mea", "general", notEmpty),
  // Descrierea din `<meta name="description">` (motoarele de căutare); goală → un text generic cu numele site-ului.
  setting("site.description", "string", "", "general", (v) => ((v as string).length > 300 ? "too_long" : null)),
  setting("site.url", "string", "", "general", isUrlOrEmpty),
  { ...setting("site.locale", "string", "ro", "general", oneOf([...GCS_LOCALE_KEYS])), options: [...GCS_LOCALE_KEYS] },
  setting("site.timezone", "string", "Europe/Bucharest", "general", notEmpty),
  { ...setting("site.theme", "string", "dark", "general", oneOf(["dark", "light", "auto"])), options: ["dark", "light", "auto"] },
  // Comutatorul lună / soare: perechea de teme (ACP → Aspect → Teme); implicit GCS Dark ↔ GCS White.
  setting(THEME_TOGGLE_SETTING, "json", DEFAULT_THEME_TOGGLE, "themes", themeTogglePairError),
  // Profilurile sociale ale comunității (cercurile colorate din subsol); goale = ascunse.
  ...SOCIAL_NETWORKS.map((n) => setting(n.setting, "string", "", "general", isUrlOrEmpty)),
  // Botul comunității (ACP › Sistem › Botul comunității): comutatoarele pe funcție și mesajul de bun venit.
  setting(BOT_FEATURES_SETTING, "json", {}, "bot", botFeaturesError),
  setting(BOT_WELCOME_TITLE_SETTING, "string", "Bine ai venit pe {site}!", "bot", (v) => (notEmpty(v) ?? ((v as string).length > 150 ? "too_long" : null))),
  setting(
    BOT_WELCOME_SETTING,
    "string",
    "Salut, {name}! Bine ai venit pe {site}.\n\nCitește regulile, prezintă-te comunității și spune-ne la ce jocuri te găsim. Dacă ai nevoie de ajutor, scrie-i oricui din staff.",
    "bot",
    (v) => (notEmpty(v) ?? ((v as string).length > 5000 ? "too_long" : null)),
  ),
  // Subsolul (ACP → Aspect → Subsol); `null` = valorile implicite, construite din aplicațiile instalate.
  setting(FOOTER_SETTING, "json", null, "footer", footerConfigError),
  // Bara de anunț de deasupra conținutului (ACP → Aspect → Conținut → Bară de anunț); `null` = nicio bară.
  setting(ANNOUNCEMENT_SETTING, "json", null, "announcement", announcementConfigError),
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
  // Timpul real fără websocket (ediția Lite, sau rezerva din VPS): intervalul polling-ului și, pentru gazdele care taie
  // conexiunile lungi, doar polling (fără SSE).
  setting("realtime.poll_interval", "number", 5, "advanced", (v) => (Number.isInteger(v) && (v as number) >= 2 && (v as number) <= 60 ? null : "invalid_range")),
  { ...setting("realtime.transport", "string", "auto", "advanced", oneOf(["auto", "poll"])), options: ["auto", "poll"] },
  // Limbile și traducerea automată (etapa 5): limbile oferite membrilor și providerul butonului „Traduce”.
  setting("i18n.locales", "json", [...GCS_LOCALE_KEYS], "languages", (v) =>
    Array.isArray(v) && v.length > 0 && v.every((l) => GCS_LOCALE_KEYS.includes(l as (typeof GCS_LOCALE_KEYS)[number])) ? null : "invalid_choice",
  ),
  { ...setting("i18n.translate_provider", "string", "libretranslate", "languages", oneOf(["libretranslate", "deepl", "off"])), options: ["libretranslate", "deepl", "off"] },
  setting("i18n.libretranslate_url", "string", "http://translate:5000", "languages", isUrlOrEmpty),
  setting("i18n.deepl_key", "secret", "", "languages"),
  // Ora (în fusul site-ului) la care pleacă digestul zilnic al notificărilor (etapa 4).
  setting("notifications.digest_hour", "number", 8, "notifications", (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? null : "invalid_range")),
  // Notificări v2: rezumatul săptămânal „Ce ai ratat” (ziua, ora) și curățenia notificărilor vechi.
  ...NOTIFICATION_SETTING_DEFS,
  // Regulile comunității (pagina `/rules`), editate cu editorul postărilor în ACP → Setări → Reguli comunitate.
  communityRulesSetting,
  // Perioada de răzgândire a cererii „Șterge contul meu” (zile; 0 = la următoarea trecere a jobului), ACP → Cereri GDPR.
  // Anti-spam: membrul confirmă un avertisment nou înainte să poată posta din nou (ACP › Moderare › Avertismente).
  setting(WARNINGS_ACK_SETTING, "boolean", true, "warnings"),
  // Anti-spam (ACP › Moderare › Anti-spam): captcha-ul la înregistrare, întrebarea, membrii noi, phishing-ul și lista publică de spammeri.
  { ...setting("antispam.captcha", "string", "pow", "antispam", oneOf(["none", "pow", "turnstile"])), options: ["none", "pow", "turnstile"] },
  setting("antispam.pow_difficulty", "number", 15, "antispam", range(8, 24)),
  setting("antispam.qa_enabled", "boolean", true, "antispam"),
  setting("antispam.new_member_days", "number", 0, "antispam", range(0, 365)),
  setting("antispam.new_member_posts", "number", 0, "antispam", range(0, 1000)),
  { ...setting("antispam.new_member_links", "string", "moderate", "antispam", oneOf(["allow", "moderate", "block"])), options: ["allow", "moderate", "block"] },
  setting("antispam.new_member_images", "number", 2, "antispam", range(0, 50)),
  setting("antispam.new_member_pms_per_day", "number", 5, "antispam", range(0, 1000)),
  setting("antispam.new_member_approval", "boolean", false, "antispam"),
  setting("antispam.new_member_chat_slow", "number", 10, "antispam", range(0, 600)),
  setting("antispam.phishing_enabled", "boolean", true, "antispam"),
  setting("antispam.phishing_domains", "string", "", "antispam", maxLen(20_000)),
  setting("antispam.phishing_allow", "string", "", "antispam", maxLen(20_000)),
  setting("antispam.sfs_enabled", "boolean", false, "antispam"),
  setting("antispam.sfs_api_key", "secret", "", "antispam"),
  setting("antispam.sfs_confidence", "number", 60, "antispam", range(1, 100)),
  setting("members.ip_retention_days", "number", 0, "gdpr", range(0, 3650)),
  setting("members.deletion_cooling_days", "number", 7, "gdpr", (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 90 ? null : "invalid_range")),
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

/**
 * O secțiune a meniului ACP: titlul și intrările, fiecare cu iconița ei Font Awesome. `area` / `title` mută secțiunea în
 * altă zonă a navigației sau sub alt titlu de grup (specul 2026-10-09-acp-navigatie-aplicatii §1.2); cheile intrărilor
 * și ale secțiunilor (drepturile ACP) rămân ale aplicației `app`.
 */
function menuSection(app: GcsAcpApp, group: string, icon: string, items: MenuItem[], opts: { area?: GcsAcpArea; title?: string } = {}): GcsAcpMenuSection {
  return {
    app,
    title: opts.title ?? `acp.menu.${app}.${group}`,
    icon,
    ...(opts.area ? { area: opts.area } : {}),
    items: items.map(([key, href, itemIcon]) => ({
      key: `${app}.${key}`,
      labelKey: `acp.menu.${app}.${key}`,
      href,
      section: `${app}.${key}`,
      icon: itemIcon,
    })),
  };
}

/**
 * Meniul ACP al nucleului (spec §12.1), pe zonele și grupurile navigației (specul 2026-10-09-acp-navigatie-aplicatii
 * §1.2). Dashboard-ul (`/admin`) are linkul lui în bara de iconițe.
 */
const acpMenu: GcsAcpMenuSection[] = [
  // ─── Sistem ───
  menuSection("system", "overview", "fa-solid fa-gauge", [
    ["dashboard", "/admin", "fa-solid fa-gauge-high"],
    ["files", "/admin/system/files", "fa-solid fa-folder-open"],
    ["status", "/admin/system/status", "fa-solid fa-heart-pulse"],
    ["update", "/admin/system/update", "fa-solid fa-arrows-rotate"],
    ["cron", "/admin/system/cron", "fa-solid fa-clock"],
  ]),
  menuSection("system", "site_features", "fa-solid fa-puzzle-piece", [
    ["applications", "/admin/system/applications", "fa-solid fa-cubes"],
    ["integrations", "/admin/system/integrations", "fa-solid fa-plug"],
    ["api", "/admin/system/api", "fa-solid fa-code"],
    ["webhooks", "/admin/system/webhooks", "fa-solid fa-satellite-dish"],
    ["bot", "/admin/system/bot", "fa-solid fa-robot"],
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
  menuSection("system", "support", "fa-solid fa-screwdriver-wrench", [
    ["logs", "/admin/logs", "fa-solid fa-clipboard-list"],
    ["cache", "/admin/system/cache", "fa-solid fa-bolt"],
  ]),
  menuSection("system", "conversions", "fa-solid fa-right-left", [["import", "/admin/system/import", "fa-solid fa-file-import"]]),

  // ─── Comunitate: moderarea (secțiunile aplicației Membri); Forumurile și Chat-ul vin din modulele lor ───
  menuSection(
    "members",
    "moderation",
    "fa-solid fa-gavel",
    [
      ["queue", "/admin/members/moderation/queue", "fa-solid fa-inbox"],
      ["reports", "/admin/members/moderation/reports", "fa-solid fa-flag"],
      ["antispam", "/admin/members/moderation/antispam", "fa-solid fa-shield-virus"],
      ["warnings", "/admin/members/moderation/warnings", "fa-solid fa-triangle-exclamation"],
      ["tickets", "/admin/members/moderation/tickets", "fa-solid fa-ticket"],
    ],
    { area: "community" },
  ),

  // ─── Membri ───
  menuSection("members", "members", "fa-solid fa-users", [
    ["members", "/admin/members", "fa-solid fa-user"],
    ["groups", "/admin/groups", "fa-solid fa-users"],
    ["promotions", "/admin/members/promotions", "fa-solid fa-arrow-trend-up"],
    ["ip_tools", "/admin/members/ip-tools", "fa-solid fa-network-wired"],
    ["gdpr", "/admin/members/gdpr", "fa-solid fa-scale-balanced"],
  ]),
  menuSection("members", "staff", "fa-solid fa-user-tie", [
    ["moderators", "/admin/members/staff/moderators", "fa-solid fa-user-shield"],
    ["acp_roles", "/admin/staff/roles", "fa-solid fa-user-lock"],
    ["staff_page", "/admin/members/staff/page", "fa-solid fa-address-book"],
  ]),
  menuSection("members", "member_settings", "fa-solid fa-user-gear", [
    ["profiles", "/admin/members/settings/profiles", "fa-solid fa-id-card"],
    ["reputation", "/admin/members/settings/reputation", "fa-solid fa-thumbs-up"],
    ["notifications", "/admin/members/settings/notifications", "fa-solid fa-bell"],
    ["bans", "/admin/members/settings/bans", "fa-solid fa-ban"],
    ["referral", "/admin/members/settings/referral", "fa-solid fa-user-plus"],
  ]),
  menuSection("members", "achievements", "fa-solid fa-trophy", [
    ["achievement_rules", "/admin/members/achievements/rules", "fa-solid fa-list-check"],
    ["ranks", "/admin/members/achievements/ranks", "fa-solid fa-ranking-star"],
    ["badges", "/admin/members/achievements/badges", "fa-solid fa-award"],
    ["achievement_settings", "/admin/members/achievements/settings", "fa-solid fa-sliders"],
  ]),
  menuSection("members", "communication", "fa-solid fa-envelopes-bulk", [["bulk_mail", "/admin/members/bulk-mail", "fa-solid fa-envelopes-bulk"]]),

  // ─── Aspect. Etapa 5: temele și widget-urile se editează direct pe site; aici sunt listele și linkurile spre editoare ───
  menuSection("appearance", "style", "fa-solid fa-palette", [
    ["themes", "/admin/appearance/themes", "fa-solid fa-brush"],
    ["templates", "/admin/appearance/templates", "fa-solid fa-file-code"],
    ["css", "/admin/appearance/css", "fa-brands fa-css3-alt"],
  ]),
  menuSection("appearance", "layout", "fa-solid fa-table-cells-large", [
    ["widgets", "/admin/appearance/widgets", "fa-solid fa-table-cells-large"],
    // Subsolul site-ului: coloana „Despre”, coloanele de linkuri și bara de jos (specul 2026-10-10-tema-nova §5).
    ["footer", "/admin/appearance/footer", "fa-solid fa-shoe-prints"],
  ]),
  // Conținutul de pe tot site-ul, în orice temă: bara de anunț subțire de deasupra conținutului.
  menuSection("appearance", "content", "fa-solid fa-bullhorn", [["announcement_bar", "/admin/appearance/announcement-bar", "fa-solid fa-bullhorn"]]),
  // Managerul meniului principal: secțiunea `system.menu_manager`, afișată lângă widget-uri.
  menuSection("system", "layout", "fa-solid fa-table-cells-large", [["menu_manager", "/admin/system/menu", "fa-solid fa-bars-staggered"]], {
    area: "appearance",
    title: "acp.menu.appearance.layout",
  }),

  // ─── Statistici: prezentarea (pagina reală) și rapoartele care vin („în curând”); aplicațiile își aduc rapoartele ───
  menuSection("stats", "overview_group", "fa-solid fa-chart-pie", [["overview", "/admin/stats", "fa-solid fa-chart-pie"]]),
  menuSection("stats", "activity", "fa-solid fa-chart-line", [
    ["registrations", "/admin/stats/registrations", "fa-solid fa-user-plus"],
    ["members", "/admin/stats/members", "fa-solid fa-users-viewfinder"],
    ["content", "/admin/stats/content", "fa-solid fa-comments"],
    ["online", "/admin/stats/online", "fa-solid fa-signal"],
  ]),

  // ─── Aplicații: scurtătura spre lista aplicațiilor și uneltele pentru pluginuri; pluginurile își adaugă grupurile ───
  {
    app: "system",
    area: "apps",
    title: "acp.menu.system.apps_manage",
    icon: "fa-solid fa-cubes",
    items: [
      {
        key: "system.applications_shortcut",
        labelKey: "acp.menu.system.applications",
        href: "/admin/system/applications",
        section: "system.applications",
        icon: "fa-solid fa-cubes",
        alias: true,
      },
    ],
  },
  menuSection(
    "system",
    "apps_dev",
    "fa-solid fa-code",
    [
      ["hooks", "/admin/system/hooks", "fa-solid fa-code-branch"],
      ["porting", "/admin/system/porting", "fa-solid fa-code-compare"],
    ],
    { area: "apps" },
  ),
];

/** Modulul „core”: setările, permisiunile de grup și meniul ACP de bază. */
export const coreModule: GcsModule = {
  key: "core",
  // Setările aplicațiilor (pornirea și ordinea), schimbate din ACP → Sistem → Aplicații.
  settings: [...settings, ...APP_SETTING_DEFS],
  permissions,
  acpMenu,
  // „Nucleu” în ACP → Aplicații: blocat (nu se oprește); pornirea lui e pagina Activitate.
  app: {
    optional: false,
    locked: true,
    labelKey: "apps.core",
    icon: "fa-solid fa-cube",
    descriptionKey: "apps.descriptions.core",
    landing: { href: "/activity" },
    sections: [
      { key: "activity", labelKey: "site.nav.activity", icon: "fa-solid fa-bolt", href: "/activity" },
      { key: "members", labelKey: "site.nav.membersAll", icon: "fa-solid fa-user-group", href: "/members", permission: "core.members_list" },
      { key: "staff", labelKey: "site.nav.staff", icon: "fa-solid fa-shield-halved", href: "/staff" },
      { key: "leaderboard", labelKey: "site.nav.leaderboard", icon: "fa-solid fa-ranking-star", href: "/leaderboard" },
      { key: "messages", labelKey: "apps.sections.messages", icon: "fa-solid fa-envelope", href: "/messages", permission: "pm.send" },
      { key: "rules", labelKey: "site.nav.rules", icon: "fa-solid fa-scale-balanced", href: "/rules" },
    ],
  },
  notificationTypes: [
    { key: "core.warning", labelKey: "notifications.type.core.warning", important: true, defaultEmail: "INSTANT" },
    // Anti-spam: decizia echipei pe contestația unui avertisment.
    { key: "core.warning_appeal", labelKey: "notifications.type.core.warning_appeal", important: true, defaultEmail: "INSTANT", category: "moderation" },
  // Unelte IP: un cont nou cu IP-ul altor conturi (staff-ul cu acces la Unelte IP).
  { key: "core.multi_account", labelKey: "notifications.type.core.multi_account", important: false, defaultEmail: "OFF", category: "moderation" },
    // Mențiuni v2: un membru a menționat un grup din care faci parte (postare sau mesaj privat).
    { key: "core.group_mention", labelKey: "notifications.type.core.group_mention", important: false, defaultEmail: "DIGEST" },
    // Membri v2: un grup secundar temporar a expirat (jobul `groups.secondary_expiry`).
    { key: "core.group_expired", labelKey: "notifications.type.core.group_expired", important: false, defaultEmail: "INSTANT" },
    // Notificări v2: rezumatul săptămânal „Ce ai ratat” (opt-in implicit pornit: emailul săptămânal și rândul din clopoțel).
    {
      key: "core.weekly_digest",
      labelKey: "notifications.type.core.weekly_digest",
      important: false,
      category: "system",
      channels: { site: "on", toast: "off", email: "on", push: "off", emailMode: "weekly" },
    },
  ],
  eventListeners: [],
  widgets: coreWidgets,
};
