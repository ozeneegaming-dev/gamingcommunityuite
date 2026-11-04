import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsStatTile, GcsStatsContext } from "@gcs/core";
import { PAGES_SETTINGS } from "./options";
import { PAGES_ACP, PAGES_SOURCE } from "./shared";
import { pagesWidgets } from "./widgets";

export * from "./access";
export * from "./admin";
export * from "./fields";
export * from "./html";
export * from "./layout";
export * from "./memberData";
export * from "./notify";
export * from "./options";
export * from "./presets";
export * from "./queries";
export * from "./records";
export { PAGES_ACP, PAGES_CACHE_TAG, PAGES_COMMENT_TYPE, PAGES_MEDIA_TYPE, PAGES_NOTICE_TYPE, PAGES_RECORD_TYPE, PAGES_SOURCE, categoryHref, pageHref, recordHref } from "./shared";
export { pagesWidgets } from "./widgets";

const STAFF = { root_admin: true, admin: true, super_moderator: true, moderator: true } as const;
const GLOBAL_MODS = { root_admin: true, admin: true, super_moderator: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat). */
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;
const EVERYONE = { ...MEMBERS, guest: true } as const;

const permissions: GcsPermissionDef[] = [
  { key: "pages.view", scope: "group", labelKey: "permissions.pages.view", default: { ...EVERYONE } },
  // Trimiterile (doar în bazele cu trimiterile pornite); bazele își pot restrânge grupurile.
  { key: "pages.submit", scope: "group", labelKey: "permissions.pages.submit", default: { ...MEMBERS, new_member: false } },
  { key: "pages.comment", scope: "group", labelKey: "permissions.pages.comment", default: { ...MEMBERS } },
  { key: "pages.rate", scope: "group", labelKey: "permissions.pages.rate", default: { ...MEMBERS } },
  { key: "pages.skip_approval", scope: "group", labelKey: "permissions.pages.skip_approval", default: { ...STAFF } },
  // Staff-ul pe site: aprobă, editează, ascunde, recomandă, fixează și șterge înregistrări și comentarii.
  { key: "pages.moderate", scope: "group", labelKey: "permissions.pages.moderate", default: { ...GLOBAL_MODS } },
];

/** Zona ACP „Pagini”: conținutul (pagini, blocuri, baze de date, înregistrări, media) și aspectul + setările. */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "pages",
    title: "acp.menu.pages.content",
    icon: "fa-solid fa-file-lines",
    items: [
      { key: PAGES_ACP.pages, labelKey: "acp.menu.pages.pages", href: "/admin/pages", section: PAGES_ACP.pages, icon: "fa-solid fa-sitemap", app: "pages" },
      { key: "pages.blocks", labelKey: "acp.menu.pages.blocks", href: "/admin/pages/blocks", section: PAGES_ACP.pages, icon: "fa-solid fa-cubes", app: "pages" },
      { key: PAGES_ACP.databases, labelKey: "acp.menu.pages.databases", href: "/admin/pages/databases", section: PAGES_ACP.databases, icon: "fa-solid fa-database", app: "pages" },
      { key: PAGES_ACP.records, labelKey: "acp.menu.pages.records", href: "/admin/pages/records", section: PAGES_ACP.records, icon: "fa-solid fa-list-check", app: "pages" },
      { key: PAGES_ACP.media, labelKey: "acp.menu.pages.media", href: "/admin/pages/media", section: PAGES_ACP.media, icon: "fa-solid fa-photo-film", app: "pages" },
    ],
  },
  {
    app: "pages",
    title: "acp.menu.pages.setup",
    icon: "fa-solid fa-sliders",
    items: [
      { key: PAGES_ACP.templates, labelKey: "acp.menu.pages.templates", href: "/admin/pages/templates", section: PAGES_ACP.templates, icon: "fa-solid fa-code", app: "pages" },
      { key: PAGES_ACP.settings, labelKey: "acp.menu.pages.settings", href: "/admin/pages/settings", section: PAGES_ACP.settings, icon: "fa-solid fa-gear", app: "pages" },
    ],
  },
];

/** Placa „Pagini” din panoul de statistici: înregistrările publicate (lipsește fără nicio bază de date). */
async function pagesStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const bases = await db.pagesDatabase.count();
  if (bases === 0) return [];
  const records = await db.pagesRecord.count({ where: { status: "PUBLISHED" } });
  return [{ key: "pages.records", labelKey: "stats.tiles.pages_records", value: records, icon: "fa-solid fa-database", href: "/pages", color: "#4FB3FF" }];
}

/**
 * Aplicația Pagini (specul 2026-11-03-pagini): arborele de pagini și foldere, constructorul și paginile HTML, blocurile
 * reutilizabile, biblioteca media și bazele de date (câmpuri, categorii, înregistrări, comentarii, note, trimiteri cu
 * aprobare, revizii), în căutare și în fluxul de activitate.
 */
export const pagesModule: GcsModule = {
  key: "pages",
  app: {
    optional: true,
    labelKey: "apps.pages",
    icon: "fa-solid fa-file-lines",
    descriptionKey: "apps.descriptions.pages",
    routes: ["/pages"],
    landing: { href: "/pages" },
    settingsHref: "/admin/pages/settings",
    sections: [{ key: "pages", labelKey: "site.nav.pages", icon: "fa-solid fa-file-lines", href: "/pages", permission: "pages.view" }],
  },
  permissions,
  settings: PAGES_SETTINGS,
  acpMenu,
  eventListeners: [],
  notificationTypes: [
    { key: "pages.submission", labelKey: "notifications.type.pages.submission", important: false, defaultEmail: "DIGEST", category: "moderation", countEach: true },
    { key: "pages.review", labelKey: "notifications.type.pages.review", important: false, defaultEmail: "INSTANT", category: "content" },
    { key: "pages.comment", labelKey: "notifications.type.pages.comment", important: false, defaultEmail: "DIGEST", category: "content", countEach: true },
    { key: "pages.followed", labelKey: "notifications.type.pages.followed", important: false, defaultEmail: "DIGEST", category: "content", countEach: true },
  ],
  widgets: pagesWidgets,
  stats: pagesStatTiles,
  contentSources: [{ key: PAGES_SOURCE, labelKey: "search.sources.pages_records", icon: "fa-solid fa-database", search: true, stream: true }],
};
