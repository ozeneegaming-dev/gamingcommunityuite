import "server-only";
import { cookies } from "next/headers";
import { services } from "./services";

export const THEME_COOKIE = "gcs-theme";
export const THEME_MODES = ["dark", "light", "auto"] as const;
export type GcsThemeMode = (typeof THEME_MODES)[number];
export const isThemeMode = (v: unknown): v is GcsThemeMode => THEME_MODES.includes(v as GcsThemeMode);

/** Modul temei (dark / light / auto): alegerea vizitatorului (cookie), altfel setarea `site.theme` din ACP. */
export async function themeMode(): Promise<GcsThemeMode> {
  const fromCookie = (await cookies()).get(THEME_COOKIE)?.value;
  if (isThemeMode(fromCookie)) return fromCookie;
  const fromSettings = await services()
    .settings.get<string>("site.theme")
    .catch(() => "dark");
  return isThemeMode(fromSettings) ? fromSettings : "dark";
}
