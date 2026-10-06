import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isTimeZone, TZ_COOKIE } from "./lib/appearance";
import { services } from "./lib/services";

export const GCS_LOCALES = ["ro", "en", "de", "es", "fr", "ru"] as const;
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
  // Textele pluginurilor încărcate (etapa 6), sub `pluginText.<vendor>.<nume>`: etichetele lor din registry (permisiuni,
  // widget-uri, meniul ACP) se afișează ca orice alt mesaj.
  let pluginText: Record<string, unknown> = {};
  try {
    const plugins = services().plugins;
    await plugins.ready();
    pluginText = plugins.messages(locale);
  } catch {
    // Înainte de instalare nu există baza de date: fără pluginuri.
  }
  // Fusul orar: alegerea membrului (cookie), altfel cel al site-ului (ACP → Setări → Generale).
  const fromTzCookie = (await cookies()).get(TZ_COOKIE)?.value;
  const timeZone = isTimeZone(fromTzCookie)
    ? fromTzCookie
    : await services()
        .settings.get<string>("site.timezone")
        .then((tz) => (isTimeZone(tz) ? tz : "Europe/Bucharest"))
        .catch(() => "Europe/Bucharest");
  return { locale, messages: { ...messages, pluginText }, timeZone };
});
