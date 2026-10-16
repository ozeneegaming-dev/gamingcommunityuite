import { isSafeBanner } from "./banner";
import { Prisma, type Group, type PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import { GROUP_MENTION_KEYS, GROUP_MENTION_LIMITS, GROUP_MENTION_NEVER, GROUP_MENTION_SETTING, toMentionGroups, type GcsGroupMentionSettings } from "./mentions";
import { isHexColor, type GcsNameStyle } from "./nameStyles";
import { staffGroupIds } from "../members/directory";
import { assertCanManageUser, losesRootOnPrimaryChange, losesRootOnSecondaryRemoval, rootUsersWhere } from "./rootGuard";

export type GcsGroupInput = {
  name?: string;
  title?: string | null;
  color?: string | null;
  nameStyle?: GcsNameStyle | null;
  isVip?: boolean;
  position?: number;
  /** Etapa 5: iconița Font Awesome (postbit, legenda), banner-ul din postbit și apariția în legendă. */
  icon?: string | null;
  banner?: string | null;
  inLegend?: boolean;
  /** Membri v2: grup public (opt-in), la care membrii se înscriu singuri; doar grupurile eligibile (`optInBlocked`). */
  optIn?: boolean;
};

/** Opțiunile unui grup secundar dat din ACP sau de o aplicație (Membri v2). */
export type GcsSecondaryOptions = {
  /** Expirarea (în viitor); `null` = fără expirare; lipsă = neschimbată (la un grup deja avut). */
  expiresAt?: Date | null;
  /** Sursa (`manual`, `store`, `servers`…): o cheie scurtă. */
  source?: string;
};

/** Câți membri primește cel mult o acțiune în masă. */
export const BULK_MAX = 500;
/** Expirarea cea mai îndepărtată a unui grup temporar (10 ani). */
const MAX_EXPIRY_MS = 3650 * 86_400_000;
const SOURCE_RE = /^[a-z][a-z0-9_]{0,31}$/;

function validExpiry(value: Date | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const t = value.getTime();
  if (!Number.isFinite(t) || t <= Date.now() || t > Date.now() + MAX_EXPIRY_MS) throw new GcsValidationError({ expiresAt: "invalid_range" });
  return value;
}

function validSource(source: string): string {
  if (!SOURCE_RE.test(source)) throw new GcsValidationError({ source: "invalid_choice" });
  return source;
}

const sameDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Grupurile care nu pot fi publice (opt-in): cele protejate (staff, Membru, Banat, Vizitator), VIP și orice grup cu acces
 * la moderare sau la ACP. Întoarce motivul sau `null`.
 */
export function optInBlocked(group: Pick<Group, "id" | "isProtected" | "isVip">, staffIds: readonly number[]): string | null {
  if (group.isProtected) return "group_protected";
  if (group.isVip) return "group_vip";
  if (staffIds.includes(group.id)) return "group_staff";
  return null;
}

/** Forma unei iconițe Font Awesome (`fa-solid fa-crown`); existența ei o verifică ACP-ul cu registrul de iconițe. */
const ICON_NAME = /^fa-(?:solid|regular|brands) fa-[a-z0-9-]{1,50}$/;

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
    if (data.optIn && data.isVip) throw new GcsValidationError({ optIn: "group_vip" });
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
      // Un grup nou pornește cu drepturile unui membru obișnuit (setările de grup și
      // permisiunile pe containere ale grupului „member”), apoi adminul le ajustează.
      const template = await tx.group.findUnique({ where: { key: "member" }, select: { id: true } });
      if (template) {
        // Fără setările de mențiune: un grup nou nu poate fi menționat până nu o permite adminul.
        const settings = await tx.groupSetting.findMany({
          where: { groupId: template.id, key: { notIn: [...GROUP_MENTION_KEYS] } },
          select: { key: true, value: true },
        });
        await tx.groupSetting.createMany({
          data: settings.map((s) => ({ groupId: group.id, key: s.key, value: s.value as Prisma.InputJsonValue })),
        });
        const containers = await tx.containerPermission.findMany({
          where: { groupId: template.id },
          select: { containerType: true, containerId: true, action: true },
        });
        await tx.containerPermission.createMany({ data: containers.map((c) => ({ ...c, groupId: group.id })) });
      }
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
      if (data.optIn === true) {
        const blocked = optInBlocked(before, await staffGroupIds(tx));
        if (blocked) throw new GcsValidationError({ optIn: blocked });
      }
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

  /**
   * Secțiunea „Mențiuni” a grupului (specul 2026-10-10-mentiuni-v2): poate fi menționat, cine îl poate menționa,
   * notificarea membrilor, câți membri cel mult și pauza dintre mențiuni. Vizitatorii și Banat nu pot fi activați.
   */
  async setMentionSettings(groupId: number, input: GcsGroupMentionSettings, actor: GcsActor): Promise<GcsGroupMentionSettings> {
    await this.authorize(actor);
    const errors: Record<string, string> = {};
    const { notifyLimit: nl, cooldownMinutes: cd } = GROUP_MENTION_LIMITS;
    if (!Number.isInteger(input.notifyLimit) || input.notifyLimit < nl.min || input.notifyLimit > nl.max) errors.notifyLimit = "invalid_range";
    if (!Number.isInteger(input.cooldownMinutes) || input.cooldownMinutes < cd.min || input.cooldownMinutes > cd.max) errors.cooldownMinutes = "invalid_range";
    if (!Array.isArray(input.allowedGroupIds) || !input.allowedGroupIds.every(Number.isInteger)) errors.allowedGroupIds = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const next: GcsGroupMentionSettings = {
      enabled: input.enabled === true,
      allowedGroupIds: [...new Set(input.allowedGroupIds)].sort((a, b) => a - b),
      notify: input.notify === true,
      notifyLimit: input.notifyLimit,
      cooldownMinutes: input.cooldownMinutes,
    };

    await this.deps.db.$transaction(async (tx) => {
      const group = await this.findGroup(tx, groupId);
      assertCanTouchGroup(group, actor);
      if (next.enabled && GROUP_MENTION_NEVER.includes(group.key)) throw new GcsValidationError({ enabled: "not_mentionable" });
      const all = await tx.group.findMany({ select: { id: true, key: true, name: true, color: true, icon: true, inLegend: true } });
      const known = new Set(all.map((g) => g.id));
      if (!next.allowedGroupIds.every((id) => known.has(id))) throw new GcsValidationError({ allowedGroupIds: "invalid_choice" });
      const rows = await tx.groupSetting.findMany({ where: { groupId, key: { in: [...GROUP_MENTION_KEYS] } }, select: { groupId: true, key: true, value: true } });
      const before = toMentionGroups(all, rows).find((g) => g.id === groupId)!.settings;
      const values: Record<string, Prisma.InputJsonValue> = {
        [GROUP_MENTION_SETTING.enabled]: next.enabled,
        [GROUP_MENTION_SETTING.allowedGroups]: next.allowedGroupIds,
        [GROUP_MENTION_SETTING.notify]: next.notify,
        [GROUP_MENTION_SETTING.notifyLimit]: next.notifyLimit,
        [GROUP_MENTION_SETTING.cooldownMinutes]: next.cooldownMinutes,
      };
      for (const [key, value] of Object.entries(values)) {
        await tx.groupSetting.upsert({ where: { groupId_key: { groupId, key } }, create: { groupId, key, value }, update: { value } });
      }
      await this.audit(tx, actor, "group.mentions", groupId, before, next);
    });
    await this.changed([groupId]);
    return next;
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
    if (oldGroupId !== null) {
      await this.changed([oldGroupId, groupId], [`user:${userId}`]);
      await this.userGroupsChanged(userId);
    }
  }

  /**
   * Adaugă un grup secundar (Membri v2: cu expirare opțională și sursa). Dacă membrul îl are deja, se actualizează doar
   * expirarea dată (prelungire sau „fără expirare” cu `null`). Întoarce `true` dacă s-a schimbat ceva.
   */
  async addSecondary(userId: string, groupId: number, actor: GcsActor, opts: GcsSecondaryOptions = {}): Promise<boolean> {
    await this.authorize(actor);
    const expiresAt = validExpiry(opts.expiresAt);
    const source = validSource(opts.source ?? "manual");
    const added = await this.deps.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new GcsNotFound({ entity: "user" });
      assertCanTouchGroup(await this.findGroup(tx, groupId), actor);
      await assertCanManageUser(tx, actor, userId);
      if (user.primaryGroupId === groupId) return false;
      const existing = await tx.userGroup.findUnique({ where: { userId_groupId: { userId, groupId } } });
      if (existing) {
        if (opts.expiresAt === undefined || sameDate(existing.expiresAt, expiresAt ?? null)) return false;
        await tx.userGroup.update({ where: { userId_groupId: { userId, groupId } }, data: { expiresAt: expiresAt ?? null } });
        await this.audit(tx, actor, "user.secondary_expiry", userId, { groupId, expiresAt: existing.expiresAt }, { groupId, expiresAt: expiresAt ?? null }, "user");
        return true;
      }
      await tx.userGroup.create({ data: { userId, groupId, source, expiresAt: expiresAt ?? null, addedById: actor.userId } });
      await this.audit(tx, actor, "user.secondary_add", userId, undefined, { groupId, source, expiresAt: expiresAt ?? null }, "user");
      return true;
    });
    if (added) {
      await this.changed([groupId], [`user:${userId}`]);
      await this.userGroupsChanged(userId);
    }
    return added;
  }

  /** Schimbă expirarea unui grup secundar existent (`null` = permanent). */
  async setSecondaryExpiry(userId: string, groupId: number, expiresAt: Date | null, actor: GcsActor): Promise<void> {
    const exists = await this.deps.db.userGroup.findUnique({ where: { userId_groupId: { userId, groupId } }, select: { userId: true } });
    if (!exists) throw new GcsNotFound({ entity: "user_group" });
    await this.addSecondary(userId, groupId, actor, { expiresAt });
  }

  async removeSecondary(userId: string, groupId: number, actor: GcsActor): Promise<boolean> {
    await this.authorize(actor);
    const removed = await this.deps.db.$transaction(async (tx) => {
      const removesRoot = await losesRootOnSecondaryRemoval(tx, userId, groupId);
      await assertCanManageUser(tx, actor, userId, { removesRoot });
      const { count } = await tx.userGroup.deleteMany({ where: { userId, groupId } });
      if (count === 0) return false;
      await this.audit(tx, actor, "user.secondary_remove", userId, { groupId }, undefined, "user");
      return true;
    });
    if (removed) {
      await this.changed([groupId], [`user:${userId}`]);
      await this.userGroupsChanged(userId);
    }
    return removed;
  }

  /**
   * Acțiunile în masă din ACP → Membri (Membri v2): același grup adăugat / scos ca secundar sau dat ca principal pentru mai
   * mulți membri. Fiecare membru trece prin aceleași verificări (protecția Root, ultimul Root); cei refuzați se numără în
   * `skipped`, restul se aplică. Cel mult `BULK_MAX` membri pe apel.
   */
  async bulk(
    userIds: string[],
    op: { kind: "add_secondary"; groupId: number; expiresAt?: Date | null } | { kind: "remove_secondary"; groupId: number } | { kind: "set_primary"; groupId: number },
    actor: GcsActor,
  ): Promise<{ changed: number; skipped: number }> {
    await this.authorize(actor);
    const ids = [...new Set(userIds)];
    if (ids.length === 0 || ids.length > BULK_MAX) throw new GcsValidationError({ userIds: "invalid_range" }, { max: String(BULK_MAX) });
    await this.deps.db.$transaction(async (tx) => assertCanTouchGroup(await this.findGroup(tx, op.groupId), actor));
    if (op.kind === "add_secondary") validExpiry(op.expiresAt);
    let changed = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        const did =
          op.kind === "add_secondary"
            ? await this.addSecondary(id, op.groupId, actor, op.expiresAt !== undefined ? { expiresAt: op.expiresAt } : {})
            : op.kind === "remove_secondary"
              ? await this.removeSecondary(id, op.groupId, actor)
              : await this.setPrimaryChanged(id, op.groupId, actor);
        if (did) changed++;
        else skipped++;
      } catch (error) {
        if (error instanceof GcsForbidden || error instanceof GcsConflict || error instanceof GcsNotFound) skipped++;
        else throw error;
      }
    }
    return { changed, skipped };
  }

  private async setPrimaryChanged(userId: string, groupId: number, actor: GcsActor): Promise<boolean> {
    const before = await this.deps.db.user.findUnique({ where: { id: userId }, select: { primaryGroupId: true } });
    if (!before) throw new GcsNotFound({ entity: "user" });
    if (before.primaryGroupId === groupId) return false;
    await this.setPrimary(userId, groupId, actor);
    return true;
  }

  /**
   * Jobul `groups.secondary_expiry` (Membri v2): scoate grupurile secundare temporare ajunse la expirare, scrie jurnalul și
   * emite `group.secondary_expired` pentru fiecare (notificarea membrului). Fără actor: e o operație a sistemului. Un
   * Root Admin nu-și pierde ultimul acces Root așa (rândul rămâne și se reîncearcă după ce mai există un Root).
   */
  async expireSecondary(now = new Date(), limit = 500): Promise<{ userId: string; groupId: number }[]> {
    const { db, bus } = this.deps;
    const due = await db.userGroup.findMany({
      where: { expiresAt: { lte: now } },
      select: { userId: true, groupId: true, expiresAt: true, source: true, group: { select: { name: true } } },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
    const removed: { userId: string; groupId: number }[] = [];
    for (const row of due) {
      const ok = await db.$transaction(async (tx) => {
        if (await losesRootOnSecondaryRemoval(tx, row.userId, row.groupId)) {
          const rootId = (await tx.group.findUniqueOrThrow({ where: { key: "root_admin" }, select: { id: true } })).id;
          if ((await tx.user.count({ where: rootUsersWhere(rootId) })) <= 1) return false;
        }
        const { count } = await tx.userGroup.deleteMany({ where: { userId: row.userId, groupId: row.groupId, expiresAt: { lte: now } } });
        if (count === 0) return false;
        await writeAudit(tx, { actorId: null, action: "user.secondary_expired", targetType: "user", targetId: row.userId, before: { groupId: row.groupId, expiresAt: row.expiresAt, source: row.source } });
        return true;
      });
      if (!ok) continue;
      removed.push({ userId: row.userId, groupId: row.groupId });
      await bus.emit({ name: "group.secondary_expired", payload: { userId: row.userId, groupId: row.groupId, groupName: row.group.name }, tags: [`user:${row.userId}`] });
      await this.userGroupsChanged(row.userId);
    }
    if (removed.length > 0) await this.changed([...new Set(removed.map((r) => r.groupId))], removed.map((r) => `user:${r.userId}`));
    return removed;
  }

  /** Ordinea grupurilor (ACP → Grupuri, drag & drop): `order` conține toate grupurile, în ordinea nouă. */
  async reorder(order: number[], actor: GcsActor): Promise<void> {
    await this.authorize(actor);
    await this.deps.db.$transaction(async (tx) => {
      const groups = await tx.group.findMany({ select: { id: true, position: true }, orderBy: { position: "asc" } });
      const ids = new Set(groups.map((g) => g.id));
      if (order.length !== ids.size || new Set(order).size !== order.length || !order.every((id) => ids.has(id))) {
        throw new GcsValidationError({ order: "invalid_order" });
      }
      for (const [position, id] of order.entries()) await tx.group.update({ where: { id }, data: { position } });
      await this.audit(tx, actor, "group.reorder", "all", groups.map((g) => g.id), order);
    });
    await this.changed(order);
  }

  /** Moștenirea pe container: cu `inherits`, containerul folosește permisiunile părintelui. */
  async setContainerInherit(
    containerType: string,
    containerId: string,
    input: { parentId: string | null; inherits: boolean },
    actor: GcsActor,
  ): Promise<void> {
    await this.authorize(actor);
    if (input.inherits && !input.parentId) throw new GcsValidationError({ parentId: "required" });
    const where = { containerType_containerId: { containerType, containerId } };
    await this.deps.db.$transaction(async (tx) => {
      const before = await tx.containerInherit.findUnique({ where });
      const data = { parentId: input.parentId, inherits: input.inherits };
      await tx.containerInherit.upsert({ where, create: { containerType, containerId, ...data }, update: data });
      await this.audit(
        tx,
        actor,
        "container.inherit",
        `${containerType}:${containerId}`,
        before ? { parentId: before.parentId, inherits: before.inherits } : undefined,
        data,
        "container",
      );
    });
    await this.changed([], [`container:${containerType}:${containerId}`]);
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

  /** Grupurile unui user s-au schimbat: modulele reacționează (ex. cosmeticele care nu mai sunt permise, etapa 3). */
  private async userGroupsChanged(userId: string): Promise<void> {
    await this.deps.bus.emit({ name: "user.groups_changed", payload: { userId }, tags: [`user:${userId}`] });
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
  icon?: string | null;
  banner?: string | null;
  inLegend?: boolean;
  optIn?: boolean;
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
  if (input.icon !== undefined) {
    if (input.icon !== null && !ICON_NAME.test(input.icon)) errors.icon = "invalid_choice";
    data.icon = input.icon;
  }
  if (input.banner !== undefined) {
    if (input.banner !== null && !isSafeBanner(input.banner)) errors.banner = "invalid_color";
    data.banner = input.banner;
  }
  if (input.inLegend !== undefined) data.inLegend = input.inLegend;
  if (input.optIn !== undefined) data.optIn = input.optIn;
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
    icon: g.icon,
    banner: g.banner,
    inLegend: g.inLegend,
    optIn: g.optIn,
    position: g.position,
  };
}

function toMatrix(rows: { groupId: number; action: string }[]): Record<number, string[]> {
  const matrix: Record<number, string[]> = {};
  for (const r of rows) (matrix[r.groupId] ??= []).push(r.action);
  return matrix;
}
