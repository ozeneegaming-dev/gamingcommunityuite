import { Prisma, type Group, type PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import { isHexColor, type GcsNameStyle } from "./nameStyles";
import { assertCanManageUser, losesRootOnPrimaryChange, losesRootOnSecondaryRemoval } from "./rootGuard";

export type GcsGroupInput = {
  name?: string;
  title?: string | null;
  color?: string | null;
  nameStyle?: GcsNameStyle | null;
  isVip?: boolean;
  position?: number;
};

/** Secțiunea ACP care dă dreptul de a modifica grupuri (`acp.members.groups.edit`). */
const ACP_SECTION = "members.groups";
const PERMISSION_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

type Tx = Prisma.TransactionClient;

/**
 * Grupurile și apartenența userilor la grupuri (spec §6.1). Fiecare scriere verifică dreptul ACP,
 * scrie audit, incrementează `permVersion` și emite `group.updated` (tag-uri `group:<id>` și `name-styles`).
 */
export class GcsGroupService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      acp: GcsAcpRoleService;
    },
  ) {}

  async create(input: GcsGroupInput & { name: string }, actor: GcsActor): Promise<Group> {
    await this.authorize(actor);
    const data = validateInput(input);
    const group = await this.deps.db.$transaction(async (tx) => {
      const last = await tx.group.aggregate({ _max: { position: true } });
      // Cheia finală depinde de id, deci grupul se creează cu o cheie temporară unică.
      const created = await tx.group.create({
        data: {
          ...data,
          name: input.name,
          key: `custom_tmp_${crypto.randomUUID()}`,
          position: data.position ?? (last._max.position ?? 0) + 1,
        },
      });
      const group = await tx.group.update({ where: { id: created.id }, data: { key: `custom_${created.id}` } });
      await this.audit(tx, actor, "group.create", group.id, undefined, snapshot(group));
      return group;
    });
    await this.changed([group.id]);
    return group;
  }

  async update(id: number, input: GcsGroupInput, actor: GcsActor): Promise<Group> {
    await this.authorize(actor);
    const data = validateInput(input);
    const group = await this.deps.db.$transaction(async (tx) => {
      const before = await this.findGroup(tx, id);
      assertCanTouchGroup(before, actor);
      const after = await tx.group.update({ where: { id }, data });
      await this.audit(tx, actor, "group.update", id, snapshot(before), snapshot(after));
      return after;
    });
    await this.changed([id]);
    return group;
  }

  /** Șterge un grup creat din ACP. Membrii care îl aveau ca grup principal trec în `member`. */
  async delete(id: number, actor: GcsActor): Promise<void> {
    await this.authorize(actor);
    await this.deps.db.$transaction(async (tx) => {
      const group = await this.findGroup(tx, id);
      if (group.isProtected) throw new GcsConflict({ reason: "group_protected" });
      const member = await tx.group.findUniqueOrThrow({ where: { key: "member" } });
      await tx.user.updateMany({ where: { primaryGroupId: id }, data: { primaryGroupId: member.id } });
      await tx.user.updateMany({ where: { previousPrimaryGroupId: id }, data: { previousPrimaryGroupId: null } });
      await tx.group.delete({ where: { id } });
      await this.audit(tx, actor, "group.delete", id, snapshot(group), undefined);
    });
    await this.changed([id]);
  }

  /** Setează o setare de grup (o permisiune cu `scope: "group"`): boolean sau număr întreg ≥ -1. */
  async setSetting(groupId: number, key: string, value: unknown, actor: GcsActor): Promise<void> {
    await this.authorize(actor);
    const def = this.deps.permissions.permissionDef(key);
    if (!def || def.scope !== "group") throw new GcsValidationError({ [key]: "unknown_permission" });
    const valid = typeof value === "boolean" || (Number.isInteger(value) && (value as number) >= -1);
    if (!valid) throw new GcsValidationError({ [key]: "invalid_type" });

    const json = value as Prisma.InputJsonValue;
    await this.deps.db.$transaction(async (tx) => {
      assertCanTouchGroup(await this.findGroup(tx, groupId), actor);
      const where = { groupId_key: { groupId, key } };
      const before = await tx.groupSetting.findUnique({ where });
      await tx.groupSetting.upsert({ where, create: { groupId, key, value: json }, update: { value: json } });
      await this.audit(tx, actor, "group.setting", groupId, { [key]: before?.value ?? null }, { [key]: value });
    });
    await this.changed([groupId]);
  }

  /** Înlocuiește matricea unui container: `matrix[groupId]` = cheile de permisiune permise grupului. */
  async setContainerPermissions(
    containerType: string,
    containerId: string,
    matrix: Record<number, string[]>,
    actor: GcsActor,
  ): Promise<void> {
    await this.authorize(actor);
    const rows: Prisma.ContainerPermissionCreateManyInput[] = [];
    for (const [groupId, actions] of Object.entries(matrix)) {
      for (const action of new Set(actions)) {
        if (!PERMISSION_KEY.test(action)) throw new GcsValidationError({ [action]: "invalid_permission" });
        rows.push({ containerType, containerId, groupId: Number(groupId), action });
      }
    }

    const groupIds = [...new Set(rows.map((r) => r.groupId))];
    await this.deps.db.$transaction(async (tx) => {
      const where = { containerType, containerId };
      const before = await tx.containerPermission.findMany({ where, select: { groupId: true, action: true } });
      await tx.containerPermission.deleteMany({ where });
      await tx.containerPermission.createMany({ data: rows });
      await this.audit(tx, actor, "container.permissions", `${containerType}:${containerId}`, toMatrix(before), toMatrix(rows), "container");
    });
    await this.changed(groupIds, [`container:${containerType}:${containerId}`]);
  }

  /** Schimbă grupul principal al userului și îl păstrează pe cel vechi în `previousPrimaryGroupId`. */
  async setPrimary(userId: string, groupId: number, actor: GcsActor): Promise<void> {
    await this.authorize(actor);
    const oldGroupId = await this.deps.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new GcsNotFound({ entity: "user" });
      assertCanTouchGroup(await this.findGroup(tx, groupId), actor);
      if (user.primaryGroupId === groupId) return null;
      const removesRoot = await losesRootOnPrimaryChange(tx, userId, groupId);
      await assertCanManageUser(tx, actor, userId, { removesRoot });
      await tx.user.update({
        where: { id: userId },
        data: { primaryGroupId: groupId, previousPrimaryGroupId: user.primaryGroupId },
      });
      // Un grup nu poate fi în același timp principal și secundar.
      await tx.userGroup.deleteMany({ where: { userId, groupId } });
      await this.audit(tx, actor, "user.primary_group", userId, { primaryGroupId: user.primaryGroupId }, { primaryGroupId: groupId }, "user");
      return user.primaryGroupId;
    });
    if (oldGroupId !== null) await this.changed([oldGroupId, groupId], [`user:${userId}`]);
  }

  async addSecondary(userId: string, groupId: number, actor: GcsActor): Promise<void> {
    await this.authorize(actor);
    const added = await this.deps.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new GcsNotFound({ entity: "user" });
      assertCanTouchGroup(await this.findGroup(tx, groupId), actor);
      await assertCanManageUser(tx, actor, userId);
      if (user.primaryGroupId === groupId) return false;
      const { count } = await tx.userGroup.createMany({ data: [{ userId, groupId }], skipDuplicates: true });
      if (count === 0) return false;
      await this.audit(tx, actor, "user.secondary_add", userId, undefined, { groupId }, "user");
      return true;
    });
    if (added) await this.changed([groupId], [`user:${userId}`]);
  }

  async removeSecondary(userId: string, groupId: number, actor: GcsActor): Promise<void> {
    await this.authorize(actor);
    const removed = await this.deps.db.$transaction(async (tx) => {
      const removesRoot = await losesRootOnSecondaryRemoval(tx, userId, groupId);
      await assertCanManageUser(tx, actor, userId, { removesRoot });
      const { count } = await tx.userGroup.deleteMany({ where: { userId, groupId } });
      if (count === 0) return false;
      await this.audit(tx, actor, "user.secondary_remove", userId, { groupId }, undefined, "user");
      return true;
    });
    if (removed) await this.changed([groupId], [`user:${userId}`]);
  }

  private authorize(actor: GcsActor): Promise<void> {
    return this.deps.acp.assert(actor, ACP_SECTION, "edit");
  }

  private async findGroup(tx: Tx, id: number): Promise<Group> {
    const group = await tx.group.findUnique({ where: { id } });
    if (!group) throw new GcsNotFound({ entity: "group" });
    return group;
  }

  private audit(
    tx: Tx,
    actor: GcsActor,
    action: string,
    targetId: number | string,
    before: unknown,
    after: unknown,
    targetType = "group",
  ): Promise<void> {
    return writeAudit(tx, { actorId: actor.userId, action, targetType, targetId: String(targetId), before, after, ip: actor.ip });
  }

  private async changed(groupIds: number[], extraTags: string[] = []): Promise<void> {
    await this.deps.permissions.bumpVersion();
    await this.deps.bus.emit({
      name: "group.updated",
      payload: { groupIds },
      tags: [...groupIds.map((id) => `group:${id}`), "name-styles", ...extraTags],
    });
  }
}

