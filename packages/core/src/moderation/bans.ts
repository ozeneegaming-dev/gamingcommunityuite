import { isIP } from "node:net";
import type { Ban, BanType, Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { normalizeEmail } from "../auth/usernames";
import type { GcsCache } from "../cache";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { assertCanManageUser } from "../groups/rootGuard";
import type { GcsActor } from "../permissions/types";

export type GcsBanInput = {
  type: BanType;
  value: string;
  userId?: string;
  reason: string;
  expiresAt?: Date | null;
};

/** Secțiunea ACP care dă dreptul de a bana. */
const ACP_SECTION = "members.members";
/** Cheia de cache care marchează token-ul unei sesiuni șterse la ban (vezi `GcsActorResolver`). */
export const bannedSessionKey = (token: string) => `banned-session:${token}`;

/** Bannul activ care se potrivește cu userul, IP-ul sau emailul dat; `null` dacă nu există. */
export async function findActiveBan(
  db: Pick<PrismaClient, "ban">,
  q: { userId?: string; ip?: string; email?: string },
  now = new Date(),
): Promise<Ban | null> {
  const match: Prisma.BanWhereInput[] = [];
  if (q.userId) match.push({ type: "ACCOUNT", userId: q.userId });
  if (q.ip) match.push({ type: "IP", value: q.ip });
  if (q.email) match.push({ type: "EMAIL", value: normalizeEmail(q.email) });
  if (match.length === 0) return null;
  return db.ban.findFirst({
    where: { OR: match, liftedAt: null, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Bannuri pe cont, IP sau email (spec §6.5). Un ban de cont (sau pe emailul unui cont) șterge sesiunile
 * userului și emite `user.banned`; token-urile șterse rămân marcate în cache, ca userul să vadă că e banat.
 */
export class GcsBanService {
  constructor(
    private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; acp: GcsAcpRoleService },
  ) {}

  activeFor(q: { userId?: string; ip?: string; email?: string }, now = new Date()): Promise<Ban | null> {
    return findActiveBan(this.deps.db, q, now);
  }

  async ban(input: GcsBanInput, actor: GcsActor): Promise<Ban> {
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    return this.applyBan(input, actor);
  }

  /**
   * Aplică un ban fără verificarea dreptului ACP (o face apelantul, ex. pragurile de avertisment).
   * Protecția Root Admin se aplică oricum.
   */
  async applyBan(input: GcsBanInput, actor: GcsActor): Promise<Ban> {
    const { db } = this.deps;
    const data = this.validate(input);

    // Userul afectat: cel banat pe cont sau cel care are emailul banat.
    const target =
      data.type === "ACCOUNT"
        ? await db.user.findUnique({ where: { id: data.userId! }, select: { id: true } })
        : data.type === "EMAIL"
          ? await db.user.findUnique({ where: { email: data.value }, select: { id: true } })
          : null;
    if (data.type === "ACCOUNT" && !target) throw new GcsNotFound({ entity: "user" });
    if (target) await assertCanManageUser(db, actor, target.id, { removesRoot: true });

    const { ban, sessions } = await db.$transaction(async (tx) => {
      const ban = await tx.ban.create({
        data: {
          type: data.type,
          value: data.value,
          userId: target?.id ?? null,
          reason: data.reason,
          expiresAt: data.expiresAt ?? null,
          createdById: actor.userId,
        },
      });
      const sessions = target
        ? await tx.session.findMany({ where: { userId: target.id }, select: { token: true, expiresAt: true } })
        : [];
      if (target) await tx.session.deleteMany({ where: { userId: target.id } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.ban",
        targetType: data.type === "ACCOUNT" ? "user" : "ban",
        targetId: target?.id ?? ban.id,
        after: { type: ban.type, value: ban.value, reason: ban.reason, expiresAt: ban.expiresAt?.toISOString() ?? null },
        ip: actor.ip,
      });
      return { ban, sessions };
    });

    const now = Date.now();
    for (const s of sessions) {
      const ttlSec = Math.max(1, Math.ceil((s.expiresAt.getTime() - now) / 1000));
      await this.deps.cache.set(bannedSessionKey(s.token), true, { ttlSec, tags: [] });
    }
    await this.deps.bus.emit({
      name: "user.banned",
      payload: { banId: ban.id, type: ban.type, userId: target?.id ?? null },
      tags: target ? [`user:${target.id}`] : [],
    });
    return ban;
  }

  async lift(banId: string, actor: GcsActor): Promise<void> {
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
    const ban = await this.deps.db.$transaction(async (tx) => {
      const ban = await tx.ban.findUnique({ where: { id: banId } });
      if (!ban) throw new GcsNotFound({ entity: "ban" });
      if (ban.liftedAt) return ban;
      const lifted = await tx.ban.update({ where: { id: banId }, data: { liftedAt: new Date() } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.unban",
        targetType: ban.userId ? "user" : "ban",
        targetId: ban.userId ?? ban.id,
        before: { liftedAt: null },
        after: { liftedAt: lifted.liftedAt?.toISOString() ?? null },
        ip: actor.ip,
      });
      return lifted;
    });
    await this.deps.bus.emit({
      name: "user.unbanned",
      payload: { banId: ban.id, userId: ban.userId },
      tags: ban.userId ? [`user:${ban.userId}`] : [],
    });
  }

  private validate(input: GcsBanInput): GcsBanInput {
    const errors: Record<string, string> = {};
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 500) errors.reason = "invalid_length";
    let value = input.value.trim();

    if (input.type === "ACCOUNT") {
      if (!input.userId) errors.userId = "required";
      value = input.userId ?? value;
    } else if (input.type === "IP") {
      if (isIP(value) === 0) errors.value = "invalid_ip";
    } else {
      value = normalizeEmail(value);
      if (!/^[^\s@]+@[^\s@]+$/.test(value)) errors.value = "invalid_email";
    }
    if (input.expiresAt && Number.isNaN(input.expiresAt.getTime())) errors.expiresAt = "invalid_date";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const result: GcsBanInput = { type: input.type, value, reason, expiresAt: input.expiresAt ?? null };
    if (input.type === "ACCOUNT") result.userId = input.userId!;
    return result;
  }
}
