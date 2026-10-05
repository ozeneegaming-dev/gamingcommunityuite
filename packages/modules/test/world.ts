import { GcsModuleRegistry, type GcsActor } from "@gcs/core";
import { createWorld } from "@gcs/core/test/world";
import type { ForumType } from "@gcs/db";
import { coreModule } from "../src/core-module";
import { forumsModule } from "../src/forums";
import { GcsForumService } from "../src/forums/forums";

/** Registry-ul real: modulele din producție. */
export function realRegistry(): GcsModuleRegistry {
  const registry = new GcsModuleRegistry();
  registry.register(coreModule);
  registry.register(forumsModule);
  return registry;
}

/**
 * Un site de test cu modulul Forum: baza cu seed-ul real, serviciile forumului și actori gata făcuți
 * (Root Admin, membru, vizitator).
 */
export async function createForumWorld() {
  const world = await createWorld([], realRegistry);
  const forums = new GcsForumService({
    db: world.db,
    bus: world.bus,
    permissions: world.permissions,
    acp: world.acp,
    registry: world.registry,
  });

  const root = await world.actorFor(await world.createUser("Fondator", "root_admin"));
  const member = await world.actorFor(await world.createUser("Mara", "member"));
  const guest: GcsActor = {
    userId: null,
    groupIds: [world.groups.guest!],
    primaryGroupId: world.groups.guest!,
    isBanned: false,
    ip: "203.0.113.50",
  };

  /** Creează o categorie cu un forum (și, opțional, un subforum), ca Root Admin. */
  async function createTree(opts: { subforum?: boolean; type?: ForumType } = {}) {
    const category = await forums.create({ parentId: null, type: "CATEGORY", name: "Servere de joc" }, root);
    const forum = await forums.create({ parentId: category.id, type: opts.type ?? "FORUM", name: "Counter-Strike 2" }, root);
    const subforum = opts.subforum ? await forums.create({ parentId: forum.id, type: "FORUM", name: "Configuri" }, root) : null;
    return { category, forum, subforum };
  }

  return { ...world, forums, root, member, guest, createTree };
}

export type GcsForumWorld = Awaited<ReturnType<typeof createForumWorld>>;
