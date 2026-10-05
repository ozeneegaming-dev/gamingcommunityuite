import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsConflict, GcsForbidden, GcsValidationError } from "../errors";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("gestionarea rolurilor ACP", () => {
  test("creare, matrice de drepturi și atribuire pe user → drepturile se aplică", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const adminUser = await w.createUser("Admin", "admin");
    const admin = await w.actorFor(adminUser);

    const role = await w.acp.createRole("Manager VIP", root);
    await w.acp.setRolePermissions(role.id, { "vip.tiers": { view: true, edit: true, delete: false } }, root);
    await w.acp.assignRole(role.id, { userId: adminUser.id }, root);

    await expect(w.acp.rights(admin)).resolves.toEqual({ "vip.tiers": { view: true, edit: true, delete: false } });
    await expect(w.acp.can(admin, "members.members", "view")).resolves.toBe(false);
    expect(await w.db.auditLog.count({ where: { action: { startsWith: "acp.role." } } })).toBe(3);
  });

  test("atribuirea pe grup și retragerea ei", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    const role = await w.acp.createRole("Moderatori ACP", root);
    await w.acp.setRolePermissions(role.id, { "members.members": { view: true, edit: false, delete: false } }, root);
    const assignment = await w.acp.assignRole(role.id, { groupId: w.groups.admin! }, root);
    await expect(w.acp.can(admin, "members.members", "view")).resolves.toBe(true);

    await w.acp.unassignRole(assignment.id, root);
    await expect(w.acp.can(admin, "members.members", "view")).resolves.toBe(false);
  });

  test("secțiunile necunoscute sunt refuzate; numele duplicat → conflict", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const role = await w.acp.createRole("Test", root);
    await expect(
      w.acp.setRolePermissions(role.id, { "nu.exista": { view: true, edit: false, delete: false } }, root),
    ).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.acp.createRole("Test", root)).rejects.toBeInstanceOf(GcsConflict);
  });

  test("rolul Root nu poate fi modificat sau șters", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const rootRole = await w.db.acpRole.findUniqueOrThrow({ where: { name: "Root" } });
    await expect(w.acp.setRolePermissions(rootRole.id, {}, root)).rejects.toBeInstanceOf(GcsConflict);
    await expect(w.acp.deleteRole(rootRole.id, root)).rejects.toBeInstanceOf(GcsConflict);
  });

  test("fără dreptul members.acp_roles → GcsForbidden", async () => {
    await w.grantAdmin(["members.members"]);
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(w.acp.createRole("X", admin)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("listRoles întoarce rolurile cu drepturile și atribuirile lor", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const role = await w.acp.createRole("Suport", root);
    await w.acp.setRolePermissions(role.id, { "members.members": { view: true, edit: true, delete: false } }, root);
    const roles = await w.acp.listRoles();
    const suport = roles.find((r) => r.name === "Suport");
    expect(suport?.permissions).toEqual({ "members.members": { view: true, edit: true, delete: false } });
    expect(roles.find((r) => r.name === "Root")?.assignments).toEqual([
      expect.objectContaining({ groupKey: "root_admin" }),
    ]);
  });
});