type GcsGroupData = {
  name?: string;
  title?: string | null;
  color?: string | null;
  nameStyle?: Prisma.InputJsonValue | Prisma.NullTypes.DbNull;
  isVip?: boolean;
  position?: number;
};

function validateInput(input: GcsGroupInput): GcsGroupData {
  const errors: Record<string, string> = {};
  const data: GcsGroupData = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 64) errors.name = "invalid_length";
    data.name = name;
  }
  if (input.title !== undefined) data.title = input.title?.trim() || null;
  if (input.color !== undefined) {
    if (input.color !== null && !isHexColor(input.color)) errors.color = "invalid_color";
    data.color = input.color;
  }
  if (input.nameStyle !== undefined) {
    const s = input.nameStyle;
    if (s && ((s.color !== undefined && !isHexColor(s.color)) || (s.glow !== undefined && !isHexColor(s.glow)))) {
      errors.nameStyle = "invalid_color";
    }
    if (s?.gradient && (s.gradient.length > 6 || !s.gradient.every(isHexColor))) errors.nameStyle = "invalid_color";
    data.nameStyle = s === null ? Prisma.DbNull : (s as Prisma.InputJsonValue);
  }
  if (input.isVip !== undefined) data.isVip = input.isVip;
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position)) errors.position = "invalid_type";
    data.position = input.position;
  }

  if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
  return data;
}

/** Grupul `root_admin` (setări, membri noi) poate fi modificat doar de un Root Admin (spec §6.4). */
function assertCanTouchGroup(group: Group, actor: GcsActor): void {
  if (group.key === "root_admin" && !actor.groupIds.includes(group.id)) {
    throw new GcsForbidden({ reason: "root_protected" });
  }
}

function snapshot(g: Group) {
  return {
    name: g.name,
    title: g.title,
    color: g.color,
    nameStyle: g.nameStyle,
    isVip: g.isVip,
    position: g.position,
  };
}

function toMatrix(rows: { groupId: number; action: string }[]): Record<number, string[]> {
  const matrix: Record<number, string[]> = {};
  for (const r of rows) (matrix[r.groupId] ??= []).push(r.action);
  return matrix;
}
