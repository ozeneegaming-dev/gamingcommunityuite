/**
 * Acceptarea termenilor la înregistrare și închiderea benzii de cookie-uri (comune serverului și browserului).
 * - Înregistrarea cu email trimite acceptarea în antetul `x-gcs-terms: 1`.
 * - Înregistrarea prin Discord / Google / Steam trece prin site-ul furnizorului: căsuța bifată lasă un cookie scurt
 *   (15 minute), citit pe server când se creează contul.
 * - Banda de cookie-uri, odată închisă, nu mai apare (cookie pe un an; serverul nu o mai randează deloc).
 */
export const TERMS_HEADER = "x-gcs-terms";
export const TERMS_COOKIE = "gcs-terms-ok";
export const TERMS_COOKIE_MAX_AGE = 15 * 60;
export const COOKIE_NOTICE_COOKIE = "gcs-cookie-ok";
export const COOKIE_NOTICE_MAX_AGE = 365 * 24 * 3600;

/** Valoarea unui cookie din antetul `Cookie` (fără dependențe; numele nostru nu are caractere speciale). */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Acceptarea termenilor din cererea care creează contul: antetul (email) sau cookie-ul (furnizorii externi). */
export function termsAcceptedIn(headers: Headers | null | undefined, path: string | null | undefined): boolean {
  if (!headers) return false;
  if (path === "/sign-up/email") return headers.get(TERMS_HEADER) === "1";
  return readCookie(headers.get("cookie"), TERMS_COOKIE) === "1";
}
