/**
 * Flag-urile adminilor (specul 2026-10-08-servere-bridge §7.2): sursa de adevăr sunt literele AMX Mod X (`a`–`v`, `z`,
 * ca în `users.ini`); pentru CS2 (CounterStrikeSharp) se traduc în permisiuni `@css/*` și `@gcs/*`. Fără dependențe de
 * Node: le folosesc și formularele din ACP.
 */

/** Literele permise, în ordinea afișării. */
export const GCS_ADMIN_FLAGS = "abcdefghijklmnopqrstuvz";
/** Toate literele de admin (fără `z`, „utilizator”): cine le are pe toate primește și `@css/root`. */
const ADMIN_LETTERS = "abcdefghijklmnopqrstuv";

/** Ce înseamnă fiecare literă (cheile de traducere `acp.serverAdmins.flags.<literă>`). */
export const FLAG_CSS: Record<string, string[]> = {
  b: ["@css/reservation"],
  c: ["@css/kick"],
  d: ["@css/ban", "@css/unban"],
  e: ["@css/slay"],
  f: ["@css/changemap"],
  g: ["@css/cvar"],
  h: ["@css/config"],
  i: ["@css/chat"],
  j: ["@css/vote"],
  k: ["@css/password"],
  l: ["@css/rcon"],
  m: ["@gcs/custom_a"],
  n: ["@gcs/custom_b"],
  o: ["@gcs/custom_c"],
  p: ["@gcs/custom_d"],
  q: ["@gcs/custom_e"],
  r: ["@gcs/custom_f"],
  s: ["@gcs/custom_g"],
  t: ["@gcs/custom_h"],
  u: ["@css/generic"],
  v: ["@gcs/tempban"],
};

/** Literele valide, fără dubluri, în ordinea alfabetului; orice alt caracter dispare. */
export function normalizeFlags(value: unknown): string {
  if (typeof value !== "string") return "";
  const set = new Set(value.toLowerCase());
  return [...GCS_ADMIN_FLAGS].filter((c) => set.has(c)).join("");
}

export function hasFlag(flags: string, flag: string): boolean {
  return flags.includes(flag);
}

/** Permisiunile CounterStrikeSharp ale literelor (în ordinea literelor), plus `@css/root` pentru toate literele de admin. */
export function cssPermissions(flags: string): string[] {
  const normalized = normalizeFlags(flags);
  const out = [...normalized].flatMap((c) => FLAG_CSS[c] ?? []);
  if ([...ADMIN_LETTERS].every((c) => normalized.includes(c))) out.push("@css/root");
  return out;
}

/** Imunitatea efectivă (0–100): a intrării, altfel a presetului; `a` fără imunitate explicită → 100. */
export function effectiveImmunity(opts: { immunity: number | null; presetImmunity: number | null; flags: string }): number {
  if (opts.immunity !== null) return opts.immunity;
  if (opts.presetImmunity !== null) return opts.presetImmunity;
  return opts.flags.includes("a") ? 100 : 0;
}

export type GcsFlagGrant = { flags: string; immunity: number; expiresAt: Date | null };

/** Mai multe intrări pentru aceeași identitate: reuniunea flag-urilor, imunitatea maximă, expirarea cea mai târzie. */
export function mergeGrants(list: GcsFlagGrant[]): GcsFlagGrant {
  const never = list.some((g) => g.expiresAt === null);
  const latest = list.reduce<Date | null>((max, g) => (g.expiresAt && (!max || g.expiresAt > max) ? g.expiresAt : max), null);
  return {
    flags: normalizeFlags(list.map((g) => g.flags).join("")),
    immunity: Math.max(0, ...list.map((g) => g.immunity)),
    expiresAt: never ? null : latest,
  };
}
