import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";

/**
 * Setările aplicației Descărcări (ACP → Comunitate → Descărcări → Setări / Antivirus), toate în secțiunea `downloads`,
 * și opțiunile unei categorii (coloana `options`), cu valorile implicite și normalizarea lor.
 */
export const DOWNLOADS_SECTION = "downloads";

export const DOWNLOAD_SETTING = {
  maxFileMb: "downloads.max_file_mb",
  totalQuotaGb: "downloads.total_quota_gb",
  perPage: "downloads.per_page",
  boxFeatured: "downloads.box_featured",
  boxFeaturedCount: "downloads.box_featured_count",
  boxNew: "downloads.box_new",
  boxNewCategories: "downloads.box_new_categories",
  boxRated: "downloads.box_rated",
  boxRatedCategories: "downloads.box_rated_categories",
  boxDownloaded: "downloads.box_downloaded",
  boxDownloadedCategories: "downloads.box_downloaded_categories",
  boxCount: "downloads.box_count",
  watermarkId: "downloads.watermark_id",
  watermarkPosition: "downloads.watermark_position",
  watermarkOpacity: "downloads.watermark_opacity",
  urlBlocklist: "downloads.url_blocklist",
  preventDirect: "downloads.prevent_direct",
  rss: "downloads.rss",
  unfinishedHours: "downloads.unfinished_hours",
  avEnabled: "downloads.av_enabled",
  avAddress: "downloads.av_address",
  avMaxScanMb: "downloads.av_max_scan_mb",
  avOnError: "downloads.av_on_error",
  avRescanHours: "downloads.av_rescan_hours",
  avQuarantineDays: "downloads.av_quarantine_days",
  avForumAttachments: "downloads.av_forum_attachments",
} as const;

export const WATERMARK_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left", "center"] as const;
export type GcsWatermarkPosition = (typeof WATERMARK_POSITIONS)[number];
/** Ce se întâmplă când antivirusul nu poate verifica un fișier (serviciul nu răspunde, fișierul e prea mare). */
export const AV_ON_ERROR = ["approval", "block"] as const;
export type GcsAvOnError = (typeof AV_ON_ERROR)[number];

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const oneOf = (allowed: readonly string[]) => (v: unknown) => (typeof v === "string" && allowed.includes(v) ? null : "invalid_choice");
const idList = (v: unknown) => (Array.isArray(v) && v.length <= 200 && v.every((x) => Number.isInteger(x) && (x as number) > 0) ? null : "invalid_choice");
/** `gazda:port` (serviciul antivirus); gol = fără antivirus. */
const avAddressError = (v: unknown) => (typeof v === "string" && (v === "" || /^[A-Za-z0-9.-]{1,253}:\d{1,5}$/.test(v)) ? null : "invalid");
/** Domeniile blocate: unul pe rând, litere / cifre / `.` / `-` (fără schemă sau cale). */
const blocklistError = (v: unknown) => {
  if (typeof v !== "string" || v.length > 10_000) return "invalid";
  return parseDomainList(v).invalid.length > 0 ? "invalid_domain" : null;
};

function setting(key: string, type: GcsSettingDef["type"], value: unknown, validate?: GcsSettingDef["validate"], extra: Partial<GcsSettingDef> = {}): GcsSettingDef {
  return { key, type, default: value, section: DOWNLOADS_SECTION, labelKey: `settings.${key}`, ...(validate ? { validate } : {}), ...extra };
}

