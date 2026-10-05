import type { GcsCache } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/**
 * Afișarea unui user, la fel peste tot (topic, liste, card, profil, mesaje, ACP): numele cu clasa stilului
 * (stilul ales `ns_*` sau grupul principal), avatarul cu rama și rangul.
 */
export const userDisplaySelect = {
  id: true,
  name: true,
  image: true,
  rankId: true,
  primaryGroupId: true,
  primaryGroup: { select: { key: true, name: true, title: true, color: true } },
  nameStyle: { select: { key: true } },
  avatarFrame: { select: { key: true } },
} as const;

export type GcsUserDisplayRow = {
  id: string;
  name: string;
  image: string | null;
  rankId: number | null;
  primaryGroupId: number;
  primaryGroup: { key: string; name: string; title: string | null; color: string | null };
  nameStyle: { key: string } | null;
  avatarFrame: { key: string } | null;
};

export type GcsRankLabel = { name: string; icon: string | null };

export type GcsUserDisplay = {
  id: string;
  name: string;
  image: string | null;
  /** Clasa numelui: `gcs-name--{nameKey}`. */
  nameKey: string;
  /** Rama: `gcs-avatarFrame--{frameKey}`; `null` = fără ramă. */
  frameKey: string | null;
  groupKey: string;
  group: { name: string; color: string | null };
  rank: GcsRankLabel | null;
};

/** Ce aduce cache-ul de ranguri: rangurile și textul care le înlocuiește pe grupuri (ex. „Staff”). */
export type GcsRankData = { ranks: Record<string, GcsRankLabel>; overrides: Record<string, string> };

const RANKS_KEY = "profile:ranks";

/** Rangurile și înlocuirile pe grupuri, cache-uite (invalidate de editarea rangurilor sau a setărilor de grup). */
export class GcsRankDirectory {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache }) {}

  async data(): Promise<GcsRankData> {
    const cached = await this.deps.cache.get<GcsRankData>(RANKS_KEY);
    if (cached) return cached;
    const [ranks, overrides] = await Promise.all([
      this.deps.db.rank.findMany({ select: { id: true, name: true, icon: true } }),
      this.deps.db.groupSetting.findMany({ where: { key: "profile.rank_override" }, select: { groupId: true, value: true } }),
    ]);
    const data: GcsRankData = {
      ranks: Object.fromEntries(ranks.map((r) => [String(r.id), { name: r.name, icon: r.icon }])),
      overrides: Object.fromEntries(
        overrides.filter((o) => typeof o.value === "string" && o.value.trim() !== "").map((o) => [String(o.groupId), (o.value as string).trim()]),
      ),
    };
    // `name-styles` e invalidat de orice schimbare de grup (inclusiv setările lui).
    await this.deps.cache.set(RANKS_KEY, data, { ttlSec: 3600, tags: ["ranks", "name-styles"] });
    return data;
  }
}

/** Rangul afișat: textul grupului (ex. „Staff”), altfel rangul obținut. */
export function rankLabel(data: GcsRankData, rankId: number | null, primaryGroupId: number): GcsRankLabel | null {
  const override = data.overrides[String(primaryGroupId)];
  if (override) return { name: override, icon: null };
  return rankId === null ? null : (data.ranks[String(rankId)] ?? null);
}

export function toUserDisplay(row: GcsUserDisplayRow, ranks: GcsRankData): GcsUserDisplay {
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    nameKey: row.nameStyle?.key ?? row.primaryGroup.key,
    frameKey: row.avatarFrame?.key ?? null,
    groupKey: row.primaryGroup.key,
    group: { name: row.primaryGroup.title ?? row.primaryGroup.name, color: row.primaryGroup.color },
    rank: rankLabel(ranks, row.rankId, row.primaryGroupId),
  };
}
