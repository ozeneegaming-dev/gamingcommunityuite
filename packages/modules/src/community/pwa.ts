import type { GcsSettingDef, GcsSettingsService } from "@gcs/core";

/** Secțiunea ACP (ACP › Sistem › Setări › Web App). */
export const PWA_ACP_SECTION = "system.settings_pwa";
export const PWA_SETTING = "pwa.config";

export type GcsPwaConfig = {
  /** Numele aplicației instalate (gol = numele site-ului). */
  name: string;
  /** Numele scurt, sub iconiță (cel mult 12 caractere; gol = din nume). */
  shortName: string;
  description: string;
  /** Culoarea barei de sus a aplicației și a fundalului la pornire. */
  themeColor: string;
  backgroundColor: string;
  /** Cum se deschide: ca aplicație, cu bara minimă a browserului sau în browser. */
  display: "standalone" | "minimal-ui" | "browser";
  /** Pagina de pornire (o adresă din site). */
  startUrl: string;
  /** Iconița încărcată (`/files/<id>`, PNG 512 × 512); goală = iconița GCS. */
  icon: string;
};

export const DEFAULT_PWA: GcsPwaConfig = { name: "", shortName: "", description: "", themeColor: "#0b0f17", backgroundColor: "#0b0f17", display: "standalone", startUrl: "/", icon: "" };

const COLOR = /^#[0-9a-f]{6}$/i;

export function pwaConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsPwaConfig>;
  if (typeof c.name !== "string" || c.name.length > 60 || typeof c.shortName !== "string" || c.shortName.length > 12 || typeof c.description !== "string" || c.description.length > 300) return "too_long";
  if (typeof c.themeColor !== "string" || !COLOR.test(c.themeColor) || typeof c.backgroundColor !== "string" || !COLOR.test(c.backgroundColor)) return "invalid";
  if (c.display !== "standalone" && c.display !== "minimal-ui" && c.display !== "browser") return "invalid_choice";
  if (typeof c.startUrl !== "string" || !/^\/(?!\/)[^\s]{0,200}$/.test(c.startUrl)) return "invalid_url";
  if (typeof c.icon !== "string" || (c.icon !== "" && !/^\/files\/[A-Za-z0-9_-]{1,40}$/.test(c.icon))) return "invalid_url";
  return null;
}

export const pwaSetting: GcsSettingDef = { key: PWA_SETTING, type: "json", default: DEFAULT_PWA, section: "pwa", labelKey: "settings.pwa.config", validate: pwaConfigError };

export async function loadPwaConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsPwaConfig> {
  const v = await settings.get<GcsPwaConfig | null>(PWA_SETTING).catch(() => null);
  return v && pwaConfigError(v) === null ? v : DEFAULT_PWA;
}
