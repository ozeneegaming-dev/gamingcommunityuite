import type { GcsModuleRegistry, GcsNotificationCategoryDef, GcsNotificationTypeDef } from "../modules/registry";

/**
 * Categoriile notificărilor (Notificări v2). Cele standard sunt aici; o aplicație sau un plugin își poate aduce
 * categoriile ei (`GcsModule.notificationCategories`). O categorie apare (în setări, pe pagina notificărilor, în ACP)
 * doar cât are măcar un tip al unei aplicații active: dispare odată cu aplicația.
 *
 * `tab`: are tabul ei pe pagina `/notifications` (Mesaje, Moderare și categoriile aplicațiilor); restul sunt doar în „Toate”.
 */
export const GCS_NOTIFICATION_CATEGORIES: readonly GcsNotificationCategoryDef[] = [
  { key: "content", labelKey: "notifications.category.content", icon: "fa-solid fa-file-lines", position: 10 },
  { key: "social", labelKey: "notifications.category.social", icon: "fa-solid fa-user-group", position: 20 },
  { key: "messages", labelKey: "notifications.category.messages", icon: "fa-solid fa-envelope", position: 30, tab: true },
  { key: "moderation", labelKey: "notifications.category.moderation", icon: "fa-solid fa-gavel", position: 40, tab: true },
  { key: "chat", labelKey: "notifications.category.chat", icon: "fa-solid fa-comments", position: 50, tab: true },
  { key: "servers", labelKey: "notifications.category.servers", icon: "fa-solid fa-server", position: 60, tab: true },
  { key: "clans", labelKey: "notifications.category.clans", icon: "fa-solid fa-people-group", position: 70, tab: true },
  { key: "vip", labelKey: "notifications.category.vip", icon: "fa-solid fa-crown", position: 80, tab: true },
  { key: "achievements", labelKey: "notifications.category.achievements", icon: "fa-solid fa-trophy", position: 90, tab: true },
  { key: "system", labelKey: "notifications.category.system", icon: "fa-solid fa-gear", position: 100 },
];

/** Categoria în care cade un tip fără `category` (și fără o potrivire mai jos). */
export const FALLBACK_NOTIFICATION_CATEGORY = "system";

/**
 * Tipurile existente înainte de Notificări v2, fără `category` în declarație: categoria lor. Tipurile noi își declară
 * singure categoria (`GcsNotificationTypeDef.category`).
 */
const TYPE_CATEGORIES: Record<string, string> = {
  "forums.reaction": "social",
  "profile.follower": "social",
  "profile.wall": "social",
  "profile.badge": "achievements",
  "core.warning": "moderation",
  "core.group_mention": "social",
  "core.group_expired": "system",
  "chat.sanction": "moderation",
};

/**
 * Categoria implicită după prefixul cheii tipului (ex. `achievements.rank_up` → Realizări, chiar dacă tipul e declarat
 * de modulul profilului), apoi după cheia modulului care îl declară.
 */
const MODULE_CATEGORIES: Record<string, string> = {
  forums: "content",
  profile: "social",
  messages: "messages",
  pm: "messages",
  vip: "vip",
  donations: "vip",
  chat: "chat",
  chat_pro: "chat",
  clans: "clans",
  servers: "servers",
  achievements: "achievements",
  core: "system",
};

/** Tipurile „mențiune” existente (tabul Mențiuni); tipurile noi declară `mention: true`. */
const MENTION_TYPES = new Set(["forums.mention", "forums.quote", "core.group_mention", "chat.mention", "chat_pro.reply"]);

/** Un tip de notificare din catalog: declarația lui, modulul și categoria rezolvată. */
export type GcsNotificationCatalogType = {
  key: string;
  labelKey: string;
  module: string;
  category: string;
  important: boolean;
  mention: boolean;
  def: GcsNotificationTypeDef;
};

/** O categorie din catalog, cu tipurile ei active (în ordinea modulelor). */
export type GcsNotificationCatalogCategory = GcsNotificationCategoryDef & { types: GcsNotificationCatalogType[] };

/** Categoria rezolvată a unui tip. */
export function notificationCategoryOf(moduleKey: string, def: Pick<GcsNotificationTypeDef, "key" | "category">): string {
  return def.category ?? TYPE_CATEGORIES[def.key] ?? MODULE_CATEGORIES[def.key.split(".")[0] ?? ""] ?? MODULE_CATEGORIES[moduleKey] ?? FALLBACK_NOTIFICATION_CATEGORY;
}

/** Tipul e o mențiune (apare în tabul Mențiuni). */
export const isMentionType = (def: Pick<GcsNotificationTypeDef, "key" | "mention">): boolean => def.mention ?? MENTION_TYPES.has(def.key);

/**
 * Catalogul notificărilor: categoriile cu tipurile modulelor active (`active(moduleKey)`), în ordinea pozițiilor.
 * Categoriile fără niciun tip activ lipsesc. O categorie necunoscută (declarată de un tip, dar de niciun modul) cade în
 * „Sistem”.
 */
export function notificationCatalog(registry: GcsModuleRegistry, active: (moduleKey: string) => boolean = () => true): GcsNotificationCatalogCategory[] {
  const defs = new Map<string, GcsNotificationCategoryDef>();
  for (const c of GCS_NOTIFICATION_CATEGORIES) defs.set(c.key, c);
  for (const c of registry.notificationCategories()) if (!defs.has(c.key)) defs.set(c.key, c);
  const out = new Map<string, GcsNotificationCatalogCategory>();
  for (const { module, def } of registry.notificationTypeEntries()) {
    if (!active(module)) continue;
    let category = notificationCategoryOf(module, def);
    if (!defs.has(category)) category = FALLBACK_NOTIFICATION_CATEGORY;
    const cat = out.get(category) ?? { ...defs.get(category)!, types: [] };
    cat.types.push({ key: def.key, labelKey: def.labelKey, module, category, important: def.important, mention: isMentionType(def), def });
    out.set(category, cat);
  }
  return [...out.values()].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

/** Un tab al paginii `/notifications`: „Toate”, „Mențiuni” sau o categorie cu tab. `types` = tipurile filtrate. */
export type GcsNotificationTab = { key: string; labelKey: string; icon: string; types: string[] | null };

/** Taburile paginii: Toate, Mențiuni (dacă există tipuri), apoi categoriile cu tab care au tipuri active. */
export function notificationTabs(catalog: GcsNotificationCatalogCategory[]): GcsNotificationTab[] {
  const mentions = catalog.flatMap((c) => c.types.filter((t) => t.mention).map((t) => t.key));
  return [
    { key: "all", labelKey: "notifications.tabs.all", icon: "fa-solid fa-bell", types: null },
    ...(mentions.length > 0 ? [{ key: "mentions", labelKey: "notifications.tabs.mentions", icon: "fa-solid fa-at", types: mentions }] : []),
    ...catalog.filter((c) => c.tab).map((c) => ({ key: c.key, labelKey: c.labelKey, icon: c.icon, types: c.types.map((t) => t.key) })),
  ];
}
