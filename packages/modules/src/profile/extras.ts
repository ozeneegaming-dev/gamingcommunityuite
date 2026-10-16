import { GcsNotFound, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsCache, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { pickRank } from "./achievements";
import { levelProgress, type GcsLevelProgress } from "./level";
import { normalizeMemberPrefs } from "./memberPrefs";
import { normalizePrivacy } from "./privacy";
import type { GcsBadgeView, GcsProfileQueries } from "./queries";

/**
 * Coloana profilului public v2 (profil gaming v2 §2): caseta realizărilor (reputația și numele nivelului, locul n/N,
 * ultimele insigne, insigna automată „Sponsor” din donații peste prag), urmăritorii, vizitatorii recenți (cu opțiunea de
 * confidențialitate) și donațiile (înregistrate de echipă din ACP → Membri → fișa membrului).
 */

export const SPONSOR_MIN_SETTING = "profile.sponsor_min_amount";
export const DONATIONS_ACP_SECTION = "members.members";
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
      settings: GcsSettingsService;
      queries: Pick<GcsProfileQueries, "badgeShowcase">;
      acp: Pick<GcsAcpRoleService, "assert">;
    },
  ) {}

  /** Totalul donațiilor (în subunități) și dacă trece pragul insignei „Sponsor” (setarea e în unități întregi; 0 = oprit). */
  async sponsor(userId: string): Promise<{ total: number; sponsor: boolean }> {
    const [sum, min] = await Promise.all([this.deps.db.memberDonation.aggregate({ where: { userId }, _sum: { amount: true } }), this.deps.settings.get<number>(SPONSOR_MIN_SETTING)]);
    const total = sum._sum.amount ?? 0;
    return { total, sponsor: min > 0 && total >= Math.round(min * 100) };
  }

  /** Caseta „Realizări”; `null` = profil invizibil pentru viewer. */
  async achievements(viewer: GcsActor, userId: string): Promise<GcsAchievementsBox | null> {
    const { db } = this.deps;
    const showcase = await this.deps.queries.badgeShowcase(viewer, userId);
    if (!showcase) return null;
    const [user, ladder, sponsor] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId }, select: { reputation: true, points: true, postsCount: true, rankId: true } }),
      db.rank.findMany({ select: { id: true, name: true, position: true, minPosts: true, minPoints: true, minReputation: true } }),
      this.sponsor(userId),
    ]);
    const [above, total] = await Promise.all([
      db.user.count({ where: { reputation: { gt: user.reputation }, primaryGroup: { key: { not: "banned" } } } }),
      db.user.count({ where: { primaryGroup: { key: { not: "banned" } } } }),
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

  // ─── Donațiile ──────────────────────────────────────────────────────────────────────────────────

  /** O donație înregistrată de echipă (suma în unități, ex. 25.50; moneda cu 3 litere). */
  async addDonation(actor: GcsActor, userId: string, input: { amount: number; currency: string; note: string }): Promise<void> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "edit");
    const { db } = this.deps;
    const cents = Math.round(input.amount * 100);
    const currency = input.currency.trim().toUpperCase();
    const errors: Record<string, string> = {};
    if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) errors.amount = "invalid_range";
    if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "invalid";
    const note = input.note.replace(/\s+/g, " ").trim().slice(0, 200);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    if (!(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new GcsNotFound();
    const row = await db.memberDonation.create({ data: { userId, amount: cents, currency, note, createdById: actor.userId } });
    await writeAudit(db, { actorId: actor.userId, action: "member.donation.add", targetType: "user", targetId: userId, after: row, ip: actor.ip });
  }

  async deleteDonation(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "edit");
    const before = await this.deps.db.memberDonation.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await this.deps.db.memberDonation.delete({ where: { id } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "member.donation.delete", targetType: "user", targetId: before.userId, before, ip: actor.ip });
  }

  donations(userId: string) {
    return this.deps.db.memberDonation.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  }
}
