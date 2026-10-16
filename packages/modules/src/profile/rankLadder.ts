import type { GcsAchievementEventDef, GcsModuleRegistry } from "@gcs/core";
import type { Prisma, PrismaClient, Rank } from "@gcs/db";
import type { GcsBadgeArtFields } from "@gcs/ui/badge-art";
import type { GcsMembership } from "./membership";

/**
 * Rangurile moderne (Realizări v2): scara de carduri cu embleme pe trepte, pragurile (postări, puncte, reputație și
 * criteriile aplicațiilor, ex. orele jucate) combinate „toate” sau „oricare”, și avantajele rangului.
 */

export const RANK_TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "master", "legend"] as const;
export type GcsRankTier = (typeof RANK_TIERS)[number];
export const isRankTier = (v: unknown): v is GcsRankTier => typeof v === "string" && (RANK_TIERS as readonly string[]).includes(v);

/** Treptele de deasupra metalelor se desenează cu forma și culoarea lor (insigna „custom”). */
const TIER_ART: Record<GcsRankTier, { tier: string; shape: string; color: string }> = {
  bronze: { tier: "bronze", shape: "shield", color: "#B86B35" },
  silver: { tier: "silver", shape: "shield", color: "#A7B1BF" },
  gold: { tier: "gold", shape: "shield", color: "#E0A526" },
  platinum: { tier: "platinum", shape: "hexagon", color: "#A9CFE6" },
  diamond: { tier: "custom", shape: "diamond", color: "#5AC8FA" },
  master: { tier: "custom", shape: "star", color: "#A66BFF" },
  legend: { tier: "custom", shape: "rosette", color: "#FF5A5F" },
};

export type GcsRankEmblemFields = Pick<Rank, "name" | "icon" | "emblemTier" | "emblemShape" | "emblemIcon" | "color">;

/** Câmpurile insignei rangului (desenată cu sistemul de insigne): treapta dă metalul, forma și culoarea implicite. */
export function rankEmblemArt(rank: GcsRankEmblemFields, position = 0): GcsBadgeArtFields {
  const tier: GcsRankTier = isRankTier(rank.emblemTier) ? rank.emblemTier : RANK_TIERS[Math.min(RANK_TIERS.length - 1, Math.max(0, position))]!;
  const art = TIER_ART[tier];
  const icon = rank.emblemIcon ?? (rank.icon?.startsWith("fa-") ? rank.icon : null);
  return {
    name: rank.name,
    color: rank.color && /^#[0-9A-Fa-f]{6}$/.test(rank.color) ? rank.color : art.color,
    artShape: rank.emblemShape ?? art.shape,
    artTier: art.tier,
    artIcon: icon ?? "fa-solid fa-chevron-up",
    symbol: null,
    manual: false,
  };
}

export type GcsRankCriterion = { metric: string; min: number };
export type GcsRankMatch = "all" | "any";

export function normalizeCriteria(raw: unknown): GcsRankCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: GcsRankCriterion[] = [];
  for (const c of raw.slice(0, 10)) {
    const r = c as Record<string, unknown>;
    if (typeof r?.metric === "string" && /^[a-z0-9_.]{1,60}$/.test(r.metric) && Number.isInteger(r.min) && (r.min as number) >= 0 && (r.min as number) <= 10_000_000 && !out.some((o) => o.metric === r.metric)) {
      out.push({ metric: r.metric, min: r.min as number });
    }
  }
  return out;
}

export type GcsRankStats = { postsCount: number; points: number; reputation: number; metrics?: Record<string, number> };
export type GcsLadderRankV2 = Pick<Rank, "id" | "position" | "minPosts" | "minPoints" | "minReputation"> & Partial<Pick<Rank, "match" | "criteria">>;

