import { domainListError, type GcsSettingDef } from "@gcs/core";

/**
 * ACP → Promovare → SEO (`/admin/system/seo`, secțiunea ACP `system.seo`): `robots.txt`, sitemap-ul, IndexNow, titlul
 * și metadatele paginilor, verificarea la motoarele de căutare, linkurile externe și indexarea profilurilor. Descrierea
 * implicită a site-ului (`<meta name="description">`) e setarea existentă `site.description`, mutată aici.
 */
export const SEO_SECTION = "seo";
export const SEO_ACP_SECTION = "system.seo";

export const ROBOTS_MODES = ["default", "custom"] as const;
export type GcsRobotsMode = (typeof ROBOTS_MODES)[number];
/** Tipurile de conținut din sitemap. `pages` = pagina principală și paginile publice ale site-ului (reguli, termeni…). */
export const SITEMAP_TYPES = ["pages", "forums", "topics", "members", "clans", "servers"] as const;
export type GcsSitemapType = (typeof SITEMAP_TYPES)[number];

export const SEO_SETTINGS = {
  robotsMode: "seo.robots_mode",
  robotsCustom: "seo.robots_custom",
  sitemapEnabled: "seo.sitemap_enabled",
  sitemapMaxUrls: "seo.sitemap_max_urls",
  indexNowEnabled: "seo.indexnow_enabled",
  indexNowKey: "seo.indexnow_key",
  titleFormat: "seo.title_format",
  description: "site.description",
  shareImage: "seo.share_image",
  xHandle: "seo.x_handle",
  googleVerification: "seo.google_verification",
  bingVerification: "seo.bing_verification",
  yandexVerification: "seo.yandex_verification",
  nofollowExternal: "seo.nofollow_external",
  nofollowExclude: "seo.nofollow_exclude",
  indexProfiles: "seo.index_profiles",
} as const;
export const sitemapTypeSetting = (type: GcsSitemapType) => `seo.sitemap_${type}`;

/** Limita unui `robots.txt` personalizat (motoarele citesc cel mult câteva sute de KB; un admin are nevoie de puțin). */
export const ROBOTS_CUSTOM_MAX = 10_000;
export const TITLE_FORMAT_DEFAULT = "{page} · {site}";
/** Câte adrese poate avea un tip de conținut în sitemap (limita setării). */
export const SITEMAP_MAX_URLS_LIMIT = 1_000_000;

const intIn = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : "invalid_range");
const oneOf = (values: readonly string[]) => (v: unknown) => (values.includes(v as string) ? null : "invalid_choice");

/** Textul personalizat al `robots.txt`: cel mult `ROBOTS_CUSTOM_MAX` caractere, fără caractere de control. */
export const robotsCustomError = (v: unknown): string | null => {
  if (typeof v !== "string") return "invalid_type";
  if (v.length > ROBOTS_CUSTOM_MAX) return "too_long";
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) ? "invalid_chars" : null;
};

/** Formatul titlului: `{page}` o dată (titlul paginii), opțional `{site}`; cel mult 120 de caractere. */
export const titleFormatError = (v: unknown): string | null => {
  if (typeof v !== "string") return "invalid_type";
  if (v.length > 120) return "too_long";
  return v.split("{page}").length === 2 && !/[<>]/.test(v) ? null : "page_placeholder";
};

/** Imaginea de distribuire: o adresă `https://` sau un fișier încărcat aici (`/files/<id>`), ori gol. */
export const shareImageError = (v: unknown): string | null => {
  if (v === "") return null;
  if (typeof v !== "string" || v.length > 500) return "invalid_url";
  if (/^\/files\/[A-Za-z0-9_-]{1,40}$/.test(v)) return null;
  return /^https:\/\//i.test(v) && URL.canParse(v) && !/[\s"'<>]/.test(v) ? null : "invalid_url";
};

/** Contul X (Twitter): `@nume` sau `nume` (1–15 litere, cifre, `_`), ori gol. */
export const xHandleError = (v: unknown): string | null => (v === "" || (typeof v === "string" && /^@?[A-Za-z0-9_]{1,15}$/.test(v)) ? null : "invalid_handle");

/**
 * Codul de verificare al unui motor de căutare: valoarea `content` (litere, cifre, `-_:.=+/`) sau tot tag-ul `<meta>`
 * copiat din consola motorului (se păstrează doar valoarea, vezi `verificationToken`).
 */