export const DOWNLOAD_SETTINGS: GcsSettingDef[] = [
  // Limita implicită a unui fișier (decizia proprietarului: 200 MB); o categorie o poate schimba, grupurile o pot micșora.
  setting(DOWNLOAD_SETTING.maxFileMb, "number", 200, int(1, 51_200)),
  // Spațiul total al descărcărilor pe site (0 = fără limită); fiecare membru are și cota grupului (`downloads.quota_mb`).
  setting(DOWNLOAD_SETTING.totalQuotaGb, "number", 0, int(0, 100_000)),
  setting(DOWNLOAD_SETTING.perPage, "number", 24, int(6, 100)),
  setting(DOWNLOAD_SETTING.boxFeatured, "boolean", true),
  setting(DOWNLOAD_SETTING.boxFeaturedCount, "number", 4, int(1, 12)),
  setting(DOWNLOAD_SETTING.boxNew, "boolean", true),
  setting(DOWNLOAD_SETTING.boxNewCategories, "json", [], idList),
  setting(DOWNLOAD_SETTING.boxRated, "boolean", true),
  setting(DOWNLOAD_SETTING.boxRatedCategories, "json", [], idList),
  setting(DOWNLOAD_SETTING.boxDownloaded, "boolean", true),
  setting(DOWNLOAD_SETTING.boxDownloadedCategories, "json", [], idList),
  setting(DOWNLOAD_SETTING.boxCount, "number", 6, int(3, 24)),
  // Atașamentul imaginii de watermark (gol = fără); se pune pe capturile încărcate după salvare.
  setting(DOWNLOAD_SETTING.watermarkId, "string", "", (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{0,40}$/.test(v) ? null : "invalid")),
  setting(DOWNLOAD_SETTING.watermarkPosition, "string", "bottom-right", oneOf(WATERMARK_POSITIONS), { options: [...WATERMARK_POSITIONS] }),
  setting(DOWNLOAD_SETTING.watermarkOpacity, "number", 70, int(10, 100)),
  setting(DOWNLOAD_SETTING.urlBlocklist, "string", "", blocklistError, { multiline: true }),
  setting(DOWNLOAD_SETTING.preventDirect, "boolean", true),
  setting(DOWNLOAD_SETTING.rss, "boolean", true),
  // Încărcările neterminate (formular nesalvat) se șterg după atâtea ore.
  setting(DOWNLOAD_SETTING.unfinishedHours, "number", 24, int(1, 720)),
  setting(DOWNLOAD_SETTING.avEnabled, "boolean", true),
  setting(DOWNLOAD_SETTING.avAddress, "string", "clamav:3310", avAddressError),
  setting(DOWNLOAD_SETTING.avMaxScanMb, "number", 400, int(10, 4096)),
  setting(DOWNLOAD_SETTING.avOnError, "string", "approval", oneOf(AV_ON_ERROR), { options: [...AV_ON_ERROR] }),
  // 0 = fără rescanări; altfel fișierele publicate se verifică din nou cu semnăturile noi, cel mult o dată la N ore.
  setting(DOWNLOAD_SETTING.avRescanHours, "number", 24, (v) => (v === 0 ? null : int(6, 8760)(v))),
  // Fișierele infectate rămân în carantină atâtea zile (staff-ul le poate vedea / șterge), apoi se șterg (0 = păstrate).
  setting(DOWNLOAD_SETTING.avQuarantineDays, "number", 30, int(0, 3650)),
  setting(DOWNLOAD_SETTING.avForumAttachments, "boolean", true),
];

export type GcsDownloadOptions = {
  maxFileMb: number;
  totalQuotaGb: number;
  perPage: number;
  boxes: {
    featured: { show: boolean; count: number };
    new: { show: boolean; categories: number[] };
    rated: { show: boolean; categories: number[] };
    downloaded: { show: boolean; categories: number[] };
    count: number;
  };
  watermark: { id: string; position: GcsWatermarkPosition; opacity: number };
  urlBlocklist: string[];
  preventDirect: boolean;
  rss: boolean;
  unfinishedHours: number;
  av: { enabled: boolean; address: string; maxScanMb: number; onError: GcsAvOnError; rescanHours: number; quarantineDays: number; forumAttachments: boolean };
};

/** Toate setările Descărcărilor, dintr-o singură citire a secțiunii (cache-uită de serviciul setărilor). */
export async function readDownloadOptions(settings: Pick<GcsSettingsService, "getMany">): Promise<GcsDownloadOptions> {
  const v = await settings.getMany(DOWNLOADS_SECTION);
  const get = <T>(key: string) => v[key] as T;
  const ids = (key: string) => (Array.isArray(v[key]) ? (v[key] as unknown[]).filter((x): x is number => Number.isInteger(x)) : []);
  return {
    maxFileMb: get<number>(DOWNLOAD_SETTING.maxFileMb),
    totalQuotaGb: get<number>(DOWNLOAD_SETTING.totalQuotaGb),
    perPage: get<number>(DOWNLOAD_SETTING.perPage),
    boxes: {
      featured: { show: get<boolean>(DOWNLOAD_SETTING.boxFeatured), count: get<number>(DOWNLOAD_SETTING.boxFeaturedCount) },
      new: { show: get<boolean>(DOWNLOAD_SETTING.boxNew), categories: ids(DOWNLOAD_SETTING.boxNewCategories) },
      rated: { show: get<boolean>(DOWNLOAD_SETTING.boxRated), categories: ids(DOWNLOAD_SETTING.boxRatedCategories) },
      downloaded: { show: get<boolean>(DOWNLOAD_SETTING.boxDownloaded), categories: ids(DOWNLOAD_SETTING.boxDownloadedCategories) },
      count: get<number>(DOWNLOAD_SETTING.boxCount),
    },
    watermark: { id: get<string>(DOWNLOAD_SETTING.watermarkId), position: get<GcsWatermarkPosition>(DOWNLOAD_SETTING.watermarkPosition), opacity: get<number>(DOWNLOAD_SETTING.watermarkOpacity) },
    urlBlocklist: parseDomainList(get<string>(DOWNLOAD_SETTING.urlBlocklist) ?? "").domains,
    preventDirect: get<boolean>(DOWNLOAD_SETTING.preventDirect),
    rss: get<boolean>(DOWNLOAD_SETTING.rss),
    unfinishedHours: get<number>(DOWNLOAD_SETTING.unfinishedHours),
    av: {
      enabled: get<boolean>(DOWNLOAD_SETTING.avEnabled),
      address: get<string>(DOWNLOAD_SETTING.avAddress),
      maxScanMb: get<number>(DOWNLOAD_SETTING.avMaxScanMb),
      onError: get<GcsAvOnError>(DOWNLOAD_SETTING.avOnError),
      rescanHours: get<number>(DOWNLOAD_SETTING.avRescanHours),
      quarantineDays: get<number>(DOWNLOAD_SETTING.avQuarantineDays),
      forumAttachments: get<boolean>(DOWNLOAD_SETTING.avForumAttachments),
    },
  };
}