/**
 * Dacă membrul are pragurile rangului: postări / puncte / reputație (cele completate) și criteriile aplicațiilor
 * disponibile (un criteriu al unei aplicații oprite nu contează), toate (`all`) sau măcar unul (`any`). Un rang fără
 * praguri e rangul de bază (îl are oricine).
 */
export function rankQualifies(rank: GcsLadderRankV2, s: GcsRankStats): boolean {
  const checks: boolean[] = [];
  if (rank.minPosts !== null) checks.push(s.postsCount >= rank.minPosts);
  if (rank.minPoints !== null) checks.push(s.points >= rank.minPoints);
  if (rank.minReputation !== null) checks.push(s.reputation >= rank.minReputation);
  for (const c of normalizeCriteria(rank.criteria)) {
    if (s.metrics && c.metric in s.metrics) checks.push(s.metrics[c.metric]! >= c.min);
  }
  if (checks.length === 0) return true;
  return rank.match === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

/** Metricile folosite de criteriile rangurilor (cheile unice). */
export const usedMetrics = (ranks: Pick<Rank, "criteria">[]) => [...new Set(ranks.flatMap((r) => normalizeCriteria(r.criteria).map((c) => c.metric)))];

/**
 * Valorile metricilor unui membru (evenimentele „valoare” cu `rankMetric`, doar ale aplicațiilor pornite). O metrică a
 * unei aplicații oprite lipsește din rezultat (criteriul ei se ignoră).
 */
export async function rankMetrics(deps: { db: PrismaClient; registry: GcsModuleRegistry; enabled: (key: string) => boolean }, userId: string, keys: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (keys.length === 0) return out;
  const defs = new Map<string, GcsAchievementEventDef>(deps.registry.achievementEvents().filter((e) => e.def.rankMetric && e.def.current && deps.enabled(e.module)).map((e) => [e.def.key, e.def]));
  for (const key of keys) {
    const def = defs.get(key);
    if (def) out[key] = await def.current!({ db: deps.db }, userId, { forumIds: [], serverIds: [] });
  }
  return out;
}

/** Sursa grupurilor secundare date de un rang (Membri v2: apare în ACP). */
export const RANK_PERK_SOURCE = "rank";
export const rankBadgeReason = (rankId: number) => `rank:${rankId}`;

type PerkRank = Pick<Rank, "id" | "perkGroupId" | "perkBadgeId" | "perkNameStyleId">;

/**
 * Avantajele la schimbarea rangului: ale rangului vechi se retrag (grupul dat de rang, badge-ul dat de rang, stilul
 * numelui dacă e încă cel al rangului), ale celui nou se dau. Întoarce grupurile schimbate și badge-ul nou.
 */
export async function applyRankPerks(tx: Prisma.TransactionClient, membership: GcsMembership, userId: string, previous: PerkRank | null, next: PerkRank | null): Promise<{ groups: number[]; badgeId: number | null; revokedBadgeId: number | null }> {
  const groups: number[] = [];
  let badgeId: number | null = null;
  let revokedBadgeId: number | null = null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { nameStyleId: true } });
  if (!user) return { groups, badgeId, revokedBadgeId };
  if (previous) {
    if (previous.perkGroupId !== null && previous.perkGroupId !== next?.perkGroupId) {
      const { count } = await tx.userGroup.deleteMany({ where: { userId, groupId: previous.perkGroupId, source: RANK_PERK_SOURCE } });
      if (count > 0) groups.push(previous.perkGroupId);
    }
    if (previous.perkBadgeId !== null && previous.perkBadgeId !== next?.perkBadgeId) {
      const { count } = await tx.userBadge.deleteMany({ where: { userId, badgeId: previous.perkBadgeId, reason: rankBadgeReason(previous.id), awardedById: null } });
      if (count > 0) revokedBadgeId = previous.perkBadgeId;
    }
    if (previous.perkNameStyleId !== null && user.nameStyleId === previous.perkNameStyleId && previous.perkNameStyleId !== next?.perkNameStyleId) {
      await tx.user.update({ where: { id: userId }, data: { nameStyleId: null } });
      user.nameStyleId = null;
    }
  }
  if (next) {
    if (next.perkGroupId !== null && (await membership.addSecondary(tx, userId, next.perkGroupId, { source: RANK_PERK_SOURCE }))) groups.push(next.perkGroupId);
    if (next.perkBadgeId !== null) {
      const { count } = await tx.userBadge.createMany({ data: [{ userId, badgeId: next.perkBadgeId, reason: rankBadgeReason(next.id) }], skipDuplicates: true });
      if (count > 0) badgeId = next.perkBadgeId;
    }
    if (next.perkNameStyleId !== null && user.nameStyleId === null) await tx.user.update({ where: { id: userId }, data: { nameStyleId: next.perkNameStyleId } });
  }
  return { groups, badgeId, revokedBadgeId };
}

