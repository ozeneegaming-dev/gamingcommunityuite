import type { Prisma, PrismaClient, Warning, WarningAction, WarningActionType, WarningAppeal, WarningReason } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { assertCanManageUser } from "../groups/rootGuard";
import type { GcsActor } from "../permissions/types";
import type { GcsBanService } from "./bans";

export type GcsWarningInput = {
  userId: string;
  points: number;
  reason: string;
  expiresAt?: Date | null;
  /** Dovada atașată (ex. mesajul de chat avertizat), păstrată cu avertismentul. */
  evidence?: Record<string, unknown> | null;
  /** Motivul predefinit din care pornește (ACP › Moderare › Avertismente). */
  reasonId?: number | null;
};

export const WARNINGS_ACP_SECTION = "members.warnings";
/** Membrul confirmă un avertisment nou înainte să poată posta din nou (implicit da). */
export const WARNINGS_ACK_SETTING = "members.warnings_ack";
const ACP_SECTION = WARNINGS_ACP_SECTION;
const MAX_POINTS = 100;
/** Un prag fără durată (permanent) se ține până scad punctele: data e „niciodată” în practică. */
const UNTIL_POINTS_DROP = new Date("9999-12-31T00:00:00Z");
/** Motivul banului pus de pragul `BAN` (ridicat automat când punctele scad sub prag). */
const THRESHOLD_BAN_REASON = "warning_threshold";

/** Setarea „confirmă avertismentul înainte să postezi”, citită dintr-un serviciu de setări (lipsă sau eroare = da). */
export async function warningAckRequired(settings: { get<T>(key: string): Promise<T> } | undefined): Promise<boolean> {
  if (!settings) return true;
  return (await settings.get<boolean>(WARNINGS_ACK_SETTING).catch(() => true)) !== false;
}

/** Avertismentele care contează: neanulate și neexpirate. */
const activeWhere = (userId: string, now: Date): Prisma.WarningWhereInput => ({
  userId,
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/**
 * Poarta scrierii unui membru (postări, răspunsuri, mesaje private, chat, statusuri): restricționat de un prag de
 * avertisment până la o dată, sau cu un avertisment neconfirmat (dacă setarea o cere). `moderated` = postările lui trec
 * prin aprobare.
 */
export async function memberWriteGate(
  db: Pick<PrismaClient, "user" | "warning">,
  userId: string,
  opts: { ackRequired: boolean; now?: Date },
): Promise<{ restrictedUntil: Date | null; ackPending: boolean; moderated: boolean }> {
  const now = opts.now ?? new Date();
  const [user, unacknowledged] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { postsModeratedUntil: true, postingRestrictedUntil: true } }),
    opts.ackRequired ? db.warning.count({ where: { ...activeWhere(userId, now), acknowledgedAt: null } }) : Promise.resolve(0),
  ]);
  const restricted = user?.postingRestrictedUntil && user.postingRestrictedUntil > now ? user.postingRestrictedUntil : null;
  return { restrictedUntil: restricted, ackPending: unacknowledged > 0, moderated: Boolean(user?.postsModeratedUntil && user.postsModeratedUntil > now) };
}

/** Aruncă dacă membrul nu poate scrie acum (restricționat sau cu un avertisment de confirmat). */
export async function assertMemberCanWrite(db: Pick<PrismaClient, "user" | "warning">, userId: string, opts: { ackRequired: boolean; now?: Date }): Promise<void> {
  const gate = await memberWriteGate(db, userId, opts);
  if (gate.restrictedUntil) throw new GcsForbidden({ reason: "posting_restricted", until: gate.restrictedUntil.toISOString() });
  if (gate.ackPending) throw new GcsForbidden({ reason: "warning_ack" });
}

export type GcsMyWarning = Warning & { appeal: WarningAppeal | null; active: boolean };
export type GcsAppealRow = WarningAppeal & { warning: Warning; user: { id: string; name: string } | null };

