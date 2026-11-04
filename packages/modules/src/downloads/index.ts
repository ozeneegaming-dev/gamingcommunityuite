import type { GcsAcpMenuSection, GcsModule, GcsPermissionDef, GcsStatTile, GcsStatsContext, GcsWidgetDef } from "@gcs/core";
import { widget } from "../widgets";
import { downloadMemberGrants } from "./access";
import { DOWNLOAD_SETTINGS } from "./options";
import { DOWNLOADS_ACP, DOWNLOADS_CONTAINER } from "./text";

const STAFF = { root_admin: true, admin: true, super_moderator: true, moderator: true } as const;
const GLOBAL_MODS = { root_admin: true, admin: true, super_moderator: true } as const;
const ADMINS = { root_admin: true, admin: true } as const;
const VIPS = { vip_bronze: true, vip_silver: true, vip_gold: true, vip_legend: true } as const;
/** Toate grupurile cu cont (fără Vizitator și Banat). */
const MEMBERS = { ...STAFF, ...VIPS, member: true, new_member: true } as const;
const EVERYONE = { ...MEMBERS, guest: true } as const;

const onCategory = (key: string, defaults: Record<string, boolean>): GcsPermissionDef => ({ key, scope: "container", containerType: DOWNLOADS_CONTAINER, labelKey: `permissions.${key}`, default: defaults });
const group = (key: string, defaults: Record<string, unknown>, extra: Partial<GcsPermissionDef> = {}): GcsPermissionDef => ({ key, scope: "group", labelKey: `permissions.${key}`, default: defaults, ...extra });

/**
 * Permisiunile: matricea pe categorie (vede categoria, vede fișierele, încarcă, descarcă, comentează, scrie recenzii) și
 * setările de grup ale aplicației (tabul „Descărcări” din editarea grupului). Deciziile proprietarului (2026-10-09):
 * orice membru trimite fișiere (apar după aprobare), doar membrii logați descarcă, vizitatorii văd fișierele.
 */
const permissions: GcsPermissionDef[] = [
  onCategory("downloads.see", { ...EVERYONE }),
  onCategory("downloads.view", { ...EVERYONE }),
  onCategory("downloads.upload", { ...MEMBERS }),
  onCategory("downloads.download", { ...MEMBERS }),
  onCategory("downloads.comment", { ...MEMBERS }),
  onCategory("downloads.review", { ...MEMBERS }),
  // Mărimea maximă a unui fișier (MB; -1 = fără limită de grup): se aplică cea mai mică dintre grup și categorie.
  group("downloads.max_mb", {}, { fallback: -1 }),
  // Spațiul unui membru pentru fișierele lui (MB; -1 = nelimitat).
  group("downloads.quota_mb", { new_member: 500, member: 2048, vip_bronze: 5120, vip_silver: 10240, vip_gold: 20480, vip_legend: 51200, moderator: -1, super_moderator: -1, admin: -1, root_admin: -1 }, { fallback: 1024 }),
  group("downloads.vip_files", { ...VIPS, ...STAFF }),
  group("downloads.bulk", { ...VIPS, ...STAFF }),
  group("downloads.links", { ...VIPS, ...STAFF }),
  // Importul de pe server: doar staff-ul de încredere (citește fișiere din folderul de import al serverului).
  group("downloads.import_path", { ...ADMINS }),
  group("downloads.skip_approval", { ...GLOBAL_MODS }),
  group("downloads.view_logs", { ...GLOBAL_MODS }),
  // Staff-ul pe site: aprobă, respinge, editează, ascunde, mută, șterge, recomandă, moderează comentariile și recenziile.
  group("downloads.moderate", { ...GLOBAL_MODS }),
];

/** ACP → Comunitate → Descărcări, plus raportul din zona Statistici. */
const acpMenu: GcsAcpMenuSection[] = [
  {
    app: "community",
    title: "acp.menu.community.downloads_group",
    icon: "fa-solid fa-download",
    items: [
      { key: DOWNLOADS_ACP.overview, labelKey: "acp.menu.community.downloads", href: "/admin/community/downloads", section: DOWNLOADS_ACP.overview, icon: "fa-solid fa-download", app: "downloads" },
      { key: DOWNLOADS_ACP.queue, labelKey: "acp.menu.community.downloads_queue", href: "/admin/community/downloads/queue", section: DOWNLOADS_ACP.queue, icon: "fa-solid fa-hourglass-half", app: "downloads" },
      { key: DOWNLOADS_ACP.files, labelKey: "acp.menu.community.downloads_files", href: "/admin/community/downloads/files", section: DOWNLOADS_ACP.files, icon: "fa-solid fa-file-zipper", app: "downloads" },
      { key: DOWNLOADS_ACP.categories, labelKey: "acp.menu.community.downloads_categories", href: "/admin/community/downloads/categories", section: DOWNLOADS_ACP.categories, icon: "fa-solid fa-folder-tree", app: "downloads" },
      { key: DOWNLOADS_ACP.fields, labelKey: "acp.menu.community.downloads_fields", href: "/admin/community/downloads/fields", section: DOWNLOADS_ACP.fields, icon: "fa-solid fa-list-check", app: "downloads" },
      { key: DOWNLOADS_ACP.antivirus, labelKey: "acp.menu.community.downloads_antivirus", href: "/admin/community/downloads/antivirus", section: DOWNLOADS_ACP.antivirus, icon: "fa-solid fa-shield-virus", app: "downloads" },
      { key: DOWNLOADS_ACP.settings, labelKey: "acp.menu.community.downloads_settings", href: "/admin/community/downloads/settings", section: DOWNLOADS_ACP.settings, icon: "fa-solid fa-sliders", app: "downloads" },
      { key: DOWNLOADS_ACP.stats, labelKey: "acp.menu.stats.downloads", href: "/admin/stats/downloads", section: DOWNLOADS_ACP.stats, icon: "fa-solid fa-download", area: "stats", group: "acp.menu.stats.apps", app: "downloads" },
    ],
  },
];

