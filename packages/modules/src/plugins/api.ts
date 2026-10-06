import type { GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { docSnippet } from "../content-text";
import { canViewPost } from "../forums/content";
import type { GcsForumPosting } from "../forums/posting";
import type { GcsForumQueries } from "../forums/queries";
import { slugify } from "../forums/slug";

const topicUrl = (t: { id: number; slug: string }) => `/topic/${t.id}-${t.slug}`;
const memberUrl = (u: { id: string; name: string }) => `/members/${u.id}-${slugify(u.name)}`;
const postUrl = (topicId: number, postId: number) => `/topic/${topicId}/post/${postId}`;

const limitOf = (v: unknown, fallback: number, max: number) => (Number.isInteger(v) && (v as number) > 0 ? Math.min(v as number, max) : fallback);
const idOf = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);

/**
 * API-ul public, doar citire, al pluginurilor (`ctx.api`): utilizatori, topicuri, postări, forumuri și statistici,
 * prin serviciile existente și cu permisiunile actorului (vizitatorul apelului sau un vizitator anonim).
 */
export class GcsPluginPublicApi {
  constructor(private readonly deps: { db: PrismaClient; forumQueries: GcsForumQueries; posting: GcsForumPosting }) {}

  async call(method: string, args: unknown[], actor: GcsActor): Promise<unknown> {
    switch (method) {
      case "api.users.get":
        return this.users(args[0]);
      case "api.topics.get":
        return this.topic(actor, args[0]);
      case "api.topics.recent":
        return this.recentTopics(actor, args[0]);
      case "api.posts.get":
        return this.post(actor, args[0]);
      case "api.posts.recent":
        return this.recentPosts(actor, args[0]);
      case "api.forums.list":
        return this.forums(actor);
      case "api.stats": {
        const s = await this.deps.forumQueries.stats();
        return { topics: s.topics, posts: s.posts, members: s.members };
      }
      default:
        throw new Error("unknown_method");
    }
  }

  /** Profilul public de bază (numele și grupul apar oricum lângă postări). */
  private async users(raw: unknown) {
    const ids = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length <= 64))].slice(0, 50) : [];
    if (ids.length === 0) return [];
    const rows = await this.deps.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, image: true, createdAt: true, postsCount: true, primaryGroup: { select: { key: true } } },
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      groupKey: u.primaryGroup.key,
      avatarUrl: u.image,
      joinedAt: u.createdAt.toISOString(),
      postsCount: u.postsCount,
      url: memberUrl(u),
    }));
  }

  private async topic(actor: GcsActor, raw: unknown) {
    const id = idOf(raw);
    if (id === null || !(await this.deps.forumQueries.topicAccess(actor, id)).canRead) return null;
    const t = await this.deps.db.topic.findUnique({
      where: { id },
      select: { id: true, title: true, slug: true, forumId: true, authorId: true, createdAt: true, lastPostAt: true, repliesCount: true },
    });
    if (!t) return null;
    return { id: t.id, title: t.title, forumId: t.forumId, authorId: t.authorId, createdAt: t.createdAt.toISOString(), lastPostAt: t.lastPostAt.toISOString(), repliesCount: t.repliesCount, url: topicUrl(t) };
  }

  private async recentTopics(actor: GcsActor, raw: unknown) {
    const list = await this.deps.forumQueries.recentTopics(actor, limitOf(raw, 10, 20));
    if (list.length === 0) return [];
    const rows = await this.deps.db.topic.findMany({
      where: { id: { in: list.map((t) => t.id) } },
      select: { id: true, forumId: true, authorId: true, createdAt: true, repliesCount: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return list.map((t) => {
      const r = byId.get(t.id);
      return {
        id: t.id,
        title: t.title,
        forumId: r?.forumId ?? 0,
        authorId: r?.authorId ?? null,
        createdAt: r?.createdAt.toISOString() ?? t.lastPostAt,
        lastPostAt: t.lastPostAt,
        repliesCount: r?.repliesCount ?? 0,
        url: topicUrl(t),
      };
    });
  }

  private async post(actor: GcsActor, raw: unknown) {
    const id = idOf(raw);
    if (id === null || !(await canViewPost(this.deps.posting, actor, id))) return null;
    const p = await this.deps.db.post.findUnique({
      where: { id },
      select: { id: true, topicId: true, authorId: true, createdAt: true, contentJson: true, topic: { select: { title: true } } },
    });
    if (!p) return null;
    return { id: p.id, topicId: p.topicId, topicTitle: p.topic.title, authorId: p.authorId, createdAt: p.createdAt.toISOString(), text: docSnippet(p.contentJson, 2000), url: postUrl(p.topicId, p.id) };
  }

  private async recentPosts(actor: GcsActor, raw: unknown) {
    const list = await this.deps.forumQueries.recentPosts(actor, limitOf(raw, 10, 20));
    return list.map((p) => ({ id: p.id, topicId: p.topicId, topicTitle: p.topicTitle, authorId: p.user?.id ?? null, createdAt: p.at, text: p.excerpt, url: postUrl(p.topicId, p.id) }));
  }

  private async forums(actor: GcsActor) {
    const categories = await this.deps.forumQueries.index(actor);
    return categories.flatMap((c) => [
      { id: c.id, name: c.name, parentId: null, topicsCount: 0, postsCount: 0, url: `/forum/${c.id}-${c.slug}` },
      ...c.forums.map((f) => ({ id: f.id, name: f.name, parentId: c.id, topicsCount: f.topicsCount, postsCount: f.postsCount, url: `/forum/${f.id}-${f.slug}` })),
    ]);
  }
}
