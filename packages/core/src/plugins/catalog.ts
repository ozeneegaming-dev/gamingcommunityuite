/**
 * Ce pot folosi pluginurile: capabilitățile, evenimentele publice, filtrele și punctele de extensie. Lista e și sursa
 * paginii ACP → Sistem → Hook-uri (descrierile sunt în `acp.plugins.*` din mesajele web).
 */

/** Versiunea platformei pentru `minGcs` (se actualizează la fiecare etapă care schimbă API-ul pluginurilor). */
export const GCS_PLATFORM_VERSION = "0.6.0";

export const PLUGIN_CAPABILITIES = [
  "db",
  "events",
  "filters",
  "widgets",
  "pages",
  "api",
  "acp",
  "menus",
  "jobs",
  "settings",
  "permissions",
  "hooks",
  "http-out",
  "client-css",
  "client-js",
  "templates",
] as const;
export type GcsPluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

/** Nivelul de risc afișat pe ecranul de confirmare. */
export const CAPABILITY_RISK: Record<GcsPluginCapability, "low" | "medium" | "high"> = {
  db: "medium",
  events: "low",
  filters: "medium",
  widgets: "low",
  pages: "low",
  api: "medium",
  acp: "low",
  menus: "low",
  jobs: "low",
  settings: "low",
  permissions: "low",
  hooks: "low",
  "http-out": "high",
  "client-css": "low",
  "client-js": "high",
  templates: "low",
};

/** Iconița Font Awesome a fiecărei capabilități (ecranul de confirmare, pagina pluginului). */
export const CAPABILITY_ICONS: Record<GcsPluginCapability, string> = {
  db: "fa-solid fa-database",
  events: "fa-solid fa-bolt",
  filters: "fa-solid fa-filter",
  widgets: "fa-solid fa-table-cells-large",
  pages: "fa-solid fa-file-lines",
  api: "fa-solid fa-code",
  acp: "fa-solid fa-screwdriver-wrench",
  menus: "fa-solid fa-bars",
  jobs: "fa-solid fa-clock-rotate-left",
  settings: "fa-solid fa-sliders",
  permissions: "fa-solid fa-user-shield",
  hooks: "fa-solid fa-puzzle-piece",
  "http-out": "fa-solid fa-globe",
  "client-css": "fa-solid fa-palette",
  "client-js": "fa-brands fa-js",
  templates: "fa-solid fa-file-code",
};

/**
 * Evenimentele bus-ului livrate pluginurilor (doar câmpurile simple din payload). Mesajele private și evenimentele
 * interne (cache, setări, permisiuni) nu se expun.
 */
export const PLUGIN_EVENTS = [
  "post.created",
  "post.updated",
  "post.deleted",
  "post.approved",
  "topic.created",
  "topic.updated",
  "topic.deleted",
  "topic.moved",
  "topic.moderated",
  "user.registered",
  "user.promoted",
  "user.banned",
  "user.unbanned",
  "user.warned",
  "user.followed",
  "chat.message",
  "chat.deleted",
  "report.created",
  "badge.awarded",
  "vip.granted",
  "vip.expired",
] as const;
export type GcsPluginEventName = (typeof PLUGIN_EVENTS)[number];

/** Filtrele (date modificabile înainte de salvare). */
export const PLUGIN_FILTER_POINTS = ["post.before_save"] as const;
export type GcsPluginFilterPoint = (typeof PLUGIN_FILTER_POINTS)[number];

/** Punctele de extensie din interfață (HTML inserat; aceleași nume le vor folosi și șabloanele). */
export const PLUGIN_HOOK_POINTS = ["postbit.after_fields"] as const;
export type GcsPluginHookPoint = (typeof PLUGIN_HOOK_POINTS)[number];

/** Timpul maxim al fiecărui tip de apel (ms). */
export const PLUGIN_TIMEOUTS = {
  init: 5_000,
  event: 5_000,
  filter: 2_000,
  widget: 3_000,
  hook: 3_000,
  page: 5_000,
  acp: 5_000,
  api: 10_000,
  job: 60_000,
} as const;
export type GcsPluginCallKind = keyof typeof PLUGIN_TIMEOUTS;

/** Câte eșecuri la rând dezactivează automat un plugin (`GCS_PLUGINS_MAX_FAILURES`). */
export const PLUGIN_MAX_FAILURES_DEFAULT = 5;

/** Prioritatea implicită a unui hook (mai mic = mai devreme). */
export const PLUGIN_DEFAULT_PRIORITY = 10;

/** Cheia unui plugin: `vendor.nume`, fiecare parte fără `__` (schema `plugin_<vendor>__<nume>` e unică). */
export const PLUGIN_KEY_PART = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export const PLUGIN_KEY_RE = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.([a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/;

export function isPluginKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = PLUGIN_KEY_RE.exec(value);
  return Boolean(m && m[1]!.length <= 24 && m[2]!.length <= 24);
}

/** Schema PostgreSQL a pluginului: `plugin_<vendor>__<nume>`. */
export function pluginSchema(key: string): string {
  return `plugin_${key.replace(".", "__")}`;
}

/** Clasa CSS a containerului pluginului (CSS-ul lui e închis în ea): `gcsp--<vendor>--<nume>` (părțile nu conțin `-`). */
export function pluginCssScope(key: string): string {
  return `gcsp--${key.replace(".", "--")}`;
}

/** Prefixul cheilor înregistrate în registry (permisiuni, widget-uri, modulul): `plugin.<vendor>.<nume>`. */
export function pluginRegistryKey(key: string): string {
  return `plugin.${key}`;
}

/** Secțiunea ACP a paginilor pluginului (drepturile rolurilor ACP). */
export function pluginAcpSection(key: string): string {
  return `plugin.${key}`;
}
