import { writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus, type GcsNotificationService, type GcsSettingDef, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";

/** Secțiunea ACP (ACP › Membri › Setări membri › Recomandări). */
export const REFERRAL_ACP_SECTION = "members.referral";
export const REFERRAL_SETTING = "referral.config";
/** Cookie-ul lăsat de `/r/<id>` și citit la înregistrare (30 de zile). */
export const REFERRAL_COOKIE = "gcs_ref";
export const REFERRAL_COOKIE_DAYS = 30;
/** Jobul care califică recomandările (la oră). */
export const REFERRAL_JOB = "members.referrals";
/** Notificarea celui care a invitat, când membrul adus se califică. */
export const REFERRAL_NOTIFICATION = "core.referral";
/** Evenimentul pentru Realizări v2 (regula „Recomandări”) și pentru pluginuri. */
export const REFERRAL_QUALIFIED_EVENT = "referral.qualified";
export const REFERRALS_PER_PAGE = 30;

export type GcsReferralConfig = {
  enabled: boolean;
  /** Câte postări aprobate trebuie să aibă membrul adus ca recomandarea să conteze (0 = imediat). */
  qualifyPosts: number;
  /** Și emailul confirmat. */
  requireVerified: boolean;
  /** Punctele primite de cel care a invitat, la calificare (0 = fără; recompensele mai bogate: regulile din Realizări). */
  rewardPoints: number;
  /** Câte recomandări se pot califica pentru un membru (0 = nelimitat). */
  maxPerMember: number;
};

export const DEFAULT_REFERRAL: GcsReferralConfig = { enabled: true, qualifyPosts: 1, requireVerified: true, rewardPoints: 10, maxPerMember: 0 };

const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function referralConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsReferralConfig>;
  if (typeof c.enabled !== "boolean" || typeof c.requireVerified !== "boolean") return "invalid";
  if (!int(c.qualifyPosts, 0, 1000) || !int(c.rewardPoints, 0, 10_000) || !int(c.maxPerMember, 0, 100_000)) return "invalid_range";
  return null;
}

export const referralSetting: GcsSettingDef = { key: REFERRAL_SETTING, type: "json", default: DEFAULT_REFERRAL, section: "referral", labelKey: "settings.referral.config", validate: referralConfigError };

/** Id-ul celui care a invitat, din antetul `Cookie` al cererii de înregistrare. */
export function referrerFromCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const m = new RegExp(`(?:^|;\\s*)${REFERRAL_COOKIE}=([A-Za-z0-9_-]{8,40})(?:;|$)`).exec(cookieHeader);
  return m ? m[1]! : null;
}

export type GcsReferralRow = { id: number; createdAt: Date; qualifiedAt: Date | null; rewardedPoints: number; referrer: GcsUserRef | null; referred: GcsUserRef | null; referredPosts: number };

/**
 * Recomandările: linkul personal `/r/<id>` lasă un cookie, iar contul creat cu el (pe orice cale de înregistrare) se
 * leagă de cel care a invitat. Recomandarea se califică (job la oră) când membrul adus are destule postări și, la
 * alegere, emailul confirmat; atunci cel care a invitat primește punctele din setări, o notificare și evenimentul
 * `referral.qualified` (regulile din Realizări pot da badge-uri). Auto-invitarea (același IP de înregistrare) nu contează.
 */