/** Lista de domenii (una pe rând sau separate prin virgulă): domeniile valide, cu litere mici, și cele greșite. */
export function parseDomainList(raw: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const d = part.trim().toLowerCase().replace(/^\*\./, "");
    if (!d) continue;
    if (/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
      if (!domains.includes(d)) domains.push(d);
    } else invalid.push(part.trim());
  }
  return { domains, invalid };
}

/** Gazda e unul dintre domeniile blocate sau un subdomeniu al lor. */
export function isBlockedHost(host: string, blocklist: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return blocklist.some((d) => h === d || h.endsWith(`.${d}`));
}

// ─── Opțiunile unei categorii ─────────────────────────────────────────────────────────────────────────────

export const CATEGORY_SORTS = ["updated", "newest", "downloads", "rating", "title"] as const;
export type GcsCategorySort = (typeof CATEGORY_SORTS)[number];
export const VERSIONING_MODES = ["off", "optional", "required"] as const;
export type GcsVersioningMode = (typeof VERSIONING_MODES)[number];
export const TERMS_WHEN = ["download", "submit", "both", "never"] as const;

/**
 * Extensiile implicite ale unei categorii noi: arhive, fișierele de joc / servere și configurațiile. „Orice extensie” se
 * alege explicit (lista goală), iar conținutul se verifică oricum (un executabil deghizat e respins).
 */
export const DEFAULT_CATEGORY_EXTENSIONS = [
  "zip", "rar", "7z", "gz", "tar", "bz2", "xz",
  "cfg", "ini", "txt", "json", "lua", "sp", "sma", "inc", "smx", "amxx", "md",
  "bsp", "nav", "vpk", "dem", "wad", "mdl", "spr", "res", "vmt", "vtf", "pak",
  "wav", "mp3", "ogg", "png", "jpg", "webp", "pdf",
] as const;

export type GcsCategoryOptions = {
  comments: boolean;
  commentsApproval: boolean;
  reviews: boolean;
  reviewNeedsDownload: boolean;
  reviewsApproval: boolean;
  sort: GcsCategorySort;
  /** Extensiile permise (litere mici, fără punct); goală = orice extensie. */
  extensions: string[];
  /** MB; `null` = limita implicită a site-ului, `0` = fără limită de categorie. */
  maxFileMb: number | null;
  multipleFiles: boolean;
  versioning: GcsVersioningMode;
  keepVersions: boolean;
  /** Câte versiuni vechi se păstrează (0 = toate). */
  versionsToKeep: number;
  requireChangelog: boolean;
  approval: boolean;
  screenshots: boolean;
  requireScreenshots: boolean;
  /** KB pentru o captură (0 = limita grupului pentru imagini). */
  screenshotMaxKb: number;
  maxScreenshots: number;
  tags: boolean;
  /** Termenii (text simplu, pe rânduri) și când se acceptă. */
  terms: string;
  termsWhen: (typeof TERMS_WHEN)[number];
  submitTerms: string;
  /** Mesajele proprii pentru cine nu poate vedea / descărca (text simplu; gol = mesajul obișnuit). */
  cannotView: string;
  cannotDownload: string;
  logDownloads: boolean;
  /** Zile (0 = păstrat mereu). */
  logDays: number;
  authorSeesLog: boolean;
  forumTopic: { enabled: boolean; forumId: number; prefix: string; suffix: string; deleteWithFile: boolean; screenshot: boolean };
};

