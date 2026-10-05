import type { PrismaClient } from "@gcs/db";
import { GcsForbidden } from "../errors";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";

export type GcsAcpRight = "view" | "edit" | "delete";
export type GcsAcpSectionRights = { view: boolean; edit: boolean; delete: boolean };
export type GcsAcpRights = Record<string, GcsAcpSectionRights>;

/**
 * Drepturile de staff în ACP (spec §6.4): o matrice secțiune × {view, edit, delete},
 * din rolurile atribuite userului și grupurilor lui, combinate prin uniune. `root_admin` are tot.
 */
export class GcsAcpRoleService {
  constructor(private readonly deps: { db: PrismaClient; registry: GcsModuleRegistry }) {}

  async rights(actor: GcsActor): Promise<GcsAcpRights> {
    if (actor.isBanned) return {};
    const groups = await this.deps.db.group.findMany({ where: { id: { in: actor.groupIds } }, select: { key: true } });
    if (groups.some((g) => g.key === "banned")) return {};

    if (groups.some((g) => g.key === "root_admin")) {
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

  async can(actor: GcsActor, section: string, right: GcsAcpRight): Promise<boolean> {
    const rights = await this.rights(actor);
    return rights[section]?.[right] ?? false;
  }

  /** Aruncă `GcsForbidden` dacă actorul nu are dreptul `right` pe secțiunea ACP `section`. */
  async assert(actor: GcsActor, section: string, right: GcsAcpRight): Promise<void> {
    if (!(await this.can(actor, section, right))) throw new GcsForbidden({ section, right });
  }
}