export class GcsReferralService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: Pick<GcsEventBus, "emit">;
      settings: Pick<GcsSettingsService, "get" | "set">;
      acp: Pick<GcsAcpRoleService, "assert">;
      notifications: Pick<GcsNotificationService, "notify">;
    },
  ) {}

  async config(): Promise<GcsReferralConfig> {
    const v = await this.deps.settings.get<GcsReferralConfig | null>(REFERRAL_SETTING).catch(() => null);
    return v && referralConfigError(v) === null ? v : DEFAULT_REFERRAL;
  }

  async saveConfig(actor: GcsActor, value: GcsReferralConfig): Promise<void> {
    await this.deps.acp.assert(actor, REFERRAL_ACP_SECTION, "edit");
    await this.deps.settings.set(REFERRAL_SETTING, value, actor);
  }

  /** `true` dacă linkul unui membru e valid acum (programul pornit, contul există, nu e bot). */
  async validReferrer(userId: string): Promise<boolean> {
    if (!(await this.config()).enabled) return false;
    const u = await this.deps.db.user.findUnique({ where: { id: userId }, select: { isBot: true } });
    return !!u && !u.isBot;
  }

  /** Leagă contul nou de cel care l-a invitat (la înregistrare). Întoarce `true` dacă s-a notat. */
  async claim(referredId: string, referrerId: string | null, ip: string | null): Promise<boolean> {
    if (!referrerId || referrerId === referredId || !(await this.validReferrer(referrerId))) return false;
    const { db } = this.deps;
    const referrer = await db.user.findUnique({ where: { id: referrerId }, select: { registrationIp: true } });
    // Același IP de înregistrare = cel mai probabil același om cu un al doilea cont.
    if (ip && referrer?.registrationIp && referrer.registrationIp === ip) return false;
    const existing = await db.referral.findUnique({ where: { referredId }, select: { id: true } });
    if (existing) return false;
    await db.referral.create({ data: { referrerId, referredId, ip } });
    return true;
  }

  /** Jobul: recomandările care îndeplinesc acum condițiile; întoarce câte s-au calificat. */
  async qualifyDue(now = new Date()): Promise<number> {
    const cfg = await this.config();
    if (!cfg.enabled) return 0;
    const { db, bus } = this.deps;
    const pending = await db.referral.findMany({ where: { qualifiedAt: null }, orderBy: { id: "asc" }, take: 500 });
    if (pending.length === 0) return 0;
    const users = await db.user.findMany({
      where: { id: { in: pending.map((r) => r.referredId) } },
      select: { id: true, name: true, postsCount: true, emailVerified: true, isSpammer: true, bans: { where: { type: "ACCOUNT", liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    let done = 0;
    for (const r of pending) {
      const u = byId.get(r.referredId);
      if (!u || u.isSpammer || u.bans.length > 0) continue;
      if (u.postsCount < cfg.qualifyPosts || (cfg.requireVerified && !u.emailVerified)) continue;
      if (cfg.maxPerMember > 0 && (await db.referral.count({ where: { referrerId: r.referrerId, qualifiedAt: { not: null } } })) >= cfg.maxPerMember) continue;
      const points = cfg.rewardPoints;
      const marked = await db.referral.updateMany({ where: { id: r.id, qualifiedAt: null }, data: { qualifiedAt: now, rewardedPoints: points } });
      if (marked.count === 0) continue;
      if (points > 0) {
        await db.user.updateMany({ where: { id: r.referrerId }, data: { points: { increment: points } } });
        await bus.emit({ name: "points.changed", payload: { userId: r.referrerId, delta: points }, tags: [`user:${r.referrerId}`] }).catch(() => {});
      }
      await bus.emit({ name: REFERRAL_QUALIFIED_EVENT, payload: { referrerId: r.referrerId, referredId: r.referredId }, tags: [] }).catch(() => {});
      await this.deps.notifications
        .notify({ userIds: [r.referrerId], type: REFERRAL_NOTIFICATION, targetType: REFERRAL_NOTIFICATION, targetId: String(r.id), actorId: r.referredId, data: { points } })
        .catch(() => {});
      done++;
    }
    return done;
  }

  private async rows(where: { referrerId?: string } = {}, page = 1, take = REFERRALS_PER_PAGE): Promise<{ items: GcsReferralRow[]; total: number; page: number; pages: number }> {
    const { db } = this.deps;
    const total = await db.referral.count({ where });
    const pages = Math.max(1, Math.ceil(total / take));
    const p = Math.min(Math.max(1, page), pages);
    const list = await db.referral.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (p - 1) * take, take });
    const ids = [...new Set(list.flatMap((r) => [r.referrerId, r.referredId]))];
    const users = ids.length > 0 ? await db.user.findMany({ where: { id: { in: ids } }, select: { ...userRefSelect, postsCount: true } }) : [];
    const refs = new Map(users.map((u) => [u.id, { ref: toRef(u), posts: u.postsCount }] as const));
    return {
      items: list.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
        rewardedPoints: r.rewardedPoints,
        referrer: refs.get(r.referrerId)?.ref ?? null,
        referred: refs.get(r.referredId)?.ref ?? null,
        referredPosts: refs.get(r.referredId)?.posts ?? 0,
      })),
      total,
      page: p,
      pages,
    };
  }

  /** ACP: totalurile, cei care au invitat cei mai mulți și lista (paginată). */
  async overview(actor: GcsActor, page = 1, now = new Date()) {
    await this.deps.acp.assert(actor, REFERRAL_ACP_SECTION, "view");
    const { db } = this.deps;
    const [total, qualified, last30, top] = await Promise.all([
      db.referral.count(),
      db.referral.count({ where: { qualifiedAt: { not: null } } }),
      db.referral.count({ where: { createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
      db.referral.groupBy({ by: ["referrerId"], _count: { _all: true }, orderBy: { _count: { referrerId: "desc" } }, take: 10 }),
    ]);
    const topUsers = top.length > 0 ? await db.user.findMany({ where: { id: { in: top.map((t) => t.referrerId) } }, select: userRefSelect }) : [];
    const topRefs = new Map(topUsers.map((u) => [u.id, toRef(u)] as const));
    const topQualified = top.length > 0 ? await db.referral.groupBy({ by: ["referrerId"], where: { referrerId: { in: top.map((t) => t.referrerId) }, qualifiedAt: { not: null } }, _count: { _all: true } }) : [];
    const q = new Map(topQualified.map((t) => [t.referrerId, t._count._all] as const));
    return {
      total,
      qualified,
      last30,
      top: top.map((t) => ({ user: topRefs.get(t.referrerId) ?? null, count: t._count._all, qualified: q.get(t.referrerId) ?? 0 })),
      list: await this.rows({}, page),
    };
  }

  /** Setări → Invită prieteni: câți a adus membrul și cei mai recenți. */
  async mine(userId: string) {
    const [qualified, list] = await Promise.all([this.deps.db.referral.count({ where: { referrerId: userId, qualifiedAt: { not: null } } }), this.rows({ referrerId: userId }, 1, 20)]);
    return { total: list.total, qualified, recent: list.items };
  }

  /** ACP: șterge o recomandare (punctele deja primite rămân). */
  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, REFERRAL_ACP_SECTION, "delete");
    const { count } = await this.deps.db.referral.deleteMany({ where: { id } });
    if (count > 0) await writeAudit(this.deps.db, { actorId: actor.userId, action: "members.referral_delete", targetType: "referral", targetId: String(id), ip: actor.ip });
  }
}