const limitField = { key: "limit", labelKey: "widgets.fields.limit", type: "number" as const, min: 1, max: 20 };

/** Casetele indexului ca widget-uri (oriunde pe site) și categoriile cu numărul de fișiere. */
const widgets: GcsWidgetDef[] = [
  widget({
    key: "downloads.latest",
    labelKey: "widgets.downloads.latest",
    descriptionKey: "widgets.desc.downloads.latest",
    icon: "fa-solid fa-download",
    defaultConfig: { limit: 5, kind: "new" },
    fields: [
      limitField,
      {
        key: "kind",
        labelKey: "widgets.fields.downloadsKind",
        type: "select",
        options: [
          { value: "new", labelKey: "widgets.downloadsKind.new" },
          { value: "downloaded", labelKey: "widgets.downloadsKind.downloaded" },
          { value: "rated", labelKey: "widgets.downloadsKind.rated" },
          { value: "featured", labelKey: "widgets.downloadsKind.featured" },
        ],
      },
    ],
  }),
  widget({ key: "downloads.categories", labelKey: "widgets.downloads.categories", descriptionKey: "widgets.desc.downloads.categories", icon: "fa-solid fa-folder-tree", defaultConfig: {}, fields: [] }),
];

/** Placa „Descărcări” din panoul de statistici: fișierele publicate (lipsește fără niciun fișier). */
async function downloadStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const total = await db.downloadFile.count({ where: { status: "APPROVED" } });
  if (total === 0) return [];
  return [{ key: "downloads.files", labelKey: "stats.tiles.downloads", value: total, icon: "fa-solid fa-download", href: "/downloads", color: "#3FB68B" }];
}

/**
 * Aplicația standard Descărcări (specul 2026-11-03-descarcari): categorii cu permisiuni, trimiteri cu aprobare,
 * versiuni, capturi cu watermark, câmpuri suplimentare, antivirusul ClamAV, recenzii, comentarii, logul descărcărilor,
 * RSS, widget-uri și categoriile clanurilor.
 */
export const downloadsModule: GcsModule = {
  key: "downloads",
  app: {
    optional: true,
    labelKey: "apps.downloads",
    icon: "fa-solid fa-download",
    descriptionKey: "apps.descriptions.downloads",
    routes: ["/downloads", "/api/downloads"],
    landing: { href: "/downloads" },
    settingsHref: "/admin/community/downloads/settings",
    sections: [
      { key: "downloads", labelKey: "site.nav.downloads", icon: "fa-solid fa-download", href: "/downloads" },
      { key: "submit", labelKey: "apps.sections.downloads_submit", icon: "fa-solid fa-cloud-arrow-up", href: "/downloads/submit" },
    ],
  },
  permissions,
  settings: DOWNLOAD_SETTINGS,
  acpMenu,
  eventListeners: [],
  notificationTypes: [
    { key: "downloads.review", labelKey: "notifications.type.downloads.review", important: false, defaultEmail: "INSTANT", category: "content" },
    { key: "downloads.version", labelKey: "notifications.type.downloads.version", important: false, defaultEmail: "DIGEST", category: "content" },
    { key: "downloads.new_file", labelKey: "notifications.type.downloads.new_file", important: false, defaultEmail: "DIGEST", category: "content" },
    { key: "downloads.feedback", labelKey: "notifications.type.downloads.feedback", important: false, defaultEmail: "DIGEST", category: "content", countEach: true },
    { key: "downloads.mention", labelKey: "notifications.type.downloads.mention", important: false, defaultEmail: "INSTANT", mention: true },
    { key: "downloads.queue", labelKey: "notifications.type.downloads.queue", important: false, defaultEmail: "DIGEST", category: "moderation", countEach: true },
    { key: "downloads.infected", labelKey: "notifications.type.downloads.infected", important: true, defaultEmail: "INSTANT", category: "moderation" },
  ],
  widgets,
  stats: downloadStatTiles,
  // După Clanuri; adus de actualizarea meniului `nav:v7`.
  nav: [{ key: "downloads", labelKey: "site.nav.downloads", icon: "fa-solid fa-download", href: "/downloads", position: 4, since: "nav:v7" }],
  navPrevious: [],
  memberGrants: downloadMemberGrants,
};
