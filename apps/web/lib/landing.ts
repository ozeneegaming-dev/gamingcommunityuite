import "server-only";
import { guestActor } from "./seo";
import { services } from "./services";

/**
 * Aplicația de pornire (specul 2026-10-09-acp-navigatie-aplicatii §2.3). Forumul randează chiar `/`; când pornirea e
 * altă aplicație, `/` e rescris intern (proxy-ul) spre pagina ei, iar indexul forumului are adresa lui alternativă.
 */
export const FORUM_INDEX_ALT_HREF = "/forum";
/** Eticheta itemului „Forum” din meniul principal implicit (linkul lui urmează adresa indexului). */
export const FORUM_NAV_LABEL = "site.nav.forum";

/** Adresa indexului forumului: `/` când Forumul e pornirea (pentru oricine), altfel `/forum`. */
export async function forumIndexHref(): Promise<string> {
  try {
    return (await services().apps.landingFor(null)) ? FORUM_INDEX_ALT_HREF : "/";
  } catch {
    return "/";
  }
}

/**
 * Adresa canonică a paginii unei aplicații: `/` dacă aplicația e pornirea pe care o văd motoarele de căutare (un
 * vizitator), altfel adresa ei. Pagina are atunci același conținut pe `/` și pe adresa ei, cu o singură adresă canonică.
 */
export async function landingCanonical(app: string, path: string): Promise<string> {
  try {
    return (await services().apps.landingFor(await guestActor()))?.key === app ? "/" : path;
  } catch {
    return path;
  }
}
