/**
 * Comutatorul întunecat / luminos (specul system-ui, 2026-10-16): luna / soarele din antet (și din meniul contului și
 * din subsol) trece între DOUĂ TEME, nu între modurile aceleiași teme. Perechea se alege în ACP → Aspect → Teme
 * („Comutator întunecat/luminos”), implicit GCS Dark ↔ GCS White; orice temă (proprie sau importată) poate fi pusă în
 * pereche. Cu perechea oprită sau incompletă (o temă lipsă, inactivă sau aceeași de două ori), comutatorul dispare.
 * Modul e pur (fără Node): îl folosesc serverul, antetul și formularul din ACP.
 */

/** Setarea perechii (`settings`), editată în ACP → Aspect → Teme. */
export const THEME_TOGGLE_SETTING = "themes.toggle";

export type GcsThemeTogglePair = {
  /** Comutatorul e pornit. */
  enabled: boolean;
  /** Cheia temei întunecate (luna). */
  dark: string;
  /** Cheia temei luminoase (soarele). */
  light: string;
};

export const DEFAULT_THEME_TOGGLE: GcsThemeTogglePair = { enabled: true, dark: "gcs-dark", light: "gcs-white" };

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** Codul erorii pentru valoarea setării (`null` = validă). */
export function themeTogglePairError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "invalid_type";
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "dark,enabled,light") return "invalid";
  if (typeof o.enabled !== "boolean") return "invalid_type";
  if (typeof o.dark !== "string" || typeof o.light !== "string" || !KEY_RE.test(o.dark) || !KEY_RE.test(o.light)) return "invalid";
  if (o.dark === o.light) return "same_theme";
  return null;
}

/** Valoarea salvată, sau perechea implicită când lipsește / e stricată. */
export function normalizeThemeTogglePair(raw: unknown): GcsThemeTogglePair {
  return themeTogglePairError(raw) === null ? { ...(raw as GcsThemeTogglePair) } : { ...DEFAULT_THEME_TOGGLE };
}

/**
 * Perechea folosită de site: ambele teme există și sunt active, diferite, comutatorul e pornit; altfel `null` (comutatorul
 * se ascunde).
 */
export function activeThemeTogglePair(pair: GcsThemeTogglePair, themes: readonly { key: string; enabled: boolean }[]): { dark: string; light: string } | null {
  if (!pair.enabled || pair.dark === pair.light) return null;
  const ok = (k: string) => themes.some((t) => t.key === k && t.enabled);
  return ok(pair.dark) && ok(pair.light) ? { dark: pair.dark, light: pair.light } : null;
}

/**
 * Starea comutatorului pentru tema afișată: pe tema luminoasă a perechii arată luna (→ tema întunecată), pe cea
 * întunecată soarele (→ tema luminoasă); pe o temă din afara perechii, după modul afișat (luminos → luna).
 */
export function themeToggleState(pair: { dark: string; light: string }, current: string, mode: "dark" | "light"): { side: "dark" | "light"; target: string } {
  const side = current === pair.light ? "light" : current === pair.dark ? "dark" : mode;
  return { side, target: side === "light" ? pair.dark : pair.light };
}
