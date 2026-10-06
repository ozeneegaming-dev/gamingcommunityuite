/** Secțiunile setărilor contului, cu iconițele lor (meniul din stânga și titlul fiecărei pagini folosesc aceeași iconiță). */
export const SETTINGS_SECTIONS = [
  ["profile", "fa-solid fa-user"],
  ["appearance", "fa-solid fa-palette"],
  ["language", "fa-solid fa-language"],
  ["signature", "fa-solid fa-signature"],
  ["privacy", "fa-solid fa-user-shield"],
  ["notifications", "fa-solid fa-bell"],
  ["security", "fa-solid fa-shield-halved"],
  ["ignored", "fa-solid fa-user-slash"],
  ["account", "fa-solid fa-gear"],
] as const;

export type GcsSettingsSection = (typeof SETTINGS_SECTIONS)[number][0];

/** Iconița unei secțiuni (pentru `<GcsIcon name=… />`). */
export const SETTINGS_ICONS = Object.fromEntries(SETTINGS_SECTIONS) as Record<GcsSettingsSection, string>;