/**
 * Avertismente cu puncte care expiră (spec §6.5, anti-spam). După fiecare avertisment se aplică pragurile atinse de suma
 * punctelor active: `MODERATE_POSTS` (postările trec prin aprobare), `RESTRICT` (membrul nu poate scrie) și `BAN` (ban
 * pe cont), fiecare pe durata pragului. Când punctele scad (expirare, anulare, contestație acceptată), pragurile care nu
 * mai sunt atinse se ridică singure. Membrul confirmă avertismentul și îl poate contesta o dată.
 */
export class GcsWarningService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      acp: GcsAcpRoleService;
      bans: GcsBanService;
      /** Setarea „confirmă înainte să postezi” (lipsă = da). */
      ackRequired?: () => Promise<boolean>;
    },
  ) {}

  async activePoints(userId: string, now = new Date()): Promise<number> {
    const sum = await this.deps.db.warning.aggregate({ where: activeWhere(userId, now), _sum: { points: true } });
    return sum._sum.points ?? 0;
  }

  async ackRequired(): Promise<boolean> {
    return (await this.deps.ackRequired?.().catch(() => true)) ?? true;
  }

  /** Poarta scrierii pentru un membru (vezi `memberWriteGate`). */
  async writeGate(userId: string, now = new Date()) {
    return memberWriteGate(this.deps.db, userId, { ackRequired: await this.ackRequired(), now });
  }

  async assertCanWrite(userId: string | null, now = new Date()): Promise<void> {
    if (!userId) return;
    await assertMemberCanWrite(this.deps.db, userId, { ackRequired: await this.ackRequired(), now });
  }

  /**
   * Un avertisment nou. Dreptul implicit e cel din ACP (`members.warnings`); `opts.authorized` îl lasă apelantului care
   * și-a verificat propriul drept (ex. `chat.warn` în chat). Protecția Root Admin rămâne oricum.
   */
  async warn(
    input: GcsWarningInput,
    actor: GcsActor,
    opts: { authorized?: boolean } = {},
  ): Promise<{ warning: Warning; actionTaken: WarningAction | null }> {
    const { db, bus } = this.deps;
    if (!opts.authorized) await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    const reason = input.reason.trim();
    const errors: Record<string, string> = {};
    if (!Number.isInteger(input.points) || input.points < 1 || input.points > MAX_POINTS) errors.points = "invalid_points";
    if (reason.length === 0 || reason.length > 500) errors.reason = "invalid_length";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    await assertCanManageUser(db, actor, input.userId);

    const warning = await db.$transaction(async (tx) => {
      const warning = await tx.warning.create({
        data: {
          userId: input.userId,
          points: input.points,
          reason,
          expiresAt: input.expiresAt ?? null,
          issuedById: actor.userId,
          reasonId: input.reasonId ?? null,
          ...(input.evidence ? { evidence: input.evidence as Prisma.InputJsonValue } : {}),
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.warn",
        targetType: "user",
        targetId: input.userId,
        after: { points: warning.points, reason: warning.reason, ...(input.evidence ? { evidence: input.evidence } : {}) },
        ip: actor.ip,
      });
      return warning;
    });
    await bus.emit({ name: "user.warned", payload: { userId: input.userId, warningId: warning.id }, tags: [`user:${input.userId}`] });
    const actionTaken = await this.applyThresholds(input.userId, actor);
    return { warning, actionTaken };
  }

  /** Pragurile atinse acum (cel mai mare prag al fiecărui tip). */
  private async reached(userId: string, now: Date): Promise<{ points: number; byType: Map<WarningActionType, WarningAction> }> {
    const points = await this.activePoints(userId, now);
    const actions = await this.deps.db.warningAction.findMany({ where: { threshold: { lte: points } }, orderBy: { threshold: "asc" } });
    const byType = new Map<WarningActionType, WarningAction>();
    for (const a of actions) byType.set(a.action, a);
    return { points, byType };
  }

  /** Aplică pragurile atinse; întoarce pragul cel mai mare (cel raportat). */
  private async applyThresholds(userId: string, actor: GcsActor, now = new Date()): Promise<WarningAction | null> {
    const { db, bus } = this.deps;
    const { points, byType } = await this.reached(userId, now);
    if (byType.size === 0) return null;
    const until = (a: WarningAction) => (a.durationHours ? new Date(now.getTime() + a.durationHours * 3_600_000) : UNTIL_POINTS_DROP);
    const user = await db.user.findUnique({ where: { id: userId }, select: { postsModeratedUntil: true, postingRestrictedUntil: true } });
    const later = (a: Date | null | undefined, b: Date) => (a && a > b ? a : b);
    const moderate = byType.get("MODERATE_POSTS");
    const restrict = byType.get("RESTRICT");
    if (moderate || restrict) {
      await db.user.update({
        where: { id: userId },
        data: {
          ...(moderate ? { postsModeratedUntil: later(user?.postsModeratedUntil, until(moderate)) } : {}),
          ...(restrict ? { postingRestrictedUntil: later(user?.postingRestrictedUntil, until(restrict)) } : {}),
        },
      });
    }
    const ban = byType.get("BAN");
    if (ban && !(await this.deps.bans.activeFor({ userId }))) {
      await this.deps.bans.applyBan(
        { type: "ACCOUNT", value: userId, userId, reason: THRESHOLD_BAN_REASON, expiresAt: ban.durationHours ? until(ban) : null },
        actor,
      );
    }
    const top = [...byType.values()].sort((a, b) => b.threshold - a.threshold)[0]!;
    for (const a of byType.values()) {
      if (a.action === "BAN") continue;
      await bus.emit({ name: "user.warning_action", payload: { userId, action: a.action, durationHours: a.durationHours, points }, tags: [`user:${userId}`] });
    }
    return top;
  }

  /** Ridică pragurile care nu mai sunt atinse (punctele au scăzut). Fără verificarea dreptului (o face apelantul). */
  async recompute(userId: string, actorId: string | null, now = new Date()): Promise<void> {
    const { db, bus } = this.deps;
    const { byType } = await this.reached(userId, now);
    const user = await db.user.findUnique({ where: { id: userId }, select: { postsModeratedUntil: true, postingRestrictedUntil: true } });
    if (!user) return;
    const data: Prisma.UserUpdateInput = {};
    if (user.postsModeratedUntil && (!byType.has("MODERATE_POSTS") || user.postsModeratedUntil <= now)) data.postsModeratedUntil = null;
    if (user.postingRestrictedUntil && (!byType.has("RESTRICT") || user.postingRestrictedUntil <= now)) data.postingRestrictedUntil = null;
    if (Object.keys(data).length > 0) await db.user.update({ where: { id: userId }, data });
    if (!byType.has("BAN")) {
      const bans = await db.ban.findMany({ where: { type: "ACCOUNT", userId, reason: THRESHOLD_BAN_REASON, liftedAt: null } });
      for (const b of bans) {
        await db.ban.update({ where: { id: b.id }, data: { liftedAt: now } });
        await writeAudit(db, { actorId, action: "user.unban", targetType: "user", targetId: userId, before: { liftedAt: null }, after: { reason: "warning_points_dropped" }, ip: null });
        await bus.emit({ name: "user.unbanned", payload: { banId: b.id, userId }, tags: [`user:${userId}`] });
      }
    }
  }

  /** Anulează un avertisment (ACP sau contestație acceptată); pragurile se recalculează. */
  async revoke(warningId: string, actor: GcsActor, opts: { authorized?: boolean } = {}): Promise<void> {
    const { db, bus } = this.deps;
    if (!opts.authorized) await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    const warning = await db.warning.findUnique({ where: { id: warningId } });
    if (!warning) throw new GcsNotFound({ entity: "warning" });
    if (warning.revokedAt) return;
    await db.warning.update({ where: { id: warningId }, data: { revokedAt: new Date(), revokedById: actor.userId } });
    await writeAudit(db, { actorId: actor.userId, action: "user.warn_revoke", targetType: "user", targetId: warning.userId, before: { points: warning.points, reason: warning.reason }, ip: actor.ip });
    await this.recompute(warning.userId, actor.userId);
    await bus.emit({ name: "user.warning_revoked", payload: { userId: warning.userId, warningId }, tags: [`user:${warning.userId}`] });
  }

  /** Avertismentele membrului (pagina „Avertismentele mele”), cu contestația fiecăruia. */
  async mine(userId: string, now = new Date()): Promise<GcsMyWarning[]> {
    const rows = await this.deps.db.warning.findMany({ where: { userId }, include: { appeal: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((w) => ({ ...w, active: !w.revokedAt && (!w.expiresAt || w.expiresAt > now) }));
  }

  /** Membrul confirmă că a citit avertismentul (deblochează postarea, dacă setarea o cere). */
  async acknowledge(actor: GcsActor, warningId: string): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const { count } = await this.deps.db.warning.updateMany({ where: { id: warningId, userId: actor.userId, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } });
    if (count === 0 && !(await this.deps.db.warning.findFirst({ where: { id: warningId, userId: actor.userId }, select: { id: true } }))) throw new GcsNotFound({ entity: "warning" });
  }

  /** O contestație (una pe avertisment, doar pentru unul activ). Confirmă și avertismentul (membrul l-a citit). */
  async appeal(actor: GcsActor, warningId: string, text: string): Promise<WarningAppeal> {
    const { db, bus } = this.deps;
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const body = text.trim();
    if (body.length < 10 || body.length > 2000) throw new GcsValidationError({ text: "invalid_length" });
    const warning = await db.warning.findFirst({ where: { id: warningId, userId: actor.userId }, include: { appeal: true } });
    if (!warning) throw new GcsNotFound({ entity: "warning" });
    if (warning.appeal) throw new GcsConflict({ reason: "already_appealed" });
    if (warning.revokedAt || (warning.expiresAt && warning.expiresAt <= new Date())) throw new GcsConflict({ reason: "warning_inactive" });
    const appeal = await db.warningAppeal.create({ data: { warningId, userId: actor.userId, text: body } });
    if (!warning.acknowledgedAt) await db.warning.update({ where: { id: warningId }, data: { acknowledgedAt: new Date() } });
    await writeAudit(db, { actorId: actor.userId, action: "user.warn_appeal", targetType: "warning", targetId: warningId, after: { appealId: appeal.id }, ip: actor.ip });
    await bus.emit({ name: "warning.appealed", payload: { userId: actor.userId, warningId, appealId: appeal.id }, tags: [`user:${actor.userId}`] });
    return appeal;
  }

  /** Contestațiile (ACP): în așteptare întâi. */
  async appeals(actor: GcsActor, opts: { status?: "pending" | "all" } = {}): Promise<GcsAppealRow[]> {
    await this.deps.acp.assert(actor, ACP_SECTION, "view");
    const rows = await this.deps.db.warningAppeal.findMany({
      where: opts.status === "all" ? {} : { status: "pending" },
      include: { warning: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const users = new Map((await this.deps.db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, user: users.get(r.userId) ?? null }));
  }

  /** Decizia unei contestații: acceptată → avertismentul se anulează; membrul e anunțat în ambele cazuri. */
  async decideAppeal(actor: GcsActor, appealId: number, accept: boolean, reason: string): Promise<void> {
    const { db, bus } = this.deps;
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    const note = reason.trim();
    if (note.length > 1000) throw new GcsValidationError({ reason: "invalid_length" });
    const appeal = await db.warningAppeal.findUnique({ where: { id: appealId } });
    if (!appeal) throw new GcsNotFound({ entity: "appeal" });
    if (appeal.status !== "pending") throw new GcsConflict({ reason: "already_decided" });
    await db.warningAppeal.update({
      where: { id: appealId },
      data: { status: accept ? "accepted" : "rejected", decidedById: actor.userId, decisionReason: note || null, decidedAt: new Date() },
    });
    await writeAudit(db, { actorId: actor.userId, action: accept ? "user.warn_appeal_accept" : "user.warn_appeal_reject", targetType: "user", targetId: appeal.userId, after: { appealId, reason: note }, ip: actor.ip });
    if (accept) await this.revoke(appeal.warningId, actor, { authorized: true });
    await bus.emit({ name: "warning.appeal_decided", payload: { userId: appeal.userId, appealId, warningId: appeal.warningId, accepted: accept }, tags: [`user:${appeal.userId}`] });
  }

  // ─── Motivele predefinite și pragurile (ACP) ─────────────────────────────────────────────────────────────

  reasons(): Promise<WarningReason[]> {
    return this.deps.db.warningReason.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  async saveReason(actor: GcsActor, input: { id?: number; name: string; points: number; expiresDays: number | null }): Promise<WarningReason> {
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    const name = input.name.trim();
    const errors: Record<string, string> = {};
    if (name.length < 2 || name.length > 120) errors.name = "invalid_length";
    if (!Number.isInteger(input.points) || input.points < 1 || input.points > MAX_POINTS) errors.points = "invalid_points";
    if (input.expiresDays !== null && (!Number.isInteger(input.expiresDays) || input.expiresDays < 1 || input.expiresDays > 3650)) errors.expiresDays = "invalid_range";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { name, points: input.points, expiresDays: input.expiresDays };
    const row = input.id ? await this.deps.db.warningReason.update({ where: { id: input.id }, data }) : await this.deps.db.warningReason.create({ data });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "warning.reason_save", targetType: "warning_reason", targetId: String(row.id), after: data, ip: actor.ip });
    return row;
  }

  async deleteReason(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, ACP_SECTION, "delete");
    await this.deps.db.warningReason.deleteMany({ where: { id } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "warning.reason_delete", targetType: "warning_reason", targetId: String(id), ip: actor.ip });
  }

  thresholds(): Promise<WarningAction[]> {
    return this.deps.db.warningAction.findMany({ orderBy: { threshold: "asc" } });
  }

  async saveThreshold(actor: GcsActor, input: { id?: number; threshold: number; action: WarningActionType; durationHours: number | null }): Promise<WarningAction> {
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 1000) errors.threshold = "invalid_range";
    if (!["MODERATE_POSTS", "RESTRICT", "BAN"].includes(input.action)) errors.action = "invalid_choice";
    if (input.durationHours !== null && (!Number.isInteger(input.durationHours) || input.durationHours < 1 || input.durationHours > 87_600)) errors.durationHours = "invalid_range";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const clash = await this.deps.db.warningAction.findUnique({ where: { threshold: input.threshold } });
    if (clash && clash.id !== input.id) throw new GcsValidationError({ threshold: "taken" });
    const data = { threshold: input.threshold, action: input.action, durationHours: input.durationHours };
    const row = input.id ? await this.deps.db.warningAction.update({ where: { id: input.id }, data }) : await this.deps.db.warningAction.create({ data });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "warning.threshold_save", targetType: "warning_action", targetId: String(row.id), after: data, ip: actor.ip });
    return row;
  }

  async deleteThreshold(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, ACP_SECTION, "delete");
    await this.deps.db.warningAction.deleteMany({ where: { id } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "warning.threshold_delete", targetType: "warning_action", targetId: String(id), ip: actor.ip });
  }

  /**
   * Jobul de expirare: membrii cu restricții din praguri sau cu un ban de prag își recalculează pragurile (avertismentele
   * expirate nu mai contează; datele trecute se golesc). Întoarce câți membri au fost verificați.
   */
  async expireSweep(now = new Date()): Promise<number> {
    const { db } = this.deps;
    const [users, bans] = await Promise.all([
      db.user.findMany({ where: { OR: [{ postsModeratedUntil: { not: null } }, { postingRestrictedUntil: { not: null } }] }, select: { id: true }, take: 5000 }),
      db.ban.findMany({ where: { type: "ACCOUNT", reason: THRESHOLD_BAN_REASON, liftedAt: null }, select: { userId: true }, take: 5000 }),
    ]);
    const ids = [...new Set([...users.map((u) => u.id), ...bans.map((b) => b.userId).filter((id): id is string => id !== null)])];
    for (const id of ids) await this.recompute(id, null, now);
    return ids.length;
  }
}
