import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeUsername, seedDefaults, type GcsActor } from "@gcs/core";
import { testDbUrl, truncateAll } from "@gcs/db/test/helpers";
import { inject } from "vitest";
import { closeGcsServices, createGcsServices, type GcsServices } from "../src/services";
import { doc } from "./world";

/**
 * Un site de test cu **toate serviciile reale** (aceeași fabrică ca `web` și `gcs-worker`), pentru ștergerea și unirea
 * conturilor: pașii tuturor aplicațiilor rulează împreună, în ordinea din producție. Baza e golită și re-seed-uită la
 * fiecare `reset()`.
 */
export async function createRemovalWorld() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "gcs-removal-"));
  process.env.DATABASE_URL = testDbUrl();
  const redisUrl = new URL(inject("redisUrl"));
  redisUrl.pathname = `/${process.env.VITEST_POOL_ID ?? "1"}`;
  process.env.REDIS_URL = redisUrl.toString();
  const s: GcsServices = createGcsServices({ configDir });
  let groups: Record<string, number> = {};
  let counter = 0;

  async function reset(): Promise<void> {
    await truncateAll(s.db);
    await s.kv.flushAll();
    await seedDefaults(s.db, s.registry);
    groups = Object.fromEntries((await s.db.group.findMany()).map((g) => [g.key, g.id]));
  }

  async function actorFor(id: string): Promise<GcsActor> {
    const full = await s.db.user.findUniqueOrThrow({ where: { id }, include: { groups: true } });
    return { userId: full.id, groupIds: [full.primaryGroupId, ...full.groups.map((g) => g.groupId)], primaryGroupId: full.primaryGroupId, isBanned: false, ip: "203.0.113.5" };
  }

  /** Un membru nou (implicit în grupul Membru), ca actor. */
  async function user(name: string, group = "member"): Promise<GcsActor> {
    counter++;
    const row = await s.db.user.create({
      data: { name, nameNormalized: normalizeUsername(name), email: `${name.toLowerCase()}${counter}@mail.com`, primaryGroupId: groups[group]! },
    });
    return actorFor(row.id);
  }

  /** Un Root Admin „de sistem” (fără cont), pentru structura forumului. */
  const system = (): GcsActor => ({ userId: null, groupIds: [groups.root_admin!], primaryGroupId: groups.root_admin!, isBanned: false, ip: "203.0.113.1" });

  async function forum(name = "General"): Promise<number> {
    const category = await s.forums.create({ parentId: null, type: "CATEGORY", name: `Cat ${name}` }, system());
    return (await s.forums.create({ parentId: category.id, type: "FORUM", name }, system())).id;
  }

  /** Pauza de flood a membrului se șterge, ca testele să posteze în ritmul lor. */
  async function topic(actor: GcsActor, forumId: number, title: string, text = "Conținut", extra: { poll?: { question: string; options: string[]; multiple?: boolean } } = {}) {
    await s.kv.del(`gcs:rl:forum-post:${actor.userId}`);
    return s.topics.create(actor, { forumId, title, content: doc(text), ...(extra.poll ? { poll: { question: extra.poll.question, options: extra.poll.options, multiple: extra.poll.multiple ?? false } } : {}) });
  }

  async function reply(actor: GcsActor, topicId: number, text = "Răspuns") {
    await s.kv.del(`gcs:rl:forum-post:${actor.userId}`);
    return s.posts.reply(actor, { topicId, content: doc(text) });
  }

  return {
    s,
    reset,
    user,
    actorFor,
    system,
    forum,
    topic,
    reply,
    group: (key: string) => groups[key]!,
    async close() {
      await closeGcsServices(s);
      await rm(configDir, { recursive: true, force: true });
    },
  };
}

export type GcsRemovalWorld = Awaited<ReturnType<typeof createRemovalWorld>>;
