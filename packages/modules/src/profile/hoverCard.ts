import type { GcsActor, GcsPermissionService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { pickRank } from "./achievements";
import { levelProgress, type GcsLadderRank } from "./level";
import type { GcsCardView, GcsOnline, GcsProfileQueries } from "./queries";
import { actorOf, type GcsSocialService } from "./social";

/**
 * Hover card v2 (profil gaming v2 §1): cardul de bază (`GcsProfileQueries.card`) plus nivelul și bara de XP, linia de
 * status (online / „Joacă pe <server>” / ultima vizită), cipurile aplicațiilor (tagul clanului, nivelul ELO, VIP-ul) și
 * drepturile acțiunilor noi (Ignoră). Cipurile și statusul de joc vin din contribuțiile aplicațiilor: fiecare are cheia
 * aplicației ei și nu apare când aplicația e oprită.
 */

/** Treptele ELO (cipul din card): pragurile ratingului mix al aplicației Servere (pornește de la 1000). */
export const ELO_TIERS = [
  { key: "iron", min: 0 },
  { key: "bronze", min: 800 },
  { key: "silver", min: 950 },
  { key: "gold", min: 1100 },
  { key: "platinum", min: 1250 },
  { key: "diamond", min: 1400 },
  { key: "elite", min: 1600 },
] as const;
export type GcsEloTier = (typeof ELO_TIERS)[number]["key"];

/** Treapta unui rating ELO (cea mai mare cu pragul atins). */
export function eloTier(elo: number): GcsEloTier {
  let tier: GcsEloTier = "iron";
  for (const t of ELO_TIERS) if (elo >= t.min) tier = t.key;
  return tier;
}

/** Un cip din hover card, adus de o aplicație. */
export type GcsMemberChip =
  | { kind: "clan"; tag: string; name: string; color: string | null; href: string }
  | { kind: "elo"; elo: number; tier: GcsEloTier; href: string | null }
  | { kind: "vip"; name: string; color: string | null };

export type GcsPlaying = { serverId: number; server: string; href: string };

/** Linia de status: online acum, pe un server (aplicația Servere), ultima vizită sau ascuns (confidențialitatea). */
export type GcsMemberStatus = { kind: "online" } | ({ kind: "playing" } & GcsPlaying) | { kind: "lastVisit"; at: string } | { kind: "hidden" };

/** Statusul din starea online și serverul pe care joacă (doar când prezența nu e ascunsă). */
export function memberStatus(online: GcsOnline, playing: GcsPlaying | null): GcsMemberStatus {
  if (online.hidden && !online.online && online.lastActiveAt === null) return { kind: "hidden" };
  if (playing) return { kind: "playing", ...playing };
  if (online.online) return { kind: "online" };
  return online.lastActiveAt ? { kind: "lastVisit", at: online.lastActiveAt } : { kind: "hidden" };
}

/** O contribuție a unei aplicații: cheia aplicației și încărcarea pentru un membru (`null` = nimic de arătat). */
export type GcsCardContribution<T> = { app: string; load: (viewer: GcsActor, userId: string) => Promise<T | null> };

export type GcsHoverCardV2 = GcsCardView & {
  level: { level: number; rank: string | null; percent: number; next: { level: number; name: string } | null; xp: number };
  status: GcsMemberStatus;
  chips: GcsMemberChip[];
  viewer: GcsCardView["viewer"] & { isIgnored: boolean; canIgnore: boolean };
  /** „Conținutul lui”: activitatea de pe profil. */
  contentHref: string;
  profileHref: string;
};

const CHIP_ORDER: GcsMemberChip["kind"][] = ["clan", "elo", "vip"];

export class GcsHoverCardLoader {
  private readonly chips: GcsCardContribution<GcsMemberChip>[] = [];
  private readonly playing: GcsCardContribution<GcsPlaying>[] = [];

  constructor(
    private readonly deps: {
      db: PrismaClient;
      permissions: GcsPermissionService;
      queries: Pick<GcsProfileQueries, "card">;
      social: Pick<GcsSocialService, "isIgnoring">;
      apps: { enabledFilter(): Promise<(key: string) => boolean> };
    },
  ) {}

  /** Un cip adus de o aplicație (tagul clanului, ELO-ul, VIP-ul…). */
  addChip(c: GcsCardContribution<GcsMemberChip>): void {
    this.chips.push(c);
  }

  /** Serverul pe care joacă membrul acum (aplicația Servere). */
  addPlaying(c: GcsCardContribution<GcsPlaying>): void {
    this.playing.push(c);
  }

  private async ladder(): Promise<GcsLadderRank[]> {
    return this.deps.db.rank.findMany({ select: { id: true, name: true, position: true, minPosts: true, minPoints: true, minReputation: true } });
  }

  /** Cardul v2; `null` = membrul nu există sau viewer-ul nu-i vede profilul. */
  async load(viewer: GcsActor, userId: string): Promise<GcsHoverCardV2 | null> {
    const { db, permissions, queries, social, apps } = this.deps;
    const card = await queries.card(viewer, userId);
    if (!card) return null;
    const isSelf = card.viewer.isSelf;
    const on = await apps.enabledFilter();
    const settle = async <T>(list: GcsCardContribution<T>[]): Promise<T[]> =>
      (await Promise.all(list.filter((c) => on(c.app)).map((c) => c.load(viewer, userId).catch(() => null)))).filter((v): v is Awaited<T> => v !== null) as T[];
    const target = viewer.userId && !isSelf ? await actorOf(db, userId) : null;
    // Prezența ascunsă ascunde și serverul pe care joacă.
    const showPresence = !(card.online.hidden && card.online.lastActiveAt === null);
    const [ladder, chips, playing, isIgnored, targetIsStaff] = await Promise.all([
      this.ladder(),
      settle(this.chips),
      showPresence ? settle(this.playing) : Promise.resolve([]),
      viewer.userId && !isSelf ? social.isIgnoring(viewer.userId, userId, "posts") : Promise.resolve(false),
      target ? permissions.can(target, "profile.moderate") : Promise.resolve(true),
    ]);
    const stats = { postsCount: card.stats.posts, reputation: card.stats.reputation, points: card.stats.points ?? 0 };
    const progress = levelProgress({ ...stats, rankId: card.rankId ?? pickRank(ladder, stats) }, ladder);
    const profileHref = `/members/${card.user.id}-${card.user.slug}`;
    return {
      ...card,
      level: { level: progress.level, rank: progress.rank, percent: progress.percent, next: progress.next ? { level: progress.next.level, name: progress.next.name } : null, xp: progress.xp },
      status: memberStatus(card.online, playing[0] ?? null),
      chips: [...chips].sort((a, b) => CHIP_ORDER.indexOf(a.kind) - CHIP_ORDER.indexOf(b.kind)),
      viewer: { ...card.viewer, isIgnored, canIgnore: viewer.userId !== null && !isSelf && !targetIsStaff },
      contentHref: `${profileHref}?tab=activity`,
      profileHref,
    };
  }
}
