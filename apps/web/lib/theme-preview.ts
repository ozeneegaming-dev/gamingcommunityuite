import { headerBuilderError, isThemeHtmlAttrs, THEME_PRESETS, type GcsHeaderBuilder, type GcsThemeHtmlAttrs } from "@gcs/core/themes";
/**
 * Protocolul `postMessage` dintre editorul vizual de temă și previzualizarea din `iframe` (aceeași origine).
 * Editorul trimite CSS-ul compilat al draft-ului, modul de culori editat și textul logo-ului; previzualizarea anunță
 * că e gata (la încărcare și la fiecare pagină nouă), ca editorul să-i retrimită starea curentă.
 */
/**
 * Previzualizarea din editorul vizual (`iframe`): parametrul `?gcs-theme-preview=<cheie>` (și cookie-ul cu același
 * nume, pentru documentele încărcate apoi în `iframe`) devine, în proxy, header-ul intern de mai jos. Header-ul venit
 * din afară e șters de proxy; oricum, draft-ul se arată doar cu dreptul de editare și poarta ACP trecută.
 */
export const THEME_PREVIEW_PARAM = "gcs-theme-preview";
export const THEME_PREVIEW_COOKIE = "gcs-theme-preview";
export const THEME_PREVIEW_HEADER = "x-gcs-theme-preview";

/**
 * Zona cererii, pusă de proxy (header intern, cel venit din afară e suprascris): `admin` pentru ACP și editoarele lui,
 * `site` pentru rest. Layout-ul rădăcină pune clasa designului temei (ex. `gcs-nova`) doar pe paginile site-ului: ACP-ul
 * are designul lui.
 */
export const SITE_AREA_HEADER = "x-gcs-area";
/** Header-ul intern cu calea cererii (pus de proxy; valoarea venită din afară e suprascrisă). */
export const SITE_PATH_HEADER = "x-gcs-path";
export const siteAreaFor = (pathname: string): "admin" | "site" => (pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : "site");

/** Clasa `<html>` a designului unei teme (`classic` nu are clasă: e aspectul de bază). */
export const designClass = (preset: string | undefined): string | null => (preset === "nova" ? "gcs-nova" : null);
/** Cheia unei teme (aceeași regulă ca în serviciul temelor). */
export const THEME_KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

/**
 * Cheia temei previzualizate pentru un request (proxy): din parametru, sau din cookie dar doar pentru un document
 * încărcat într-un `iframe` (`Sec-Fetch-Dest: iframe`), ca filele obișnuite ale adminului să vadă tema publicată.
 */
export function previewKeyFor(param: string | null, cookie: string | undefined, fetchDest: string | null): string | null {
  if (param !== null) return THEME_KEY_RE.test(param) ? param : null;
  return cookie && fetchDest === "iframe" && THEME_KEY_RE.test(cookie) ? cookie : null;
}

export const STUDIO_MESSAGE_SOURCE = "gcs-theme-studio";
export const PREVIEW_MESSAGE_SOURCE = "gcs-theme-preview";

/**
 * Starea trimisă previzualizării. Editorul vizual trimite tot; editorul de CSS din ACP (Aspect → CSS) trimite doar
 * CSS-ul compilat (modul și logo-ul previzualizării rămân cum sunt).
 */
export type GcsStudioApplyMessage = {
  source: typeof STUDIO_MESSAGE_SOURCE;
  type: "apply";
  css: string;
  mode?: "dark" | "light";
  logo?: { text: string; slogan: string };
  /** Designul temei editate (`classic` / `nova`): previzualizarea schimbă clasa de pe `<html>`. */
  preset?: string;
  /** Constructorul de antet (Nova): aspectul și opțiunile, aplicate live de antetul construit. */
  header?: { layout: GcsHeaderBuilder; options: Record<string, unknown> };
  /** Atributele setărilor de sistem de pe `<html>` (vezi `themeHtmlAttrs`), aplicate live. */
  attrs?: GcsThemeHtmlAttrs;
};

export type GcsPreviewReadyMessage = {
  source: typeof PREVIEW_MESSAGE_SOURCE;
  type: "ready";
  path: string;
};

export const isStudioApplyMessage = (d: unknown): d is GcsStudioApplyMessage => {
  if (!d || typeof d !== "object") return false;
  const m = d as Record<string, unknown>;
  const logo = m.logo as Record<string, unknown> | null | undefined;
  return (
    m.source === STUDIO_MESSAGE_SOURCE &&
    m.type === "apply" &&
    typeof m.css === "string" &&
    (m.mode === undefined || m.mode === "dark" || m.mode === "light") &&
    (m.preset === undefined || (THEME_PRESETS as readonly unknown[]).includes(m.preset)) &&
    (logo === undefined || (!!logo && typeof logo.text === "string" && typeof logo.slogan === "string")) &&
    (m.header === undefined || (!!m.header && typeof m.header === "object" && headerBuilderError((m.header as Record<string, unknown>).layout) === null)) &&
    (m.attrs === undefined || isThemeHtmlAttrs(m.attrs))
  );
};

export const isPreviewReadyMessage = (d: unknown): d is GcsPreviewReadyMessage =>
  !!d && typeof d === "object" && (d as Record<string, unknown>).source === PREVIEW_MESSAGE_SOURCE && (d as Record<string, unknown>).type === "ready";
