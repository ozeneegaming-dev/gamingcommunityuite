/**
 * Constantele aplicației Descărcări (fără dependențe de server: se importă și din paginile client prin
 * `@gcs/modules/downloads-text`): cheile containerelor și ale conținuturilor, secțiunile ACP, linkurile paginilor și
 * formatarea mărimilor.
 */

/** Tipul de container al categoriilor (matricea de permisiuni `downloads.*`). */
export const DOWNLOADS_CONTAINER = "downloads";
/** Conținutul „fișier” (urmăririle, reacțiile, notificările). */
export const DOWNLOAD_FILE_CONTENT = "downloads.file";
/** Capturile unui fișier (atașamente legate de id-ul fișierului). */
export const DOWNLOAD_SCREENSHOT = "downloads.screenshot";
/** Iconița și coperta unei categorii (publice, ca iconițele forumurilor). */
export const DOWNLOAD_CATEGORY_IMAGE = "downloads.category";
/** Imaginea de watermark (ACP → Descărcări → Setări). */
export const DOWNLOAD_WATERMARK = "downloads.watermark";

/** Secțiunile ACP (rolurile ACP): Comunitate → Descărcări. */
export const DOWNLOADS_ACP = {
  overview: "community.downloads",
  queue: "community.downloads_queue",
  files: "community.downloads_files",
  categories: "community.downloads_categories",
  fields: "community.downloads_fields",
  antivirus: "community.downloads_antivirus",
  settings: "community.downloads_settings",
  stats: "stats.downloads",
} as const;

export const DOWNLOADS_CACHE_TAG = "downloads";

/** Mărimea bucăților la încărcare (sub limita corpului cererilor și a proxy-ului din fața site-ului). */
export const DOWNLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export const downloadsHref = "/downloads";
export const downloadCategoryHref = (c: { id: number; slug: string }) => `/downloads/category/${c.id}-${c.slug}`;
export const downloadFileHref = (f: { id: number; slug: string }) => `/downloads/file/${f.id}-${f.slug}`;

/** `1536` → `1,5 KB`; `0` → `0 B` (unități binare, o zecimală peste KB). */
export function formatBytes(bytes: number, locale = "ro"): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale === "ro" ? "ro-RO" : locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** Stările unui fișier, cu litere mici (URL-uri, clase CSS, chei de traducere). */
export const DOWNLOAD_STATUSES = ["scanning", "pending", "approved", "rejected", "quarantined", "hidden"] as const;
export type GcsDownloadStatus = (typeof DOWNLOAD_STATUSES)[number];
