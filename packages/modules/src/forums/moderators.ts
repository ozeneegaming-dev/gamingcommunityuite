import {
  GcsNotFound,
  GcsValidationError,
  normalizeUsername,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsPermissionService,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/** Secțiunea ACP Membri → Staff → Moderatori. */
export const MODERATORS_ACP_SECTION = "members.moderators";

/** Puterile unui moderator pe forum (specul etapei 2, §6). */
export const MOD_POWERS = ["edit", "hide", "delete", "move", "merge", "split", "pin", "lock", "feature", "approve", "warn"] as const;

export type GcsModeratorInput = { forumIds: number[]; userName?: string; groupId?: number; powers: string[] };
export type GcsModeratorRow = {
  id: number;
  forumId: number;
  forumName: string;
  userId: string | null;
  userName: string | null;
  groupId: number | null;
  groupName: string | null;
  powers: string[];
};

/** Moderatorii pe forum (tabela `moderators`, `containerType: "forum"`): un user sau un grup, cu puteri granulare. */
export class GcsForumModeratorService {
  constructor(private readonly deps: { db: PrismaClient; permissions: GcsPermissionService; acp: GcsAcpRoleService }) {}

  async list(): Promise<GcsModeratorRow[]> {
    const { db } = this.deps;
    const rows = await db.moderator.findMany({
      where: { containerType: "forum" },
      include: { user: { select: { name: true } }, group: { select: { name: true } } },
      orderBy: { id: "asc" },
    });
    const forums = await db.forum.findMany({ where: { id: { in: rows.map((r) => Number(r.containerId)) } }, select: { id: true, name: true } });
    const names = new Map(forums.map((f) => [f.id, f.name]));
    return rows
      .map((r) => ({
        id: r.id,
        forumId: Number(r.containerId),
        forumName: names.get(Number(r.containerId)) ?? `#${r.containerId}`,
        userId: r.userId,
        userName: r.user?.name ?? null,
        groupId: r.groupId,
        groupName: r.group?.name ?? null,
        powers: r.powers,
      }))
      .sort((a, b) => a.forumName.localeCompare(b.forumName) || a.id - b.id);
  }

  async add(actor: GcsActor, input: GcsModeratorInput): Promise<void> {
    const { db, acp, permissions } = this.deps;
    await acp.assert(actor, MODERATORS_ACP_SECTION, "edit");
    const powers = [...new Set(input.powers)];
    const errors: Record<string, string> = {};
    if (powers.length === 0 || powers.some((p) => !(MOD_POWERS as readonly string[]).includes(p))) errors.powers = "invalid_choice";
    if (input.forumIds.length === 0) errors.forumIds = "required";
    if (!input.userName?.trim() && input.groupId === undefined) errors.target = "required";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    let userId: string | null = null;
    let groupId: number | null = null;
    if (input.userName?.trim()) {
      const user = await db.user.findUnique({ where: { nameNormalized: normalizeUsername(input.userName) }, select: { id: true } });
      if (!user) throw new GcsNotFound({ entity: "user" });
      userId = user.id;
    } else {
      const group = await db.group.findUnique({ where: { id: input.groupId! }, select: { id: true } });
      if (!group) throw new GcsNotFound({ entity: "group" });
      groupId = group.id;
    }
    const forums = await db.forum.findMany({ where: { id: { in: input.forumIds } }, select: { id: true } });
    if (forums.length !== new Set(input.forumIds).size) throw new GcsValidationError({ forumIds: "invalid_choice" });

    await db.$transaction(async (tx) => {
      for (const f of forums) {
        await tx.moderator.deleteMany({ where: { containerType: "forum", containerId: String(f.id), userId, groupId } });
        const row = await tx.moderator.create({ data: { containerType: "forum", containerId: String(f.id), userId, groupId, powers } });
        await writeAudit(tx, { actorId: actor.userId, action: "moderator.add", targetType: "moderator", targetId: String(row.id), after: row, ip: actor.ip });
      }
    });
    await permissions.bumpVersion();
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, permissions } = this.deps;
    await acp.assert(actor, MODERATORS_ACP_SECTION, "delete");
    const row = await db.moderator.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      await tx.moderator.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "moderator.remove", targetType: "moderator", targetId: String(id), before: row, ip: actor.ip });
    });
    await permissions.bumpVersion();
  }
}
