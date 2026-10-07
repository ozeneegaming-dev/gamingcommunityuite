/**
 * Frazele sursei → textele pluginului (`lang/en.json`, `lang/ro.json`), sub `src.<cheie>`:
 * - cheile devin segmente sigure (`option.demoEnabled` → `option_demoEnabled`), unice, ≤ 60 de caractere;
 * - textul devine simplu: fără taguri HTML, cu entitățile decodate; `%s` / `%1$s` → `{p1}`; acoladele care nu sunt
 *   parametri `{nume}` dispar (ar strica mesajele ICU), la fel `<` și `>`;
 * - fișierul respectă regulile de validare ale pachetului (`langFileError`): ≤ 2000 de chei, texte ≤ 2000 de caractere.
 *   Frazele folosite (setări, permisiuni, rute, șabloane) au prioritate; restul se numără ca lăsate deoparte.
 */
import { decodeEntities } from "../text";

/** Câte fraze ale sursei intră cel mult în fișierul de limbă (restul de chei e al pluginului: nume, setări…). */
export const MAX_PHRASES = 1800;

/** Textul unei fraze, valid ca mesaj de plugin. */
export function phraseText(raw: string): string {
  let n = 0;
  const text = decodeEntities(raw.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/%(\d+)\$[sdf]/g, (_m, i: string) => `\u0001p${Number(i)}\u0002`)
    .replace(/%[sdf]/g, () => `\u0001p${++n}\u0002`)
    .replace(/\{([A-Za-z0-9_]{1,40})\}/g, "\u0001$1\u0002")
    .replace(/[{}<>]/g, "")
    .replace(/\u0001/g, "{")
    .replace(/\u0002/g, "}")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length > 2000 ? `${text.slice(0, 1999)}…` : text;
}

/** Cheia unei fraze în fișierul de limbă (segment sigur, ≤ 60 de caractere). */
export function phraseSegment(key: string): string {
  const s = key.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (s || "phrase").slice(0, 60);
}

export type GcsPhraseTable = {
  /** `src` din fișierul de limbă: segment → text. */
  entries: Record<string, string>;
  /** Cheia completă (`src.<segment>`) pentru o cheie a sursei, sau `null` dacă fraza nu e în fișier. */
  keyOf: (sourceKey: string) => string | null;
  dropped: number;
};

/** Tabelul frazelor: întâi cele folosite (`used`, în ordine), apoi restul, până la `MAX_PHRASES`. */
export function convertPhrases(phrases: Map<string, string>, used: Iterable<string>): GcsPhraseTable {
  const seen = new Set<string>();
  for (const k of used) if (phrases.has(k)) seen.add(k);
  for (const k of phrases.keys()) seen.add(k);
  const order = [...seen];
  const entries = Object.create(null) as Record<string, string>;
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const key of order.slice(0, MAX_PHRASES)) {
    const text = phraseText(phrases.get(key)!);
    if (!text) continue;
    let seg = phraseSegment(key);
    for (let n = 2; taken.has(seg.toLowerCase()); n++) seg = `${phraseSegment(key).slice(0, 56)}_${n}`;
    taken.add(seg.toLowerCase());
    entries[seg] = text;
    map.set(key, `src.${seg}`);
  }
  return { entries, keyOf: (k) => map.get(k) ?? null, dropped: Math.max(0, order.length - MAX_PHRASES) };
}
