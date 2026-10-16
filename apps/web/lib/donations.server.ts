import "server-only";
import { isSafeHref } from "@gcs/core";
import { DONATION_URL_SETTING, DONATIONS_PAGE } from "@gcs/modules";
import { services } from "./services";

/**
 * Ținta butonului „Susține comunitatea”: linkul extern de donații din ACP (pagina de plată a comunității, într-o filă
 * nouă) sau, fără el, pagina `/donatii` (instrucțiunile și „Am donat”).
 */
export async function donationCta(): Promise<{ href: string; external: boolean }> {
  const url = (await services().settings.get<string>(DONATION_URL_SETTING)).trim();
  if (url && isSafeHref(url)) return { href: url, external: /^https?:\/\//i.test(url) };
  return { href: DONATIONS_PAGE, external: false };
}
