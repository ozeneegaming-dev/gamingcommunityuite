import type { GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { docSnippet } from "../content-text";
import { canViewPost } from "../forums/content";
import type { GcsForumPosting } from "../forums/posting";
import type { GcsForumQueries } from "../forums/queries";
import type { GcsServerQueries } from "../servers/queries";
import { slugify } from "../forums/slug";
import { nameKeyOf, nameKeySelect } from "../profile/nameKeys";
import { normalizePrivacy } from "../profile/privacy";

const topicUrl = (t: { id: number; slug: string }) => `/topic/${t.id}-${t.slug}`;
const memberUrl = (u: { id: string; name: string }) => `/members/${u.id}-${slugify(u.name)}`;
const postUrl = (topicId: number, postId: number) => `/topic/${topicId}/post/${postId}`;

/** „Online” = activitate în ultimele 5 minute (ca prezența din postbit). */
const ONLINE_MS = 5 * 60_000;

const limitOf = (v: unknown, fallback: number, max: number) => (Number.isInteger(v) && (v as number) > 0 ? Math.min(v as number, max) : fallback);
const idOf = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);

/**
 * API-ul public, doar citire, al pluginurilor (`ctx.api`): utilizatori, topicuri, postări, forumuri și statistici,
 * prin serviciile existente și cu permisiunile actorului (vizitatorul apelului sau un vizitator anonim).
 */
export class GcsPluginPublicApi {
  constructor(private readonly deps: { db: PrismaClient; forumQueries: GcsForumQueries; posting: GcsForumPosting; servers?: Pick<GcsServerQueries, "byForums"> }) {}

  /** Grupurile site-ului (nume, culoare): date publice, ca în legendă; fără membri sau permisiuni. */
  private async groups(): Promise<{ id: number; key: string | null; name: string; color: string | null }[]> {
    const rows = await this.deps.db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, color: true }, take: 200 });
    return rows.map((g) => ({ id: g.id, key: g.key ?? null, name: g.name, color: g.color ?? null }));
  }

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
      case "api.groups.list":
        return this.groups();
      case "api.vip.plans":
        return this.vipPlans();
      case "api.vip.status":
        return this.vipStatus(args[0]);
      case "api.vip.members":
        return this.vipMembers(args[0]);
      case "api.servers.byForums": {
        const ids = Array.isArray(args[0]) ? args[0].filter((v): v is number => Number.isSafeInteger(v)) : [];
        return this.deps.servers ? this.deps.servers.byForums(actor, ids) : {};
      }
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
      select: {
        id: true,
        name: true,
        image: true,
        createdAt: true,
        postsCount: true,
        ...nameKeySelect,
        avatarFrame: { select: { key: true } },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      groupKey: u.primaryGroup.key,
      nameKey: nameKeyOf(u),
      frameKey: u.avatarFrame?.key ?? null,
      avatarUrl: u.image,
      joinedAt: u.createdAt.toISOString(),
      postsCount: u.postsCount,
      url: memberUrl(u),
    }));
  }

  /** Planurile VIP (grupurile VIP), în ordinea grupurilor. */
  private async vipPlans() {
    const rows = await this.deps.db.group.findMany({ where: { isVip: true }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { key: true, name: true, color: true, icon: true, position: true } });
    return rows.map((g) => ({ key: g.key, name: g.name, color: g.color, icon: g.icon, position: g.position }));
  }

  /** Abonamentul VIP activ al fiecărui user cerut (≤ 100): planul și expirarea; userii fără VIP au `plan: null`. */
  private async vipStatus(raw: unknown) {
    const ids = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length <= 64))].slice(0, 100) : [];
    if (ids.length === 0) return [];
    const subs = await this.deps.db.vipSubscription.findMany({
      where: { userId: { in: ids }, status: "ACTIVE" },
      select: { userId: true, expiresAt: true, startsAt: true, group: { select: { key: true, name: true } } },
    });
    const byUser = new Map(subs.map((s) => [s.userId, s]));
    return ids.map((id) => {
      const s = byUser.get(id);
      return s
        ? { userId: id, plan: s.group.key, planName: s.group.name, since: s.startsAt.toISOString(), expiresAt: s.expiresAt?.toISOString() ?? null }
        : { userId: id, plan: null, planName: null, since: null, expiresAt: null };
    });
  }

  /**
   * Membrii VIP activi (online întâi, apoi după ultima activitate), cu planul. Starea online respectă setarea de
   * confidențialitate a fiecăruia (`showOnline`).
   */
  private async vipMembers(raw: unknown) {
    const opts = (raw && typeof raw === "object" ? raw : {}) as { limit?: unknown };
    const limit = limitOf(opts.limit, 24, 100);
    const subs = await this.deps.db.vipSubscription.findMany({
      where: { status: "ACTIVE" },
      orderBy: { user: { lastActiveAt: { sort: "desc", nulls: "last" } } },
      take: limit,
      select: {
        group: { select: { key: true, name: true } },
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            lastActiveAt: true,
            privacy: true,
            ...nameKeySelect,
            avatarFrame: { select: { key: true } },
          },
        },
      },
    });
    const now = Date.now();
    const list = subs.map((s) => {
      const u = s.user;
      const visible = normalizePrivacy(u.privacy).showOnline;
      return {
        id: u.id,
        name: u.name,
        url: memberUrl(u),
        avatarUrl: u.image,
        groupKey: u.primaryGroup.key,
        nameKey: nameKeyOf(u),
        frameKey: u.avatarFrame?.key ?? null,
        plan: s.group.key,
        planName: s.group.name,
        online: visible && u.lastActiveAt !== null && now - u.lastActiveAt.getTime() < ONLINE_MS,
        lastActiveAt: visible ? (u.lastActiveAt?.toISOString() ?? null) : null,
      };
    });
    return list.sort((a, b) => Number(b.online) - Number(a.online));
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
