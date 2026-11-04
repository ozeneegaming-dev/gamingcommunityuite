import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { GcsForbidden } from "../errors";
import { seedDefaults } from "../install/seed";
import type { GcsActor } from "../permissions/types";
import { GcsAcpRoleService } from "./roles";

const db = testDb();
const registry = testRegistry();
let acp: GcsAcpRoleService;
let groups: Record<string, number>;

const actor = (groupIds: number[], extra: Partial<GcsActor> = {}): GcsActor => ({
  userId: "u1",
  groupIds,
  primaryGroupId: groupIds[0] ?? 0,
  isBanned: false,
  ip: "127.0.0.1",
  ...extra,
});

beforeEach(async () => {
  await truncateAll(db);
  await seedDefaults(db, registry);
  groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id]));
  await db.user.create({
    data: { id: "u1", name: "A", nameNormalized: "a", email: "a@example.com", primaryGroupId: groups.admin! },
  });
  acp = new GcsAcpRoleService({ db, registry });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GcsAcpRoleService", () => {
  test("root_admin primește toate secțiunile din meniu", async () => {
    const rights = await acp.rights(actor([groups.root_admin!]));
    expect(rights["members.groups"]).toEqual({ view: true, edit: true, delete: true });
    expect(rights["vip.tiers"]).toEqual({ view: true, edit: true, delete: true });
  });

  test("rolurile atribuite userului și grupurilor lui se combină prin uniune", async () => {
    await db.acpRole.create({
      data: {
        name: "Manager VIP",
        permissions: { create: [{ section: "vip.tiers", canView: true, canEdit: true }] },
        assignments: { create: [{ groupId: groups.admin! }] },
      },
    });
    await db.acpRole.create({
      data: {
        name: "Vizualizare membri",
        permissions: { create: [{ section: "members.members", canView: true }] },
        assignments: { create: [{ userId: "u1" }] },
      },
    });

    const rights = await acp.rights(actor([groups.admin!]));
    expect(rights).toEqual({
      "vip.tiers": { view: true, edit: true, delete: false },
      "members.members": { view: true, edit: false, delete: false },
    });
    await expect(acp.assert(actor([groups.admin!]), "vip.tiers", "edit")).resolves.toBeUndefined();
    await expect(acp.assert(actor([groups.admin!]), "members.members", "edit")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(acp.assert(actor([groups.admin!]), "members.groups", "view")).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("un actor banat nu are niciun drept, nici root", async () => {
    await expect(acp.rights(actor([groups.root_admin!], { isBanned: true }))).resolves.toEqual({});
  });

  test("redenumirea unui rol: nume unic, rolul Root rămâne neatins", async () => {
    const root = actor([groups.root_admin!]);
    const role = await acp.createRole("Manager VIP", root);
    await acp.createRole("Moderator chat", root);
    await expect(acp.renameRole(role.id, "  Echipa VIP  ", root)).resolves.toMatchObject({ name: "Echipa VIP" });
    await expect(acp.renameRole(role.id, "Moderator chat", root)).rejects.toMatchObject({ params: { reason: "role_exists" } });
    await expect(acp.renameRole(role.id, " ", root)).rejects.toMatchObject({ fields: { name: "invalid_length" } });
    const rootRole = await db.acpRole.findFirstOrThrow({ where: { name: "Root" } });
    await expect(acp.renameRole(rootRole.id, "Altul", root)).rejects.toMatchObject({ params: { reason: "root_role_protected" } });
    await expect(acp.renameRole(role.id, "Fără drept", actor([groups.member!]))).rejects.toBeInstanceOf(GcsForbidden);
  });
});