export const DEFAULT_CATEGORY_OPTIONS: GcsCategoryOptions = {
  comments: true,
  commentsApproval: false,
  reviews: true,
  reviewNeedsDownload: false,
  reviewsApproval: false,
  sort: "updated",
  extensions: [...DEFAULT_CATEGORY_EXTENSIONS],
  maxFileMb: null,
  multipleFiles: true,
  versioning: "optional",
  keepVersions: true,
  versionsToKeep: 0,
  requireChangelog: false,
  // Decizia proprietarului: ce trimit membrii apare după aprobarea staff-ului.
  approval: true,
  screenshots: true,
  requireScreenshots: false,
  screenshotMaxKb: 0,
  maxScreenshots: 8,
  tags: true,
  terms: "",
  termsWhen: "download",
  submitTerms: "",
  cannotView: "",
  cannotDownload: "",
  logDownloads: true,
  logDays: 0,
  authorSeesLog: false,
  forumTopic: { enabled: false, forumId: 0, prefix: "", suffix: "", deleteWithFile: false, screenshot: false },
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const intIn = (v: unknown, min: number, max: number, d: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : d);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const choice = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/** Extensia normalizată (`.ZIP` → `zip`) sau `null` dacă nu e o extensie validă. */
export function normalizeExtension(raw: string): string | null {
  const e = raw.trim().toLowerCase().replace(/^\*?\./, "");
  return /^[a-z0-9]{1,12}$/.test(e) ? e : null;
}

/** Opțiunile salvate ale unei categorii (oricât de vechi sau incomplete), completate cu valorile implicite. */
export function categoryOptions(raw: unknown): GcsCategoryOptions {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_CATEGORY_OPTIONS;
  const ft = o.forumTopic && typeof o.forumTopic === "object" ? (o.forumTopic as Record<string, unknown>) : {};
  const exts = Array.isArray(o.extensions)
    ? [...new Set((o.extensions as unknown[]).map((e) => (typeof e === "string" ? normalizeExtension(e) : null)).filter((e): e is string => e !== null))].slice(0, 100)
    : [...d.extensions];
  return {
    comments: bool(o.comments, d.comments),
    commentsApproval: bool(o.commentsApproval, d.commentsApproval),
    reviews: bool(o.reviews, d.reviews),
    reviewNeedsDownload: bool(o.reviewNeedsDownload, d.reviewNeedsDownload),
    reviewsApproval: bool(o.reviewsApproval, d.reviewsApproval),
    sort: choice(o.sort, CATEGORY_SORTS, d.sort),
    extensions: exts,
    maxFileMb: o.maxFileMb === null || o.maxFileMb === undefined ? null : intIn(o.maxFileMb, 0, 51_200, 0),
    multipleFiles: bool(o.multipleFiles, d.multipleFiles),
    versioning: choice(o.versioning, VERSIONING_MODES, d.versioning),
    keepVersions: bool(o.keepVersions, d.keepVersions),
    versionsToKeep: intIn(o.versionsToKeep, 0, 1000, d.versionsToKeep),
    requireChangelog: bool(o.requireChangelog, d.requireChangelog),
    approval: bool(o.approval, d.approval),
    screenshots: bool(o.screenshots, d.screenshots),
    requireScreenshots: bool(o.requireScreenshots, d.requireScreenshots),
    screenshotMaxKb: intIn(o.screenshotMaxKb, 0, 102_400, d.screenshotMaxKb),
    maxScreenshots: intIn(o.maxScreenshots, 1, 30, d.maxScreenshots),
    tags: bool(o.tags, d.tags),
    terms: text(o.terms, 5000),
    termsWhen: choice(o.termsWhen, TERMS_WHEN, d.termsWhen),
    submitTerms: text(o.submitTerms, 5000),
    cannotView: text(o.cannotView, 2000),
    cannotDownload: text(o.cannotDownload, 2000),
    logDownloads: bool(o.logDownloads, d.logDownloads),
    logDays: intIn(o.logDays, 0, 3650, d.logDays),
    authorSeesLog: bool(o.authorSeesLog, d.authorSeesLog),
    forumTopic: {
      enabled: bool(ft.enabled, false),
      forumId: intIn(ft.forumId, 0, 2_147_483_647, 0),
      prefix: text(ft.prefix, 40),
      suffix: text(ft.suffix, 40),
      deleteWithFile: bool(ft.deleteWithFile, false),
      screenshot: bool(ft.screenshot, false),
    },
  };
}

/** Limita efectivă a unui fișier, în octeți (`null` = fără limită): cea mai mică dintre categorie și grup. */
export function effectiveMaxBytes(opts: { siteMb: number; categoryMb: number | null; groupMb: number }): number | null {
  const limits: number[] = [];
  const category = opts.categoryMb === null ? opts.siteMb : opts.categoryMb;
  if (category > 0) limits.push(category);
  if (opts.groupMb > 0) limits.push(opts.groupMb);
  return limits.length === 0 ? null : Math.min(...limits) * 1024 * 1024;
}
