import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { GcsAcpRoleService } from "../src/acp/roles";
import { GcsActorResolver } from "../src/auth/actor";
import { normalizeUsername } from "../src/auth/usernames";
import { GcsCache } from "../src/cache";
import { GcsEventBus, type GcsEvent } from "../src/events";
import { GcsGroupService } from "../src/groups/service";
import type { GcsModule, GcsModuleRegistry } from "../src/modules/registry";
import { seedDefaults } from "../src/install/seed";
import { GcsBanService } from "../src/moderation/bans";
import { GcsWarningService } from "../src/moderation/warnings";
import { GcsPermissionService } from "../src/permissions/service";
import type { GcsActor } from "../src/permissions/types";
import { testRegistry } from "./fixtures";
import { testKv } from "./kv";

/**
 * Un „site” complet pentru testele de integrare din `core`: baza cu seed-ul implicit, cheile (`GcsKv`, Redis sau SQL),
 * serviciile legate între ele și helperi pentru useri și actori. `extraModules` se înregistrează înainte de seed;
 * `makeRegistry` înlocuiește registry-ul de test (ex. `@gcs/modules` folosește modulele reale).
 */
export async function createWorld(extraModules: GcsModule[] = [], makeRegistry: () => GcsModuleRegistry = testRegistry) {
  const db = testDb();
  const kv = testKv();
  await truncateAll(db);
  await kv.flushAll();

  const registry = makeRegistry();
  for (const m of extraModules) registry.register(m);
  await seedDefaults(db, registry);
  const groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id])) as Record<string, number>;

  const cache = new GcsCache(kv);
  const bus = new GcsEventBus({ cache });
  const events: GcsEvent[] = [];
  for (const name of ["user.banned", "user.unbanned", "user.warned", "user.warning_action", "user.warning_revoked", "warning.appealed", "warning.appeal_decided", "group.updated"]) {
    bus.on(name, async (e) => {
      events.push(e);
    });
  }

  const permissions = new GcsPermissionService({ db, cache, bus, registry });
  const acp = new GcsAcpRoleService({ db, registry });
  const groupService = new GcsGroupService({ db, bus, permissions, acp });
  const bans = new GcsBanService({ db, cache, bus, acp });
  const warnings = new GcsWarningService({ db, bus, acp, bans });
  const actors = new GcsActorResolver({ db, cache });

  let counter = 0;
  async function createUser(name: string, primaryGroup: string, secondary: string[] = []) {
    counter++;
    return db.user.create({
      data: {
        name,
        nameNormalized: normalizeUsername(name),
        email: `${name.toLowerCase()}${counter}@mail.com`,
        primaryGroupId: groups[primaryGroup]!,
        groups: { create: secondary.map((g) => ({ groupId: groups[g]! })) },
      },
    });
  }

  async function actorFor(user: { id: string }, ip = "203.0.113.1"): Promise<GcsActor> {
    const full = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { groups: true } });
    return {
      userId: full.id,
      groupIds: [full.primaryGroupId, ...full.groups.map((g) => g.groupId)],
      primaryGroupId: full.primaryGroupId,
      isBanned: false,
      ip,
    };
  }

  /** Un rol ACP cu drept complet pe secțiunile date, atribuit grupului `admin`. */
  async function grantAdmin(sections: string[]) {
    await db.acpRole.create({
      data: {
        name: `Admin ${sections.join(",")}`,
        permissions: { create: sections.map((section) => ({ section, canView: true, canEdit: true, canDelete: true })) },
        assignments: { create: [{ groupId: groups.admin! }] },
      },
    });
  }

  return {
    db,
    kv,
    registry,
    groups,
    cache,
    bus,
    events,
    permissions,
    acp,
    groupService,
    bans,
    warnings,
    actors,
    createUser,
    actorFor,
    grantAdmin,
  };
}

export type GcsTestWorld = Awaited<ReturnType<typeof createWorld>>;
