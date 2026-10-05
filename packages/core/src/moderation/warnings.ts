import type { PrismaClient, Warning, WarningAction } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import { assertCanManageUser } from "../groups/rootGuard";
import type { GcsActor } from "../permissions/types";
import type { GcsBanService } from "./bans";

export type GcsWarningInput = { userId: string; points: number; reason: string; expiresAt?: Date | null };

const ACP_SECTION = "members.warnings";
const MAX_POINTS = 100;

/**
 * Avertismente cu puncte care expiră (spec §6.5). După fiecare avertisment se aplică pragul cel mai mare
 * atins de suma punctelor active: `BAN` devine un ban pe cont, iar `MODERATE_POSTS` și `RESTRICT` sunt
 * anunțate prin evenimentul `user.warning_action` (le aplică modulul Forum, în etapa 2).
 */
export class GcsWarningService {
  constructor(
    private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService; bans: GcsBanService },
  ) {}

  async activePoints(userId: string, now = new Date()): Promise<number> {
    const sum = await this.deps.db.warning.aggregate({
      where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _sum: { points: true },
    });
    return sum._sum.points ?? 0;
  }

  async warn(
    input: GcsWarningInput,
    actor: GcsActor,
  ): Promise<{ warning: Warning; actionTaken: WarningAction | null }> {
    const { db, bus } = this.deps;
    await this.deps.acp.assert(actor, ACP_SECTION, "edit");
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
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.warn",
        targetType: "user",
        targetId: input.userId,
        after: { points: warning.points, reason: warning.reason },
        ip: actor.ip,
      });
      return warning;
    });
    await bus.emit({ name: "user.warned", payload: { userId: input.userId, warningId: warning.id }, tags: [`user:${input.userId}`] });

    const points = await this.activePoints(input.userId);
    const actionTaken = await db.warningAction.findFirst({
      where: { threshold: { lte: points } },
      orderBy: { threshold: "desc" },
    });
    if (!actionTaken) return { warning, actionTaken: null };

    if (actionTaken.action === "BAN") {
      const alreadyBanned = await this.deps.bans.activeFor({ userId: input.userId });
      if (!alreadyBanned) {
        const expiresAt = actionTaken.durationHours ? new Date(Date.now() + actionTaken.durationHours * 3_600_000) : null;
        await this.deps.bans.applyBan(
          { type: "ACCOUNT", value: input.userId, userId: input.userId, reason: "warning_threshold", expiresAt },
          actor,
        );
      }
    } else {
      await bus.emit({
        name: "user.warning_action",
        payload: { userId: input.userId, action: actionTaken.action, durationHours: actionTaken.durationHours, points },
        tags: [`user:${input.userId}`],
      });
    }
    return { warning, actionTaken };
  }
}
