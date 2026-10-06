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

export type GcsStudioApplyMessage = {
  source: typeof STUDIO_MESSAGE_SOURCE;
  type: "apply";
  css: string;
  mode: "dark" | "light";
  logo: { text: string; slogan: string };
};

export type GcsPreviewReadyMessage = {
  source: typeof PREVIEW_MESSAGE_SOURCE;
  type: "ready";
  path: string;
};

export const isStudioApplyMessage = (d: unknown): d is GcsStudioApplyMessage => {
  if (!d || typeof d !== "object") return false;
  const m = d as Record<string, unknown>;
  const logo = m.logo as Record<string, unknown> | undefined;
  return (
    m.source === STUDIO_MESSAGE_SOURCE &&
    m.type === "apply" &&
    typeof m.css === "string" &&
    (m.mode === "dark" || m.mode === "light") &&
    !!logo &&
    typeof logo.text === "string" &&
    typeof logo.slogan === "string"
  );
};

export const isPreviewReadyMessage = (d: unknown): d is GcsPreviewReadyMessage =>
  !!d && typeof d === "object" && (d as Record<string, unknown>).source === PREVIEW_MESSAGE_SOURCE && (d as Record<string, unknown>).type === "ready";
