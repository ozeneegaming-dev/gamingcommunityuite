/**
 * ELO-ul meciurilor mix (specul 2026-10-08-servere-bridge §10.1): ELO standard pe echipe, cu un mic factor de
 * performanță din damage. Funcții pure, verificate de testele „golden” din §10.2.
 */

export type GcsEloConfig = {
  /** K pentru jucătorii cu experiență (`servers.elo_k`). */
  k: number;
  /** K pentru jucătorii provizorii (`servers.elo_k_new`). */
  kNew: number;
  /** Sub câte meciuri e un jucător provizoriu (`servers.elo_provisional`). */
  provisional: number;
  /** P: ponderea performanței, 0–0.5 (`servers.elo_performance` / 100). */
  performance: number;
};

export type GcsEloPlayer = { id: number; team: "A" | "B"; elo: number; matches: number; damage: number };
export type GcsEloChange = { before: number; after: number; delta: number };

/** ELO-ul minim. */
export const ELO_FLOOR = 100;

/** Scorul așteptat al unei echipe cu media `own` contra uneia cu media `other`. */
export function expectedScore(own: number, other: number): number {
  return 1 / (1 + 10 ** ((other - own) / 400));
}

/** Rotunjirea simetrică (jumătatea departe de zero): câștigul și pierderea egale au același modul (12.5 → ±13). */
const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const average = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Schimbările de ELO ale unui meci încheiat (`winner` = `A`, `B` sau `DRAW`). Pentru fiecare jucător:
 * `Δ = round(K × (S − E) × f)` la câștig și `round(K × (S − E) × (2 − f))` la pierdere, cu
 * `f = 1 + P × clamp(damage / media echipei − 1, −1, 1)`; ELO-ul nou e cel puțin 100.
 */
export function rateMatch(players: GcsEloPlayer[], winner: "A" | "B" | "DRAW", cfg: GcsEloConfig): Map<number, GcsEloChange> {
  const team = (t: "A" | "B") => players.filter((p) => p.team === t);
  const avgElo = { A: average(team("A").map((p) => p.elo)), B: average(team("B").map((p) => p.elo)) };
  const avgDamage = { A: average(team("A").map((p) => p.damage)), B: average(team("B").map((p) => p.damage)) };
  const out = new Map<number, GcsEloChange>();
  for (const p of players) {
    const other = p.team === "A" ? "B" : "A";
    const expected = expectedScore(avgElo[p.team], avgElo[other]);
    const score = winner === "DRAW" ? 0.5 : winner === p.team ? 1 : 0;
    const k = p.matches < cfg.provisional ? cfg.kNew : cfg.k;
    const contribution = avgDamage[p.team] > 0 ? p.damage / avgDamage[p.team] : 1;
    const f = 1 + cfg.performance * clamp(contribution - 1, -1, 1);
    const diff = score - expected;
    const delta = roundHalfAway(k * diff * (diff >= 0 ? f : 2 - f));
    const after = Math.max(ELO_FLOOR, p.elo + delta);
    out.set(p.id, { before: p.elo, after, delta: after - p.elo });
  }
  return out;
}
