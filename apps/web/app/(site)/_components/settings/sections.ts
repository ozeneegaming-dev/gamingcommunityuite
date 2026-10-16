/**
 * Secțiunile setărilor contului, cu iconițele lor (meniul din stânga și titlul fiecărei pagini folosesc aceeași iconiță).
 * Setările contului v2: Prezentare generală, Email, Securitate, Dispozitive, Vizualizarea conținutului, Semnătură, Steam,
 * Discord, Google, Aplicații autorizate și Chat, apoi restul secțiunilor de până acum.
 */
export const SETTINGS_SECTIONS = [
  ["overview", "fa-solid fa-house-user"],
  ["profile", "fa-solid fa-user"],
  ["email", "fa-solid fa-envelope"],
  ["security", "fa-solid fa-shield-halved"],
  ["devices", "fa-solid fa-laptop"],
  ["content", "fa-solid fa-book-open"],
  ["signature", "fa-solid fa-signature"],
  ["steam", "fa-brands fa-steam"],
  ["discord", "fa-brands fa-discord"],
  ["google", "fa-brands fa-google"],
  ["apps", "fa-solid fa-plug-circle-check"],
  ["chat", "fa-solid fa-comments"],
  ["privacy", "fa-solid fa-user-shield"],
  ["notifications", "fa-solid fa-bell"],
  ["appearance", "fa-solid fa-palette"],
  ["language", "fa-solid fa-language"],
  ["ignored", "fa-solid fa-user-slash"],
  ["following", "fa-solid fa-eye"],
  ["attachments", "fa-solid fa-paperclip"],
  ["account", "fa-solid fa-gear"],
] as const;

export type GcsSettingsSection = (typeof SETTINGS_SECTIONS)[number][0];

/** Iconița unei secțiuni (pentru `<GcsIcon name=… />`). */
export const SETTINGS_ICONS = Object.fromEntries(SETTINGS_SECTIONS) as Record<GcsSettingsSection, string>;

/** Conturile legate (Steam / Discord / Google) au pagina lor sub `/settings/connections/…`. */
export const CONNECTION_SECTIONS = new Set<GcsSettingsSection>(["steam", "discord", "google"]);

/** Adresa unei secțiuni. */
export function settingsHref(section: GcsSettingsSection): string {
  if (section === "overview") return "/settings";
  if (CONNECTION_SECTIONS.has(section)) return `/settings/connections/${section}`;
  return `/settings/${section}`;
}
