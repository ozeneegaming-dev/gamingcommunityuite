import type { PrismaClient } from "@gcs/db";
import { sumPlayerStats, type GcsGroupGameStats, type GcsPlayerStatsAggregate, type GcsPlayerStatsProvider } from "../servers/playerStats";

/**
 * Statisticile de joc citite de clanuri din aplicația Servere (specul 2026-10-08-clanuri §15): doar citire și doar cu
 * aplicația Servere activă. Fără ea, clanurile nu arată nimic despre servere (nici secțiunea „Statistici”, nici
 * ponderile de joc din clasament, nici starea conturilor Steam).
 */
export type GcsClanGameStatsSource = {
  /** Aplicația Servere e activă? */
  enabled(): Promise<boolean>;
  forUsers: GcsPlayerStatsProvider["forUsers"];
  /** Membrii cu o identitate de joc legată (Steam sau prin cod), citiți tot prin furnizorul aplicației Servere. */
  linkedUsers?: (userIds: string[]) => Promise<Set<string>>;
};

/** Partea de joc a scorului unui clan (valorile, nu punctele). */
export type GcsClanGameParts = { playtimeHours: number; kd: number; mixWins: number; elo: number | null };

/** Valorile de joc ale unui clan din statisticile membrilor; `null` dacă niciun membru nu are statistici. */
export function clanGameParts(totals: GcsGroupGameStats | null): GcsClanGameParts | null {
  if (!totals) return null;
  return { playtimeHours: Math.round(totals.playtimeSeconds / 3600), kd: Math.round(totals.kd * 100) / 100, mixWins: totals.mixWon, elo: totals.elo === null ? null : Math.round(totals.elo) };
}

/** Statisticile membrilor fiecărui clan dat (o singură citire pentru toți membrii); clanurile fără date lipsesc. */
export async function gamePartsByClan(db: Pick<PrismaClient, "clanMember">, source: GcsClanGameStatsSource | null | undefined, clanIds: number[]): Promise<Map<number, GcsClanGameParts>> {
  const out = new Map<number, GcsClanGameParts>();
  if (!source || clanIds.length === 0 || !(await source.enabled())) return out;
  const members = await db.clanMember.findMany({ where: { clanId: { in: clanIds } }, select: { clanId: true, userId: true } });
  const stats = await source.forUsers(
    members.map((m) => m.userId),
    { scope: "all" },
  );
  const byClan = new Map<number, GcsPlayerStatsAggregate[]>();
  for (const m of members) {
    const s = stats.get(m.userId);
    if (s) byClan.set(m.clanId, [...(byClan.get(m.clanId) ?? []), s]);
  }
  for (const [clanId, list] of byClan) {
    const parts = clanGameParts(sumPlayerStats(list));
    if (parts) out.set(clanId, parts);
  }
  return out;
}

