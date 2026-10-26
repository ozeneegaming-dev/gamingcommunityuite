import type { GcsActor, GcsCache } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { pickRank } from "./achievements";
import { levelProgress, type GcsLevelProgress } from "./level";
import { normalizeMemberPrefs } from "./memberPrefs";
import { normalizePrivacy } from "./privacy";
import type { GcsBadgeView, GcsProfileQueries } from "./queries";

/**
 * Coloana profilului public v2 (profil gaming v2 §2): caseta realizărilor (reputația și numele nivelului, locul n/N,
 * ultimele insigne, insigna automată „Sponsor” din donații peste prag), urmăritorii, vizitatorii recenți (cu opțiunea de
 * confidențialitate). Donațiile sunt ale aplicației VIP clasic (`GcsDonationService`): caseta primește doar insigna.
 */

/** Pragul insignei „Sponsor” (unități întregi ale monedei principale; 0 = oprită), editat în Donații › Setări. */
export const SPONSOR_MIN_SETTING = "profile.sponsor_min_amount";
const VISIT_THROTTLE_SEC = 600;
const VISITORS_SHOWN = 8;

export type GcsAchievementsBox = {
  reputation: number;
  level: GcsLevelProgress;
  /** Locul membrului după reputație, între membrii cu cont (nebanați). */
  rank: { position: number; total: number };
  badges: GcsBadgeView[];
  badgeCount: number;
  sponsor: boolean;
};

export type GcsVisitor = { id: string; at: string };

export class GcsProfileExtras {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      queries: Pick<GcsProfileQueries, "badgeShowcase">;
      /** Insigna automată „Sponsor” (donațiile confirmate peste pragul din setări; vezi `GcsDonationService.sponsor`). */
      sponsor: (userId: string) => Promise<{ total: number; sponsor: boolean }>;
    },
  ) {}

  /** Caseta „Realizări”; `null` = profil invizibil pentru viewer. */
  async achievements(viewer: GcsActor, userId: string): Promise<GcsAchievementsBox | null> {
    const { db } = this.deps;
    const showcase = await this.deps.queries.badgeShowcase(viewer, userId);
    if (!showcase) return null;
    const [user, ladder, sponsor] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId }, select: { reputation: true, points: true, postsCount: true, rankId: true } }),
      db.rank.findMany({ select: { id: true, name: true, position: true, minPosts: true, minPoints: true, minReputation: true } }),
      this.deps.sponsor(userId),
    ]);
    const [above, total] = await Promise.all([
      db.user.count({ where: { reputation: { gt: user.reputation }, primaryGroup: { key: { not: "banned" } }, isBot: false } }),
      db.user.count({ where: { primaryGroup: { key: { not: "banned" } }, isBot: false } }),
    ]);
    const latest = [...showcase.earned].sort((a, b) => b.awardedAt.localeCompare(a.awardedAt)).slice(0, 5);
    return {
      reputation: user.reputation,
      level: levelProgress({ ...user, rankId: user.rankId ?? pickRank(ladder, user) }, ladder),
      rank: { position: above + 1, total: Math.max(total, above + 1) },
      badges: latest,
      badgeCount: showcase.earned.length,
      sponsor: sponsor.sponsor,
    };
  }

  /**
   * Vizita unui membru pe profilul altuia: se notează (ultima vizită, o dată la 10 minute) doar dacă vizitatorul nu și-a
   * oprit „vizitele mele apar la ceilalți” și nu își ascunde prezența.
   */
  async recordVisit(viewer: GcsActor, profileUserId: string, now = new Date()): Promise<boolean> {
    if (!viewer.userId || viewer.userId === profileUserId || viewer.isBanned) return false;
    const key = `profile:visit:${profileUserId}:${viewer.userId}`;
    if (await this.deps.cache.get<boolean>(key)) return false;
    await this.deps.cache.set(key, true, { ttlSec: VISIT_THROTTLE_SEC, tags: [] });
    const me = await this.deps.db.user.findUnique({ where: { id: viewer.userId }, select: { prefs: true, privacy: true } });
    if (!me || !normalizeMemberPrefs(me.prefs).recordVisits || !normalizePrivacy(me.privacy).showOnline) return false;
    await this.deps.db.profileVisit.upsert({
      where: { profileUserId_visitorId: { profileUserId, visitorId: viewer.userId } },
      create: { profileUserId, visitorId: viewer.userId, visitedAt: now },
      update: { visitedAt: now },
    });
    return true;
  }

  /** Vizitatorii recenți (cel mai recent primul); `null` = proprietarul a ascuns caseta (o vede doar el). */
  async visitors(viewer: GcsActor, profileUserId: string): Promise<GcsVisitor[] | null> {
    const owner = await this.deps.db.user.findUnique({ where: { id: profileUserId }, select: { prefs: true } });
    if (!owner) return null;
    if (!normalizeMemberPrefs(owner.prefs).showVisitors && viewer.userId !== profileUserId) return null;
    const rows = await this.deps.db.profileVisit.findMany({ where: { profileUserId }, orderBy: { visitedAt: "desc" }, take: VISITORS_SHOWN, select: { visitorId: true, visitedAt: true } });
    return rows.map((r) => ({ id: r.visitorId, at: r.visitedAt.toISOString() }));
  }
}
