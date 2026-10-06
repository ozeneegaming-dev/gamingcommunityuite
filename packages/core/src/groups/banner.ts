const HEX = "#[0-9a-fA-F]{6}";
const BANNER = new RegExp(String.raw`^(?:${HEX}|linear-gradient\((?:\d{1,3}deg, )?${HEX}(?: \d{1,3}%)?, ${HEX}(?: \d{1,3}%)?\))$`);

/**
 * Banner-ul unui grup în postbit (etapa 5): o culoare `#RRGGBB` sau un gradient liniar simplu între două culori
 * (`linear-gradient(135deg, #D62839, #8B0F1C)`). Orice altceva e refuzat (ajunge într-un atribut `style`).
 */
export function isSafeBanner(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && BANNER.test(value);
}
