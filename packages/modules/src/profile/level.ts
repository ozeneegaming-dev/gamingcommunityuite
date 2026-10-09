/**
 * Nivelul unui membru (inelul de XP din antet, cardul de rang din meniul contului; specul 2026-10-10-hero-cockpit §1,
 * §3): nivelul = locul rangului actual în scara rangurilor (1 = primul după poziție), progresul = cât mai e până la
 * rangul următor, pe pragul lui (XP, apoi postări, apoi reputație). Fără ranguri definite: nivelul 0, fără progres.
 */

export type GcsLadderRank = { id: number; name: string; position: number; minPosts: number | null; minPoints: number | null; minReputation: number | null };
export type GcsLevelStats = { rankId: number | null; points: number; postsCount: number; reputation: number };
export type GcsLevelUnit = "xp" | "posts" | "reputation";

export type GcsLevelProgress = {
  /** Nivelul actual (0 = fără rang). */
  level: number;
  rank: string | null;
  /** Rangul următor și pragul lui; `null` = ultimul rang (sau fără ranguri). */
  next: { level: number; name: string; unit: GcsLevelUnit; have: number; need: number; remaining: number } | null;
  /** Progresul spre rangul următor (0–100; 100 la ultimul rang). */
  percent: number;
  xp: number;
};

const order = (a: GcsLadderRank, b: GcsLadderRank) => a.position - b.position || a.id - b.id;

/** Pragul care contează la un rang: XP, apoi postările, apoi reputația (primul completat). */
function threshold(r: GcsLadderRank): { unit: GcsLevelUnit; min: number } | null {
  if (r.minPoints !== null) return { unit: "xp", min: r.minPoints };
  if (r.minPosts !== null) return { unit: "posts", min: r.minPosts };
  if (r.minReputation !== null) return { unit: "reputation", min: r.minReputation };
  return null;
}

const valueOf = (s: GcsLevelStats, unit: GcsLevelUnit) => (unit === "xp" ? s.points : unit === "posts" ? s.postsCount : s.reputation);

export function levelProgress(stats: GcsLevelStats, ladder: readonly GcsLadderRank[]): GcsLevelProgress {
  const sorted = [...ladder].sort(order);
  const index = stats.rankId === null ? -1 : sorted.findIndex((r) => r.id === stats.rankId);
  const current = index >= 0 ? sorted[index]! : null;
  const nextRank = sorted[index + 1] ?? null;
  const base = { level: index + 1, rank: current?.name ?? null, xp: stats.points };
  if (!nextRank) return { ...base, next: null, percent: current ? 100 : 0 };
  const t = threshold(nextRank);
  if (!t) return { ...base, next: { level: index + 2, name: nextRank.name, unit: "xp", have: stats.points, need: 0, remaining: 0 }, percent: 100 };
  const have = valueOf(stats, t.unit);
  // Pragul de pornire: al rangului actual, pe aceeași unitate (dacă îl are), altfel 0.
  const own = current ? threshold(current) : null;
  const floor = own && own.unit === t.unit ? Math.min(own.min, t.min) : 0;
  const span = Math.max(1, t.min - floor);
  const percent = Math.max(0, Math.min(100, Math.floor(((have - floor) / span) * 100)));
  return { ...base, next: { level: index + 2, name: nextRank.name, unit: t.unit, have, need: t.min, remaining: Math.max(0, t.min - have) }, percent };
}
