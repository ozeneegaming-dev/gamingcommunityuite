"use server";

import { GcsNotFound, normalizeUsername, type GcsAcpRights, type GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const SECTION = "members.acp_roles";

export async function createRole(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const role = await services().acp.createRole(field(fd, "name"), actor);
    return { id: role.id };
  });
}

export async function renameRole(roleId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().acp.renameRole(roleId, field(fd, "name"), actor);
    return null;
  });
}

/** Matricea secțiune × {view, edit, delete}: câmpurile `right:<secțiune>:<drept>`. */
export async function saveRolePermissions(roleId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const matrix: GcsAcpRights = {};
    for (const [name, value] of fd.entries()) {
      const m = /^right:(.+):(view|edit|delete)$/.exec(name);
      if (!m || value !== "on") continue;
      const section = m[1]!;
      matrix[section] ??= { view: false, edit: false, delete: false };
      matrix[section][m[2] as "view" | "edit" | "delete"] = true;
    }
    await services().acp.setRolePermissions(roleId, matrix, actor);
    return null;
  });
}

export async function assignRoleToGroup(roleId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().acp.assignRole(roleId, { groupId: intField(fd, "groupId") }, actor);
    return null;
  });
}

export async function assignRoleToUser(roleId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    const { db, acp } = services();
    const user = await db.user.findUnique({ where: { nameNormalized: normalizeUsername(field(fd, "username")) }, select: { id: true } });
    if (!user) throw new GcsNotFound({ reason: "user_not_found" });
    await acp.assignRole(roleId, { userId: user.id }, actor);
    return null;
  });
}

export async function unassignRole(assignmentId: number): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "edit", async (actor) => {
    await services().acp.unassignRole(assignmentId, actor);
    return null;
  });
}

export async function deleteRole(roleId: number): Promise<GcsResult<null>> {
  return runAcpAction(SECTION, "delete", async (actor) => {
    await services().acp.deleteRole(roleId, actor);
    return null;
  });
}
