import type { AcpRole, AcpRoleAssignment, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export type GcsAcpRight = "view" | "edit" | "delete";
export type GcsAcpSectionRights = { view: boolean; edit: boolean; delete: boolean };
export type GcsAcpRights = Record<string, GcsAcpSectionRights>;

/** Rolul creat la instalare, cu toate drepturile; nu se poate modifica sau șterge. */
const ROOT_ROLE = "Root";
/** Secțiunea ACP care dă dreptul de a gestiona rolurile (Staff → Administratori și roluri ACP). */
const ROLES_SECTION = "members.acp_roles";

export type GcsAcpRoleView = {
  id: number;
  name: string;
  isRoot: boolean;
  permissions: GcsAcpRights;
  assignments: { id: number; userId: string | null; userName: string | null; groupId: number | null; groupKey: string | null; groupName: string | null }[];
};

/**
 * Drepturile de staff în ACP (spec §6.4): o matrice secțiune × {view, edit, delete},
 * din rolurile atribuite userului și grupurilor lui, combinate prin uniune. `root_admin` are tot.
 */
export class GcsAcpRoleService {
  constructor(private readonly deps: { db: PrismaClient; registry: GcsModuleRegistry }) {}

  /** `root` = actorul e Root Admin; `banned` = banat (fără niciun drept). */
  private async status(actor: GcsActor): Promise<"root" | "banned" | "staff"> {
    if (actor.isBanned) return "banned";
    const groups = await this.deps.db.group.findMany({ where: { id: { in: actor.groupIds } }, select: { key: true } });
    if (groups.some((g) => g.key === "banned")) return "banned";
    return groups.some((g) => g.key === "root_admin") ? "root" : "staff";
  }

  async rights(actor: GcsActor): Promise<GcsAcpRights> {
    const status = await this.status(actor);
    if (status === "banned") return {};

    if (status === "root") {
      const all: GcsAcpRights = {};
      for (const section of this.deps.registry.acpMenu()) {
        for (const item of section.items) all[item.section] = { view: true, edit: true, delete: true };
      }
      return all;
    }

    const or: ({ groupId: { in: number[] } } | { userId: string })[] = [{ groupId: { in: actor.groupIds } }];
    if (actor.userId) or.push({ userId: actor.userId });
    const rows = await this.deps.db.acpRolePermission.findMany({
      where: { role: { assignments: { some: { OR: or } } } },
      select: { section: true, canView: true, canEdit: true, canDelete: true },
    });

    const rights: GcsAcpRights = {};
    for (const r of rows) {
      const current = rights[r.section] ?? { view: false, edit: false, delete: false };
      rights[r.section] = {
        view: current.view || r.canView,
        edit: current.edit || r.canEdit,
        delete: current.delete || r.canDelete,
      };
    }
    return rights;
  }

  /** Root Admin are orice drept, inclusiv pe secțiuni care nu apar (încă) în meniu. */
  async can(actor: GcsActor, section: string, right: GcsAcpRight): Promise<boolean> {
    const status = await this.status(actor);
    if (status === "banned") return false;
    if (status === "root") return true;
    const rights = await this.rights(actor);
    return rights[section]?.[right] ?? false;
  }

  /** Numele rolurilor ACP ale actorului (atribuite lui sau grupurilor lui); Root Admin are mereu rolul Root. */
  async roleNames(actor: GcsActor): Promise<string[]> {
    const status = await this.status(actor);
    if (status === "banned") return [];
    const or: ({ groupId: { in: number[] } } | { userId: string })[] = [{ groupId: { in: actor.groupIds } }];
    if (actor.userId) or.push({ userId: actor.userId });
    const roles = await this.deps.db.acpRole.findMany({
      where: { assignments: { some: { OR: or } } },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    const names = roles.map((r) => r.name);
    return status === "root" && !names.includes(ROOT_ROLE) ? [ROOT_ROLE, ...names] : names;
  }

  /** Aruncă `GcsForbidden` dacă actorul nu are dreptul `right` pe secțiunea ACP `section`. */
  async assert(actor: GcsActor, section: string, right: GcsAcpRight): Promise<void> {
    if (!(await this.can(actor, section, right))) throw new GcsForbidden({ section, right });
  }

  // ─── Gestionarea rolurilor (ACP → Staff → Administratori și roluri ACP) ───

  /**
   * Membrii cu un drept pe o secțiune (Root Admin + rolurile atribuite direct sau prin grup), pentru alertele staff-ului.
   * Conturile-bot nu intră.
   */
  async usersWith(section: string, right: GcsAcpRight = "view", limit = 100): Promise<string[]> {
    const { db } = this.deps;
    const flag = right === "view" ? { canView: true } : right === "edit" ? { canEdit: true } : { canDelete: true };
    const [assignments, root] = await Promise.all([
      db.acpRoleAssignment.findMany({ where: { role: { permissions: { some: { section, ...flag } } } }, select: { userId: true, groupId: true } }),
      db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } }),
    ]);
    const groupIds = [...assignments.map((a) => a.groupId).filter((id): id is number => id !== null), ...(root ? [root.id] : [])];
    const userIds = assignments.map((a) => a.userId).filter((id): id is string => id !== null);
    const users = await db.user.findMany({
      where: { isBot: false, OR: [{ id: { in: userIds } }, { primaryGroupId: { in: groupIds } }, { groups: { some: { groupId: { in: groupIds } } } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return users.map((u) => u.id);
  }

  /** Secțiunile ACP cunoscute (din meniurile modulelor), în ordinea meniului. */
  sections(): string[] {
    return [...new Set(this.deps.registry.acpMenu().flatMap((s) => s.items.map((i) => i.section)))];
  }

  async listRoles(): Promise<GcsAcpRoleView[]> {
    const roles = await this.deps.db.acpRole.findMany({
      orderBy: { id: "asc" },
      include: {
        permissions: true,
        assignments: { include: { user: { select: { name: true } }, group: { select: { key: true, name: true } } } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      isRoot: r.name === ROOT_ROLE,
      permissions: Object.fromEntries(
        r.permissions.map((p) => [p.section, { view: p.canView, edit: p.canEdit, delete: p.canDelete }]),
      ),
      assignments: r.assignments.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: a.user?.name ?? null,
        groupId: a.groupId,
        groupKey: a.group?.key ?? null,
        groupName: a.group?.name ?? null,
      })),
    }));
  }

  async createRole(name: string, actor: GcsActor): Promise<AcpRole> {
    await this.assert(actor, ROLES_SECTION, "edit");
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 64) throw new GcsValidationError({ name: "invalid_length" });
    const { db } = this.deps;
    if (await db.acpRole.findUnique({ where: { name: clean } })) throw new GcsConflict({ reason: "role_exists" });
    return db.$transaction(async (tx) => {
      const role = await tx.acpRole.create({ data: { name: clean } });
      await writeAudit(tx, { actorId: actor.userId, action: "acp.role.create", targetType: "acp_role", targetId: String(role.id), after: { name: clean }, ip: actor.ip });
      return role;
    });
  }

  /** Schimbă numele unui rol (rolul Root nu se redenumește; numele rămân unice). */
  async renameRole(roleId: number, name: string, actor: GcsActor): Promise<AcpRole> {
    await this.assert(actor, ROLES_SECTION, "edit");
    const role = await this.editableRole(roleId);
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 64) throw new GcsValidationError({ name: "invalid_length" });
    if (clean === role.name) return role;
    const { db } = this.deps;
    const other = await db.acpRole.findUnique({ where: { name: clean } });
    if (other && other.id !== roleId) throw new GcsConflict({ reason: "role_exists" });
    return db.$transaction(async (tx) => {
      const renamed = await tx.acpRole.update({ where: { id: roleId }, data: { name: clean } });
      await writeAudit(tx, { actorId: actor.userId, action: "acp.role.rename", targetType: "acp_role", targetId: String(roleId), before: { name: role.name }, after: { name: clean }, ip: actor.ip });
      return renamed;
    });
  }

  /** Înlocuiește matricea secțiune × {view, edit, delete} a unui rol. `edit`/`delete` implică `view`. */
  async setRolePermissions(roleId: number, matrix: GcsAcpRights, actor: GcsActor): Promise<void> {
    await this.assert(actor, ROLES_SECTION, "edit");
    const role = await this.editableRole(roleId);
    const known = new Set(this.sections());
    const unknown = Object.keys(matrix).filter((s) => !known.has(s));
    if (unknown.length > 0) throw new GcsValidationError(Object.fromEntries(unknown.map((s) => [s, "unknown_section"])));

    const rows = Object.entries(matrix)
      .filter(([, r]) => r.view || r.edit || r.delete)
      .map(([section, r]) => ({ roleId, section, canView: true, canEdit: r.edit, canDelete: r.delete }));
    await this.deps.db.$transaction(async (tx) => {
      const before = await tx.acpRolePermission.findMany({ where: { roleId } });
      await tx.acpRolePermission.deleteMany({ where: { roleId } });
      await tx.acpRolePermission.createMany({ data: rows });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "acp.role.permissions",
        targetType: "acp_role",
        targetId: String(role.id),
        before: Object.fromEntries(before.map((p) => [p.section, { view: p.canView, edit: p.canEdit, delete: p.canDelete }])),
        after: Object.fromEntries(rows.map((p) => [p.section, { view: p.canView, edit: p.canEdit, delete: p.canDelete }])),
        ip: actor.ip,
      });
    });
  }

  async assignRole(roleId: number, target: { userId: string } | { groupId: number }, actor: GcsActor): Promise<AcpRoleAssignment> {
    await this.assert(actor, ROLES_SECTION, "edit");
    const role = await this.editableRole(roleId);
    const { db } = this.deps;
    if ("userId" in target) {
      if (!(await db.user.findUnique({ where: { id: target.userId }, select: { id: true } }))) throw new GcsNotFound({ entity: "user" });
    } else if (!(await db.group.findUnique({ where: { id: target.groupId }, select: { id: true } }))) {
      throw new GcsNotFound({ entity: "group" });
    }
    const existing = await db.acpRoleAssignment.findFirst({ where: { roleId, ...target } });
    if (existing) return existing;
    return db.$transaction(async (tx) => {
      const assignment = await tx.acpRoleAssignment.create({ data: { roleId, ...target } });
      await writeAudit(tx, { actorId: actor.userId, action: "acp.role.assign", targetType: "acp_role", targetId: String(role.id), after: target, ip: actor.ip });
      return assignment;
    });
  }

  async unassignRole(assignmentId: number, actor: GcsActor): Promise<void> {
    await this.assert(actor, ROLES_SECTION, "edit");
    const { db } = this.deps;
    const assignment = await db.acpRoleAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new GcsNotFound({ entity: "acp_role_assignment" });
    await this.editableRole(assignment.roleId);
    await db.$transaction(async (tx) => {
      await tx.acpRoleAssignment.delete({ where: { id: assignmentId } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "acp.role.unassign",
        targetType: "acp_role",
        targetId: String(assignment.roleId),
        before: { userId: assignment.userId, groupId: assignment.groupId },
        ip: actor.ip,
      });
    });
  }

  async deleteRole(roleId: number, actor: GcsActor): Promise<void> {
    await this.assert(actor, ROLES_SECTION, "delete");
    const role = await this.editableRole(roleId);
    await this.deps.db.$transaction(async (tx) => {
      await tx.acpRole.delete({ where: { id: roleId } });
      await writeAudit(tx, { actorId: actor.userId, action: "acp.role.delete", targetType: "acp_role", targetId: String(roleId), before: { name: role.name }, ip: actor.ip });
    });
  }

  private async editableRole(roleId: number): Promise<AcpRole> {
    const role = await this.deps.db.acpRole.findUnique({ where: { id: roleId } });
    if (!role) throw new GcsNotFound({ entity: "acp_role" });
    if (role.name === ROOT_ROLE) throw new GcsConflict({ reason: "root_role_protected" });
    return role;
  }
}
