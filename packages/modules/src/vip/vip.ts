import {
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsActor,
  type GcsEventBus,
  type GcsJobQueue,
  type GcsMailer,
  type GcsPermissionService,
  type GcsSettingsService,
} from "@gcs/core";
import type { Prisma, PrismaClient, VipAction, VipStatus, VipSubscription } from "@gcs/db";
import { vipExpiringMail } from "../profile/emails";
import type { GcsMembership } from "../profile/membership";

export const VIP_SWEEP_JOB = "vip.sweep";
const SWEEP_EVERY_MS = 5 * 60_000;
const MAX_DAYS = 3650;

type Tx = Prisma.TransactionClient;

export type GcsVipGrantInput = { userId: string; groupId: number; days: number | null; asPrimary?: boolean; note?: string };

const userTags = (id: string) => [`user:${id}`, "vip"];

/**
 * VIP-ul (spec §9, specul etapei 3): acordare manuală din ACP, prelungire, retragere și expirare automată (worker,
 * la 5 minute). Cel mult un abonament activ pe user; fiecare schimbare intră în `vip_log` și în jurnal.
 */
export class GcsVipService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      membership: GcsMembership;
      mailer: GcsMailer;
    },
  ) {}

  private async log(tx: Tx, sub: Pick<VipSubscription, "userId" | "groupId" | "expiresAt">, action: VipAction, actor: GcsActor | null, note?: string): Promise<void> {
    await tx.vipLog.create({ data: { userId: sub.userId, groupId: sub.groupId, action, expiresAt: sub.expiresAt, actorId: actor?.userId ?? null, note: note ?? null } });
    await writeAudit(tx, {
      actorId: actor?.userId ?? null,
      action: `vip.${action.toLowerCase()}`,
      targetType: "user",
      targetId: sub.userId,
      after: { groupId: sub.groupId, expiresAt: sub.expiresAt?.toISOString() ?? null, ...(note ? { note } : {}) },
      ip: actor?.ip ?? null,
    });
  }

  /** Scoate grupul VIP al abonamentului: ca principal revine la grupul anterior (sau Membru, dacă nu mai există). */
  private async removeGroup(tx: Tx, sub: VipSubscription): Promise<number[]> {
    const user = await tx.user.findUnique({ where: { id: sub.userId }, select: { primaryGroupId: true, previousPrimaryGroupId: true } });
    if (!user) return [];
    const changed = [sub.groupId];
    if (user.primaryGroupId === sub.groupId) {
      const previous = user.previousPrimaryGroupId
        ? await tx.group.findUnique({ where: { id: user.previousPrimaryGroupId }, select: { id: true, isVip: true } })
        : null;
      const fallback = previous && !previous.isVip ? previous.id : (await tx.group.findUniqueOrThrow({ where: { key: "member" }, select: { id: true } })).id;
      await this.deps.membership.setPrimary(tx, sub.userId, fallback, { savePrevious: false });
      changed.push(fallback);
    }
    await this.deps.membership.removeSecondary(tx, sub.userId, sub.groupId);
    return changed;
  }

  /** Închide un abonament activ (retragere sau expirare). `false` dacă altcineva l-a închis între timp. */
  private async end(tx: Tx, sub: VipSubscription, status: Exclude<VipStatus, "ACTIVE">, actor: GcsActor | null, note?: string): Promise<number[] | null> {
    const { count } = await tx.vipSubscription.updateMany({ where: { id: sub.id, status: "ACTIVE" }, data: { status } });
    if (count === 0) return null;
    const changed = await this.removeGroup(tx, sub);
    await this.log(tx, sub, status === "EXPIRED" ? "EXPIRE" : "REVOKE", actor, note);
    return changed;
  }

  async active(userId: string): Promise<VipSubscription | null> {
    return this.deps.db.vipSubscription.findFirst({ where: { userId, status: "ACTIVE" } });
  }

  /**
   * Acordă un nivel VIP. Un abonament activ pe același nivel e prelungit; pe alt nivel e închis („schimbat nivelul”).
   * Ca grup principal, grupul anterior (non-VIP) se păstrează, ca userul să revină la el la expirare.
   */
  async grant(actor: GcsActor, input: GcsVipGrantInput): Promise<VipSubscription> {
    const { db, bus, permissions, membership } = this.deps;
    await permissions.assert(actor, "vip.manage");
    if (input.days !== null && (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_DAYS)) {
      throw new GcsValidationError({ days: "invalid_range" }, { max: String(MAX_DAYS) });
    }
    const [group, user] = await Promise.all([
      db.group.findUnique({ where: { id: input.groupId } }),
      db.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
    ]);
    if (!user) throw new GcsNotFound();
    if (!group?.isVip) throw new GcsValidationError({ groupId: "not_vip" });
    const note = input.note?.trim().slice(0, 200) || undefined;
    const asPrimary = input.asPrimary ?? true;

    const existing = await this.active(input.userId);
    if (existing && existing.groupId === input.groupId) {
      if (input.days === null) {
        // Devine permanent.
        return this.updateExpiry(actor, existing, null, note);
      }
      return this.extend(actor, existing.id, input.days, note);
    }

    const result = await db.$transaction(async (tx) => {
      // Serializează schimbările VIP ale aceluiași user (două acordări simultane).
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
      const changed = new Set<number>([input.groupId]);
      const current = await tx.vipSubscription.findFirst({ where: { userId: input.userId, status: "ACTIVE" } });
      if (current) {
        const removed = await this.end(tx, current, "REVOKED", actor, "tier_changed");
        for (const id of removed ?? []) changed.add(id);
      }
      if (asPrimary) {
        const u = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { primaryGroup: { select: { isVip: true } } } });
        // Grupul anterior se salvează doar dacă nu e tot un VIP (altfel userul ar „reveni” la un VIP expirat).
        const old = await membership.setPrimary(tx, input.userId, input.groupId, { savePrevious: !u.primaryGroup.isVip });
        if (old !== null) changed.add(old);
      } else {
        await membership.addSecondary(tx, input.userId, input.groupId);
      }
      const sub = await tx.vipSubscription.create({
        data: {
          userId: input.userId,
          groupId: input.groupId,
          expiresAt: input.days === null ? null : new Date(Date.now() + input.days * 86_400_000),
          grantedById: actor.userId,
          madePrimary: asPrimary,
        },
      });
      await this.log(tx, sub, "GRANT", actor, note);
      return { sub, changed: [...changed] };
    });
    await membership.notify(input.userId, result.changed);
    await bus.emit({ name: "vip.granted", payload: { userId: input.userId, groupId: input.groupId, subscriptionId: result.sub.id }, tags: userTags(input.userId) });
    return result.sub;
  }

  /** Prelungește: `expiresAt = max(expiresAt, acum) + zile`. Avertizarea se va trimite din nou înaintea noii expirări. */
  async extend(actor: GcsActor, subscriptionId: number, days: number, note?: string): Promise<VipSubscription> {
    await this.deps.permissions.assert(actor, "vip.manage");
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new GcsValidationError({ days: "invalid_range" }, { max: String(MAX_DAYS) });
    const sub = await this.deps.db.vipSubscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.status !== "ACTIVE") throw new GcsNotFound();
    if (sub.expiresAt === null) throw new GcsValidationError({ days: "permanent" });
    const base = Math.max(sub.expiresAt.getTime(), Date.now());
    return this.updateExpiry(actor, sub, new Date(base + days * 86_400_000), note);
  }

  private async updateExpiry(actor: GcsActor, sub: VipSubscription, expiresAt: Date | null, note?: string): Promise<VipSubscription> {
    const { db, bus } = this.deps;
    const updated = await db.$transaction(async (tx) => {
      const { count } = await tx.vipSubscription.updateMany({ where: { id: sub.id, status: "ACTIVE" }, data: { expiresAt, warnedAt: null } });
      if (count === 0) throw new GcsNotFound();
      const row = await tx.vipSubscription.findUniqueOrThrow({ where: { id: sub.id } });
      await this.log(tx, row, "EXTEND", actor, note);
      return row;
    });
    await bus.emit({ name: "vip.extended", payload: { userId: sub.userId, subscriptionId: sub.id }, tags: userTags(sub.userId) });
    return updated;
  }

  async revoke(actor: GcsActor, subscriptionId: number, note?: string): Promise<void> {
    const { db, bus, permissions, membership } = this.deps;
    await permissions.assert(actor, "vip.manage");
    const sub = await db.vipSubscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.status !== "ACTIVE") throw new GcsNotFound();
    const changed = await db.$transaction((tx) => this.end(tx, sub, "REVOKED", actor, note?.trim().slice(0, 200) || undefined));
    if (!changed) throw new GcsNotFound();
    await membership.notify(sub.userId, changed);
    await bus.emit({ name: "vip.revoked", payload: { userId: sub.userId, groupId: sub.groupId }, tags: userTags(sub.userId) });
  }

  /**
   * Jobul de la 5 minute: (a) expiră abonamentele trecute (fiecare revendicat atomic, deci rulările paralele nu dublează);
   * (b) trimite o singură dată avertizarea cu `vip.warn_days` înainte.
   */
  async sweep(now = new Date()): Promise<{ expired: number; warned: number }> {
    const { db, bus, membership } = this.deps;
    let expired = 0;
    const due = await db.vipSubscription.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" } });
    for (const sub of due) {
      const changed = await db.$transaction((tx) => this.end(tx, sub, "EXPIRED", null));
      if (!changed) continue;
      expired++;
      await membership.notify(sub.userId, changed);
      await bus.emit({ name: "vip.expired", payload: { userId: sub.userId, groupId: sub.groupId }, tags: userTags(sub.userId) });
    }

    let warned = 0;
    const warnDays = await this.deps.settings.get<number>("vip.warn_days");
    if (warnDays > 0) {
      const soon = await db.vipSubscription.findMany({
        where: { status: "ACTIVE", warnedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + warnDays * 86_400_000) } },
        include: { user: { select: { name: true, email: true } }, group: { select: { name: true } } },
      });
      const [site, locale] = await Promise.all([this.deps.settings.get<string>("site.name"), this.deps.settings.get<string>("site.locale")]);
      for (const sub of soon) {
        const { count } = await db.vipSubscription.updateMany({ where: { id: sub.id, warnedAt: null }, data: { warnedAt: now } });
        if (count === 0) continue;
        warned++;
        await bus.emit({ name: "vip.expiring", payload: { userId: sub.userId, groupId: sub.groupId, expiresAt: sub.expiresAt!.toISOString() }, tags: userTags(sub.userId) });
        if (!sub.user.email.endsWith("@steam.invalid")) {
          await this.deps
            .mailer(vipExpiringMail({ to: sub.user.email, name: sub.user.name, site, tier: sub.group.name, expiresAt: sub.expiresAt!, locale }))
            .catch((error: unknown) => console.error("[gcs] emailul de expirare VIP nu a putut fi trimis", error));
        }
      }
    }
    return { expired, warned };
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: VIP_SWEEP_JOB, everyMs: SWEEP_EVERY_MS, handler: async () => void (await this.sweep()) });
  }

  // ─── Citiri pentru ACP și profil ─────────────────────────────────────────

  subscribers(opts: { groupId?: number; expiringDays?: number; page: number; perPage?: number }) {
    const perPage = opts.perPage ?? 25;
    const where: Prisma.VipSubscriptionWhereInput = {
      status: "ACTIVE",
      ...(opts.groupId ? { groupId: opts.groupId } : {}),
      ...(opts.expiringDays ? { expiresAt: { not: null, lte: new Date(Date.now() + opts.expiringDays * 86_400_000) } } : {}),
    };
    return Promise.all([
      this.deps.db.vipSubscription.findMany({
        where,
        include: { user: { select: { id: true, name: true, primaryGroup: { select: { key: true } } } }, group: { select: { id: true, name: true, key: true } } },
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        skip: (opts.page - 1) * perPage,
        take: perPage,
      }),
      this.deps.db.vipSubscription.count({ where }),
    ]);
  }

  history(opts: { userId?: string; page: number; perPage?: number }) {
    const perPage = opts.perPage ?? 50;
    const where = opts.userId ? { userId: opts.userId } : {};
    return Promise.all([
      this.deps.db.vipLog.findMany({ where, include: { group: { select: { name: true } } }, orderBy: { id: "desc" }, skip: (opts.page - 1) * perPage, take: perPage }),
      this.deps.db.vipLog.count({ where }),
    ]);
  }
}
