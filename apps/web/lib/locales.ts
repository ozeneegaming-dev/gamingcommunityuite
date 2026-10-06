import "server-only";
import { GCS_LOCALES } from "@/i18n";
import { services } from "./services";

/** Numele fiecărei limbi, în limba ei (selectorul de limbă). */
export const LOCALE_NAMES: Record<string, string> = { ro: "Română", en: "English", de: "Deutsch", es: "Español", fr: "Français", ru: "Русский" };

/** Limbile active din ACP (Sistem → Setări → Limbi și traducere), pentru selectoare. */
export async function localeOptions(): Promise<{ code: string; label: string }[]> {
  const enabled = await services()
    .settings.get<string[]>("i18n.locales")
    .catch((): string[] => [...GCS_LOCALES]);
  const list = GCS_LOCALES.filter((l) => !Array.isArray(enabled) || enabled.includes(l));
  return list.map((code) => ({ code, label: LOCALE_NAMES[code] ?? code }));
}
