/**
 * Previzualizarea managerului de meniu (Manager meniu v2), pe același mecanism ca editorul de temă: parametrul
 * `?gcs-nav-preview=1` (și cookie-ul lui, doar pentru documentele dintr-un `iframe`) devine în proxy header-ul intern de
 * mai jos; meniul din antet arată atunci ciorna, doar pentru un admin cu dreptul de editare și poarta ACP trecută.
 */
export const NAV_PREVIEW_PARAM = "gcs-nav-preview";
export const NAV_PREVIEW_COOKIE = "gcs-nav-preview";
export const NAV_PREVIEW_HEADER = "x-gcs-nav-preview";

/** Cererea cere previzualizarea (proxy): parametrul, sau cookie-ul într-un `iframe`. */
export function navPreviewFor(param: string | null, cookie: string | undefined, fetchDest: string | null): boolean {
  if (param !== null) return param === "1";
  return cookie === "1" && fetchDest === "iframe";
}
