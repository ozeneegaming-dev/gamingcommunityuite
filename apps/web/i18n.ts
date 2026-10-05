import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { services } from "./lib/services";

export const GCS_LOCALES = ["ro", "en"] as const;
export type GcsLocale = (typeof GCS_LOCALES)[number];
export const LOCALE_COOKIE = "gcs-locale";

const isLocale = (v: unknown): v is GcsLocale => GCS_LOCALES.includes(v as GcsLocale);

/**
 * Limba UI-ului (spec §2.1: RO implicit, EN): preferința din cookie, altfel setarea `site.locale` din ACP.
 * Fără prefix de limbă în URL: aceeași pagină, în limba aleasă.
 */
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: GcsLocale = "ro";
  if (isLocale(fromCookie)) {
    locale = fromCookie;
  } else {
    const fromSettings = await services()
      .settings.get<string>("site.locale")
      .catch(() => "ro");
    if (isLocale(fromSettings)) locale = fromSettings;
  }
  const messages = (await import(`./messages/${locale}.json`)).default as Record<string, unknown>;
  return { locale, messages, timeZone: "Europe/Bucharest" };
});
