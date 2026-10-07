/**
 * Textele venite de la serverele de joc (numele serverului, harta, versiunea, MOTD-ul, numele jucătorilor) sunt date
 * neîncredere (specul 2026-10-07-servere §10): se curăță aici și se afișează doar ca text, niciodată ca HTML.
 */

/** Codurile de format Minecraft: `§` + un caracter (culoare, stil, `§x` hex scris ca șase perechi). */
const MINECRAFT_CODES = /§./gsu;
/** Spațiile albe de orice fel (rânduri noi, taburi, separatoare Unicode) devin un spațiu. */
const WHITESPACE = /[\s\p{Zl}\p{Zp}]+/gu;
/**
 * Ce nu se vede sau păcălește afișarea: caracterele de control (`\x01`–`\x1F`: codurile de culoare ale chat-ului
 * Source/GoldSrc), cele de format (spațiul de lățime zero, direcția bidi, BOM-ul), zona privată și surogații singuri.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu;

/** Textul curățat și tăiat la `max` caractere (puncte de cod, nu octeți). O valoare care nu e text → șir gol. */
export function cleanGameText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Rândurile noi și taburile devin spații înainte ca restul caracterelor de control să dispară.
  const clean = value
    .replace(MINECRAFT_CODES, "")
    .replace(/§/g, "")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(INVISIBLE, "")
    .replace(WHITESPACE, " ")
    .trim();
  const chars = [...clean];
  return (chars.length > max ? chars.slice(0, max).join("") : clean).trim();
}

const MAX_DEPTH = 20;
const MAX_CHAT_TEXT = 1024;

/**
 * Textul unei componente de chat Minecraft (descrierea din răspunsul JSON): `text` + `extra`, recursiv, cu adâncimea și
 * lungimea limitate. Codurile `§` rămân (le scoate `cleanGameText`).
 */
export function chatComponentText(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return "";
  if (typeof value === "string") return value.slice(0, MAX_CHAT_TEXT);
  if (Array.isArray(value)) return value.map((v) => chatComponentText(v, depth + 1)).join("").slice(0, MAX_CHAT_TEXT);
  if (!value || typeof value !== "object") return "";
  const obj = value as { text?: unknown; extra?: unknown };
  const own = typeof obj.text === "string" ? obj.text : "";
  const extra = Array.isArray(obj.extra) ? obj.extra.map((v) => chatComponentText(v, depth + 1)).join("") : "";
  return (own + extra).slice(0, MAX_CHAT_TEXT);
}