export type GcsRankPreset = { key: string; ranks: { name: string; tier: GcsRankTier; icon: string; minPosts?: number; minPoints?: number; minReputation?: number; criteria?: GcsRankCriterion[]; match?: GcsRankMatch; animated?: boolean }[] };

/** Scările gata făcute (ACP → Ranguri → Scări prestabilite). Numele sunt implicite (editabile după import). */
export const RANK_PRESETS: GcsRankPreset[] = [
  {
    key: "community",
    ranks: [
      { name: "Recrut", tier: "bronze", icon: "fa-solid fa-seedling", minPoints: 0 },
      { name: "Membru activ", tier: "silver", icon: "fa-solid fa-comments", minPoints: 100 },
      { name: "Veteran", tier: "gold", icon: "fa-solid fa-medal", minPoints: 500 },
      { name: "Elită", tier: "platinum", icon: "fa-solid fa-gem", minPoints: 1500 },
      { name: "Maestru", tier: "master", icon: "fa-solid fa-crown", minPoints: 4000, animated: true },
      { name: "Legendă", tier: "legend", icon: "fa-solid fa-dragon", minPoints: 10000, animated: true },
    ],
  },
  {
    key: "gaming",
    ranks: [
      { name: "Rookie", tier: "bronze", icon: "fa-solid fa-gamepad", minPoints: 0 },
      { name: "Soldat", tier: "silver", icon: "fa-solid fa-crosshairs", minPoints: 150, criteria: [{ metric: "servers.hours", min: 10 }], match: "any" },
      { name: "Sergent", tier: "gold", icon: "fa-solid fa-shield-halved", minPoints: 600, criteria: [{ metric: "servers.hours", min: 50 }], match: "any" },
      { name: "Căpitan", tier: "platinum", icon: "fa-solid fa-star", minPoints: 1500, criteria: [{ metric: "servers.elo", min: 1500 }], match: "any" },
      { name: "Diamant", tier: "diamond", icon: "fa-solid fa-gem", minPoints: 3500, criteria: [{ metric: "servers.elo", min: 1800 }], match: "any", animated: true },
      { name: "Legendă", tier: "legend", icon: "fa-solid fa-dragon", minPoints: 8000, criteria: [{ metric: "servers.mix_wins", min: 200 }], match: "any", animated: true },
    ],
  },
  {
    key: "veteran",
    ranks: [
      { name: "Nou venit", tier: "bronze", icon: "fa-solid fa-user", minPosts: 0 },
      { name: "Obișnuit", tier: "silver", icon: "fa-solid fa-mug-hot", minPosts: 25, criteria: [{ metric: "core.member_days", min: 30 }] },
      { name: "Vechi", tier: "gold", icon: "fa-solid fa-hourglass-half", minPosts: 200, criteria: [{ metric: "core.member_days", min: 365 }] },
      { name: "Fondator", tier: "legend", icon: "fa-solid fa-landmark", minPosts: 1000, criteria: [{ metric: "core.member_days", min: 1095 }], animated: true },
    ],
  },
];
