import os from "node:os";
import path from "node:path";
import {
  GcsAttachmentService,
  GcsContentRenderer,
  GcsFollowService,
  GcsReactionService,
  GcsReportService,
  GcsLocalFileStore,
  GcsModuleRegistry,
  GcsRedisRateLimiter,
  GcsSettingsService,
  type GcsActor,
} from "@gcs/core";
import { createWorld } from "@gcs/core/test/world";
import type { ForumType, PrismaClient } from "@gcs/db";
import { registerForumContent } from "../src/forums/content";
import { GcsForumService } from "../src/forums/forums";
import { GcsForumModerationService } from "../src/forums/moderation";
import { GcsPollService } from "../src/forums/polls";
import { GcsForumPosting } from "../src/forums/posting";
import { GcsPostService } from "../src/forums/posts";
import { GcsPrefixService } from "../src/forums/prefixes";
import { GcsForumQueries } from "../src/forums/queries";
import { GcsReadMarkerService } from "../src/forums/readMarkers";
import { GcsForumSearch } from "../src/forums/search";
import { GcsTopicService } from "../src/forums/topics";
import { createRegistry } from "../src/registry";

/** Registry-ul real: modulele din producție. */
export function realRegistry(): GcsModuleRegistry {
  return createRegistry();
}

/** Un document Tiptap cu un singur paragraf. */
export function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** Toate contoarele denormalizate, ca să fie comparate cu cele recalculate (`recountAll`). */
export async function snapshotCounters(db: PrismaClient) {
  const [forums, topics, users] = await Promise.all([
    db.forum.findMany({
      orderBy: { id: "asc" },
      select: { id: true, topicsCount: true, postsCount: true, lastPostId: true, lastTopicId: true, lastPosterId: true, lastPostAt: true },
    }),
    db.topic.findMany({
      orderBy: { id: "asc" },
      select: { id: true, repliesCount: true, firstPostId: true, lastPostId: true, lastPosterId: true, lastPostAt: true },
    }),
    db.user.findMany({ orderBy: { id: "asc" }, select: { id: true, postsCount: true, approvedPostsCount: true, solutionsCount: true } }),
  ]);
  return { forums, topics, users };
}

/**
 * Un site de test cu modulul Forum: baza cu seed-ul real, serviciile forumului și actori gata făcuți
 * (Root Admin, membru, vizitator).
 */
export async function createForumWorld() {
  const world = await createWorld([], realRegistry);
  const { db, bus, cache, permissions, registry, redis } = world;

  const settings = new GcsSettingsService({ db, cache, bus, registry });
  const rateLimiter = new GcsRedisRateLimiter(redis);
  const files = new GcsLocalFileStore(path.join(os.tmpdir(), `gcs-forum-files-${process.pid}`));
  const attachments = new GcsAttachmentService({ db, store: files, permissions, rateLimiter });
  const forums = new GcsForumService({ db, bus, permissions, acp: world.acp, registry });
  const posting = new GcsForumPosting({
    db,
    bus,
    permissions,
    settings,
    rateLimiter,
    renderer: new GcsContentRenderer(),
    attachments,
    siteHost: async () => "forum.test",
  });
  const polls = new GcsPollService(posting);
  const prefixes = new GcsPrefixService({ db, bus, acp: world.acp });
  const reactions = new GcsReactionService({ db, bus, cache, acp: world.acp });
  const reports = new GcsReportService({ db, bus, rateLimiter });
  const topics = new GcsTopicService(posting, { polls, prefixes });
  const posts = new GcsPostService(posting);
  registerForumContent(posting, { reactions, attachments, reports, posts });
  const moderation = new GcsForumModerationService(posting, { posts, reports, acp: world.acp });
  const readMarkers = new GcsReadMarkerService({ db, settings });
  const follows = new GcsFollowService({ db });
  const queries = new GcsForumQueries({ db, cache, permissions, settings, readMarkers, follows, reactions, polls });

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

  /** Șterge pauza de flood a unui user (testele postează mai des decât ar putea un om). */
  async function clearFlood(actor: GcsActor) {
    await redis.del(`gcs:rl:forum-post:${actor.userId}`);
  }

  return {
    ...world,
    settings,
    rateLimiter,
    files,
    attachments,
    forums,
    posting,
    counters: posting.counters,
    topics,
    posts,
    queries,
    readMarkers,
    follows,
    polls,
    prefixes,
    reactions,
    reports,
    moderation,
    search: new GcsForumSearch({ db, permissions, settings, rateLimiter }),
    root,
    member,
    guest,
    createTree,
    clearFlood,
  };
}

export type GcsForumWorld = Awaited<ReturnType<typeof createForumWorld>>;
