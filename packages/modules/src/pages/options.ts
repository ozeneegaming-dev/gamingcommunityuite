import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";

/** Setările aplicației Pagini (ACP › Pagini › Setări), toate în secțiunea `pages`. */
export const PAGES_SETTING = {
  /** Pagina deschisă la `/pages` (id-ul ei; 0 = cuprinsul paginilor). */
  homePage: "pages.home_page",
  /** Cuprinsul arată și folderele (cu paginile lor) sau doar paginile de pe primul nivel. */
  directoryFolders: "pages.directory_folders",
  breadcrumbs: "pages.breadcrumbs",
  showUpdated: "pages.show_updated",
  recordsPerPage: "pages.records_per_page",
  commentsPerPage: "pages.comments_per_page",
  /** Ordinea comentariilor: cele mai vechi sau cele mai noi primele. */
  commentOrder: "pages.comment_order",
  mediaMaxMb: "pages.media_max_mb",
  /** Staff-ul (`pages.moderate`) e anunțat la fiecare trimitere în așteptare. */
  notifyStaff: "pages.notify_staff",
  /** Autorul e anunțat la fiecare comentariu nou pe înregistrarea lui. */
  notifyAuthor: "pages.notify_author",
  /** Pauza minimă între două trimiteri ale aceluiași membru (secunde; 0 = fără). */
  submitCooldown: "pages.submit_cooldown",
  /** Înregistrările „noi” (insigna NOU) în ultimele N zile. */
  newDays: "pages.new_days",
} as const;

export const PAGES_COMMENT_ORDERS = ["oldest", "newest"] as const;

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const oneOf = (allowed: readonly string[]) => (v: unknown) => (typeof v === "string" && allowed.includes(v) ? null : "invalid_choice");

function setting(key: string, type: GcsSettingDef["type"], value: unknown, validate?: GcsSettingDef["validate"], options?: readonly string[]): GcsSettingDef {
  const def: GcsSettingDef = { key, type, default: value, section: "pages", labelKey: `settings.${key}` };
  if (validate) def.validate = validate;
  if (options) def.options = [...options];
  return def;
}

export const PAGES_SETTINGS: GcsSettingDef[] = [
  setting(PAGES_SETTING.homePage, "number", 0, int(0, 2_000_000_000)),
  setting(PAGES_SETTING.directoryFolders, "boolean", true),
  setting(PAGES_SETTING.breadcrumbs, "boolean", true),
  setting(PAGES_SETTING.showUpdated, "boolean", true),
  setting(PAGES_SETTING.recordsPerPage, "number", 20, int(5, 100)),
  setting(PAGES_SETTING.commentsPerPage, "number", 20, int(5, 100)),
  setting(PAGES_SETTING.commentOrder, "string", "oldest", oneOf(PAGES_COMMENT_ORDERS), PAGES_COMMENT_ORDERS),
  setting(PAGES_SETTING.mediaMaxMb, "number", 10, int(1, 200)),
  setting(PAGES_SETTING.notifyStaff, "boolean", true),
  setting(PAGES_SETTING.notifyAuthor, "boolean", true),
  setting(PAGES_SETTING.submitCooldown, "number", 60, int(0, 86_400)),
  setting(PAGES_SETTING.newDays, "number", 7, int(0, 90)),
];

export type GcsPagesOptions = {
  homePage: number;
  directoryFolders: boolean;
  breadcrumbs: boolean;
  showUpdated: boolean;
  recordsPerPage: number;
  commentsPerPage: number;
  commentOrder: (typeof PAGES_COMMENT_ORDERS)[number];
  mediaMaxMb: number;
  notifyStaff: boolean;
  notifyAuthor: boolean;
  submitCooldown: number;
  newDays: number;
};

export async function readPagesOptions(settings: Pick<GcsSettingsService, "get">): Promise<GcsPagesOptions> {
  const get = <T>(key: string) => settings.get<T>(key);
  const [homePage, directoryFolders, breadcrumbs, showUpdated, recordsPerPage, commentsPerPage, commentOrder, mediaMaxMb, notifyStaff, notifyAuthor, submitCooldown, newDays] = await Promise.all([
    get<number>(PAGES_SETTING.homePage),
    get<boolean>(PAGES_SETTING.directoryFolders),
    get<boolean>(PAGES_SETTING.breadcrumbs),
    get<boolean>(PAGES_SETTING.showUpdated),
    get<number>(PAGES_SETTING.recordsPerPage),
    get<number>(PAGES_SETTING.commentsPerPage),
    get<string>(PAGES_SETTING.commentOrder),
    get<number>(PAGES_SETTING.mediaMaxMb),
    get<boolean>(PAGES_SETTING.notifyStaff),
    get<boolean>(PAGES_SETTING.notifyAuthor),
    get<number>(PAGES_SETTING.submitCooldown),
    get<number>(PAGES_SETTING.newDays),
  ]);
  return {
    homePage,
    directoryFolders,
    breadcrumbs,
    showUpdated,
    recordsPerPage,
    commentsPerPage,
    commentOrder: commentOrder === "newest" ? "newest" : "oldest",
    mediaMaxMb,
    notifyStaff,
    notifyAuthor,
    submitCooldown,
    newDays,
  };
}