export const verificationError = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 300) return "invalid_token";
  return v.trim() === "" || verificationToken(v) !== "" ? null : "invalid_token";
};

const TOKEN = /^[A-Za-z0-9_\-:.=+/]{1,200}$/;
/** Valoarea de pus în `<meta content>`: codul, sau `content="…"` dintr-un tag lipit întreg; `""` dacă nu e valid. */
export function verificationToken(raw: string): string {
  const v = raw.trim();
  if (TOKEN.test(v)) return v;
  const m = /^<meta\s[^>]*content\s*=\s*["']([^"']+)["'][^>]*>$/i.exec(v);
  return m && TOKEN.test(m[1]!) ? m[1]! : "";
}

/** Cheia IndexNow: 32 de caractere hexazecimale (generată automat), ori gol până la prima pornire. */
export const indexNowKeyError = (v: unknown): string | null => (v === "" || (typeof v === "string" && /^[a-f0-9]{32}$/.test(v)) ? null : "invalid");

const def = (key: string, type: GcsSettingDef["type"], defaultValue: unknown, validate?: GcsSettingDef["validate"], extra: Partial<GcsSettingDef> = {}): GcsSettingDef => ({
  key,
  type,
  default: defaultValue,
  section: SEO_SECTION,
  labelKey: `settings.seo.${key.replace(/^(seo|site)\./, "")}`,
  ...(validate ? { validate } : {}),
  ...extra,
});

export const SEO_SETTING_DEFS: GcsSettingDef[] = [
  def(SEO_SETTINGS.robotsMode, "string", "default", oneOf(ROBOTS_MODES), { options: [...ROBOTS_MODES] }),
  def(SEO_SETTINGS.robotsCustom, "string", "", robotsCustomError, { multiline: true }),
  def(SEO_SETTINGS.sitemapEnabled, "boolean", true),
  ...SITEMAP_TYPES.map((type) => def(sitemapTypeSetting(type), "boolean", true)),
  def(SEO_SETTINGS.sitemapMaxUrls, "number", 50_000, intIn(100, SITEMAP_MAX_URLS_LIMIT)),
  def(SEO_SETTINGS.indexNowEnabled, "boolean", false),
  // Generată automat (ACP → SEO, la pornire sau „Cheie nouă”); nu apare în formular.
  def(SEO_SETTINGS.indexNowKey, "string", "", indexNowKeyError),
  def(SEO_SETTINGS.titleFormat, "string", TITLE_FORMAT_DEFAULT, titleFormatError),
  // Descrierea din `<meta name="description">` (motoarele de căutare); goală → un text generic cu numele site-ului.
  def(SEO_SETTINGS.description, "string", "", (v) => (typeof v === "string" && v.length <= 300 ? null : "too_long"), { multiline: true }),
  def(SEO_SETTINGS.shareImage, "string", "", shareImageError),
  def(SEO_SETTINGS.xHandle, "string", "", xHandleError),
  def(SEO_SETTINGS.googleVerification, "string", "", verificationError),
  def(SEO_SETTINGS.bingVerification, "string", "", verificationError),
  def(SEO_SETTINGS.yandexVerification, "string", "", verificationError),
  def(SEO_SETTINGS.nofollowExternal, "boolean", true),
  def(SEO_SETTINGS.nofollowExclude, "string", "", domainListError, { multiline: true }),
  def(SEO_SETTINGS.indexProfiles, "boolean", true),
];

/** Grupurile de câmpuri ale paginii ACP → SEO (fiecare card are formularul lui). */
export const SEO_GROUPS = {
  robots: [SEO_SETTINGS.robotsMode, SEO_SETTINGS.robotsCustom],
  sitemap: [SEO_SETTINGS.sitemapEnabled, ...SITEMAP_TYPES.map(sitemapTypeSetting), SEO_SETTINGS.sitemapMaxUrls, SEO_SETTINGS.indexProfiles],
  indexNow: [SEO_SETTINGS.indexNowEnabled],
  meta: [SEO_SETTINGS.titleFormat, SEO_SETTINGS.description, SEO_SETTINGS.shareImage, SEO_SETTINGS.xHandle],
  verification: [SEO_SETTINGS.googleVerification, SEO_SETTINGS.bingVerification, SEO_SETTINGS.yandexVerification],
  links: [SEO_SETTINGS.nofollowExternal, SEO_SETTINGS.nofollowExclude],
} as const;
export type GcsSeoGroup = keyof typeof SEO_GROUPS;
