import { docSnippet } from "../content-text";
import { rankLabel, type GcsRankDirectory, type GcsRankLabel } from "../profile/display";
import {
  GcsForbidden,
  GcsNotFound,
  type GcsActor,
  type GcsCache,
  type GcsFollowService,
  type GcsPermissionService,
  type GcsReactionCount,
  type GcsReactionService,
  type GcsReactionView,
  type GcsSettingsService,
} from "@gcs/core";
import type { ContentVisibility, ForumType, Prisma, PrismaClient } from "@gcs/db";
import type { GcsPollService, GcsPollView } from "./polls";
import { forumContainer, POST_CONTENT_TYPE } from "./posting";
import type { GcsReadMarkerService } from "./readMarkers";

export type GcsQueriesDeps = {
  db: PrismaClient;
  cache: GcsCache;
  permissions: GcsPermissionService;
  settings: GcsSettingsService;
  readMarkers: GcsReadMarkerService;
  follows: GcsFollowService;
  reactions: GcsReactionService;
  polls: GcsPollService;
  /** Rangurile afișate sub numele autorilor (etapa 3). */
  ranks: GcsRankDirectory;
};

/**
 * Un user, pe scurt: destul pentru un link cu numele stilizat (`gcs-name--{nameKey}`: stilul ales sau grupul principal)
 * și avatarul cu ramă (`gcs-avatarFrame--{frameKey}`).
 */
export type GcsUserRef = { id: string; name: string; image: string | null; groupKey: string; nameKey: string; frameKey: string | null };
export type GcsPagination = { page: number; pages: number; perPage: number; total: number };
export type GcsCrumb = { id: number; name: string; slug: string; type: ForumType };
export type GcsLastPost = { postId: number; topicId: number; topicTitle: string; topicSlug: string; at: string; user: GcsUserRef | null };

/** Un forum într-o listă (index sau subforumurile unui forum). Contoarele includ subforumurile citibile. */
export type GcsForumRow = {
  id: number;
  type: ForumType;
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  color: string | null;
  linkUrl: string | null;
  topicsCount: number;
  postsCount: number;
  subforums: { id: number; name: string; slug: string; icon: string | null; topicsCount: number }[];
  /** Pe câte coloane apar subforumurile (setarea forumului, 1–5). */
  subforumColumns: number;
  last: GcsLastPost | null;
  unread: boolean;
};
/** O postare în widget-ul „Postări recente”. */
export type GcsWidgetPost = { id: number; topicId: number; topicTitle: string; topicSlug: string; excerpt: string; at: string; user: GcsUserRef | null };
export type GcsIndexCategory = { id: number; name: string; slug: string; color: string | null; forums: GcsForumRow[] };

export type GcsTopicRow = {
  id: number;
  title: string;
  slug: string;
  visibility: ContentVisibility;
  pinned: boolean;
  locked: boolean;
  featured: boolean;
  solved: boolean;
  prefix: { id: number; name: string; color: string } | null;
  tags: { name: string; slug: string }[];
  author: GcsUserRef | null;
  createdAt: string;
  repliesCount: number;
  viewsCount: number;
  last: { at: string; user: GcsUserRef | null };
  unread: boolean;
};

export type GcsForumPage = {
  forum: { id: number; type: ForumType; name: string; slug: string; description: string; linkUrl: string | null };
  breadcrumb: GcsCrumb[];
  subforums: GcsForumRow[];
  topics: GcsTopicRow[];
  pagination: GcsPagination;
  canCreate: boolean;
  /** Puterile de moderare ale actorului pe forum; `["*"]` = toate. */
  modPowers: string[];
};

export type GcsPostAuthor = GcsUserRef & {
  rank: GcsRankLabel | null;
  groupColor: string | null;
  groupName: string;
  groupTitle: string | null;
  postsCount: number;
  reputation: number;
  joinedAt: string;
};

export type GcsPostView = {
  id: number;
  /** Numărul postării în topic, așa cum îl vede actorul (`#2`). */
  number: number;
  html: string;
  visibility: ContentVisibility;
  createdAt: string;
  editedAt: string | null;
  editedBy: { id: string; name: string } | null;
  hiddenReason: string | null;
  author: GcsPostAuthor | null;
  attachments: { id: string; filename: string; size: number; mime: string }[];
  canEdit: boolean;
  canHide: boolean;
  reactions: GcsReactionCount[];
  myReaction: number | null;
};

export type GcsTopicPage = {
  topic: {
    id: number;
    forumId: number;
    title: string;
    slug: string;
    visibility: ContentVisibility;
    pinned: boolean;
    locked: boolean;
    featured: boolean;
    solvedPostId: number | null;
    firstPostId: number | null;
    repliesCount: number;
    viewsCount: number;
    createdAt: string;
    prefix: { id: number; name: string; color: string } | null;
    tags: { name: string; slug: string }[];
    author: GcsUserRef | null;
  };
  forum: { id: number; type: ForumType; name: string; slug: string };
  breadcrumb: GcsCrumb[];
  posts: GcsPostView[];
  pagination: GcsPagination;
  canReply: boolean;
  modPowers: string[];
  follow: { count: number; following: boolean };
  poll: GcsPollView | null;
  /** Reacțiile active (bara de reacții). */
  reactions: GcsReactionView[];
};

export type GcsTagPage = { tag: { name: string; slug: string }; topics: GcsTopicRow[]; pagination: GcsPagination };

type TreeForum = {
  id: number;
  parentId: number | null;
  type: ForumType;
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  color: string | null;
  position: number;
  linkUrl: string | null;
  /** Coloanele subforumurilor din listă (1–5); lipsește în arborii cache-uiți înainte de etapa 5. */
  subforumColumns?: number;
  topicsCount: number;
  postsCount: number;
  lastPostId: number | null;
  lastPostAt: string | null;
  lastTopicId: number | null;
  lastPosterId: string | null;
};
type TreeData = { forums: TreeForum[]; topics: Record<string, { title: string; slug: string }>; users: Record<string, GcsUserRef> };

const TREE_KEY = "forums:tree";
const TREE_TTL = 3600;
const STATS_TTL = 300;
export const userRefSelect = {
  id: true,
  name: true,
  image: true,
  primaryGroup: { select: { key: true } },
  nameStyle: { select: { key: true } },
  avatarFrame: { select: { key: true } },
} as const;

type UserRefRow = { id: string; name: string; image: string | null; primaryGroup: { key: string }; nameStyle: { key: string } | null; avatarFrame: { key: string } | null };

export function toRef(u: UserRefRow): GcsUserRef {
  return { id: u.id, name: u.name, image: u.image, groupKey: u.primaryGroup.key, nameKey: u.nameStyle?.key ?? u.primaryGroup.key, frameKey: u.avatarFrame?.key ?? null };
}

const has = (powers: string[], power: string) => powers.includes("*") || powers.includes(power);

/** Arborele forumurilor, cu indexuri pentru copii și părinți. */
class GcsTree {
  readonly byId: Map<number, TreeForum>;
  private readonly children = new Map<number | null, TreeForum[]>();

  constructor(readonly data: TreeData) {
    this.byId = new Map(data.forums.map((f) => [f.id, f]));
    for (const f of data.forums) {
      const list = this.children.get(f.parentId) ?? [];
      list.push(f);
      this.children.set(f.parentId, list);
    }
    for (const list of this.children.values()) list.sort((a, b) => a.position - b.position || a.id - b.id);
  }

  childrenOf(id: number | null): TreeForum[] {
    return this.children.get(id) ?? [];
  }

  /** Forumul și toți descendenții lui. */
  subtree(id: number): TreeForum[] {
    const self = this.byId.get(id);
    if (!self) return [];
    return [self, ...this.childrenOf(id).flatMap((c) => this.subtree(c.id))];
  }

  /** De la rădăcină până la forum (inclusiv). */
  path(id: number): TreeForum[] {
    const out: TreeForum[] = [];
    for (let f = this.byId.get(id); f && out.length < 64; f = f.parentId === null ? undefined : this.byId.get(f.parentId)) out.unshift(f);
    return out;
  }
}

/**
 * Citirile pentru paginile forumului (specul etapei 2, §5). Structura și contoarele vin din cache (tag `forums-tree`);
 * permisiunile și vizibilitatea se aplică per actor, iar regula de vizibilitate stă într-un singur loc (`visibilityFilter`).
 */
export class GcsForumQueries {
  constructor(readonly deps: GcsQueriesDeps) {}

  /** Regula de vizibilitate (Global Constraints): moderatorii văd tot; ceilalți, ce e vizibil plus propriile postări în așteptare. */
  visibilityFilter(actor: GcsActor, isModerator: boolean): Prisma.PostWhereInput & Prisma.TopicWhereInput {
    if (isModerator) return {};
    if (!actor.userId) return { visibility: "VISIBLE" };
    return { OR: [{ visibility: "VISIBLE" }, { visibility: "PENDING", authorId: actor.userId }] };
  }

  async index(actor: GcsActor): Promise<GcsIndexCategory[]> {
    const tree = await this.tree();
    const { viewable, readable } = await this.access(actor, tree);
    const unread = await this.deps.readMarkers.unreadForumIds(actor.userId, [...readable]);
    const categories: GcsIndexCategory[] = [];
    for (const cat of tree.childrenOf(null)) {
      if (cat.type !== "CATEGORY" || !viewable.has(cat.id)) continue;
      const forums = tree.childrenOf(cat.id).filter((f) => viewable.has(f.id)).map((f) => this.row(tree, f, viewable, readable, unread));
      if (forums.length > 0) categories.push({ id: cat.id, name: cat.name, slug: cat.slug, color: cat.color, forums });
    }
    return categories;
  }

  async forum(actor: GcsActor, forumId: number, opts: { page: number; prefixId?: number }): Promise<GcsForumPage> {
    const { db, settings } = this.deps;
    const tree = await this.tree();
    const node = tree.byId.get(forumId);
    const { viewable, readable } = await this.access(actor, tree);
    if (!node || !viewable.has(node.id)) throw new GcsNotFound();
    if (!readable.has(node.id)) throw new GcsForbidden({ permission: "forums.read" });

    const modPowers = await this.modPowers(actor, forumId);
    const perPage = await settings.get<number>("forums.topics_per_page");
    const hostsTopics = node.type === "FORUM" || node.type === "QA";
    const where: Prisma.TopicWhereInput = {
      forumId,
      ...this.visibilityFilter(actor, modPowers.length > 0),
      ...(opts.prefixId ? { prefixId: opts.prefixId } : {}),
    };

    const [total, rows] = hostsTopics
      ? await Promise.all([
          db.topic.count({ where }),
          db.topic.findMany({
            where,
            orderBy: [{ pinned: "desc" }, { lastPostAt: "desc" }, { id: "desc" }],
            skip: (Math.max(1, opts.page) - 1) * perPage,
            take: perPage,
            include: topicRowInclude,
          }),
        ])
      : [0, []];
    const subtreeIds = tree.subtree(forumId).filter((f) => readable.has(f.id)).map((f) => f.id);
    const [posters, unreadTopics, unreadForums] = await Promise.all([
      this.users(rows.map((t) => t.lastPosterId)),
      this.deps.readMarkers.unreadTopicIds(actor.userId, rows.filter((t) => t.visibility === "VISIBLE")),
      this.deps.readMarkers.unreadForumIds(actor.userId, subtreeIds.filter((id) => id !== forumId)),
    ]);

    return {
      forum: { id: node.id, type: node.type, name: node.name, slug: node.slug, description: node.description, linkUrl: node.linkUrl },
      breadcrumb: this.crumbs(tree, forumId, viewable),
      subforums: tree.childrenOf(forumId).filter((f) => viewable.has(f.id)).map((f) => this.row(tree, f, viewable, readable, unreadForums)),
      topics: rows.map((t) => topicRow(t, posters, unreadTopics)),
      pagination: paginate(opts.page, perPage, total),
      canCreate: hostsTopics && actor.userId !== null && (await this.deps.permissions.can(actor, "forums.create", forumContainer(forumId))),
      modPowers,
    };
  }

  async topic(actor: GcsActor, topicId: number, opts: { page: number }): Promise<GcsTopicPage> {
    const { db, permissions, settings } = this.deps;
    const topic = await db.topic.findUnique({
      where: { id: topicId },
      include: {
        author: { select: userRefSelect },
        prefix: { select: { id: true, name: true, color: true } },
        tags: { select: { tag: { select: { name: true, slug: true } } } },
      },
    });
    if (!topic) throw new GcsNotFound();
    const tree = await this.tree();
    const forum = tree.byId.get(topic.forumId);
    const { viewable, readable } = await this.access(actor, tree);
    if (!forum || !viewable.has(forum.id)) throw new GcsNotFound();
    if (!readable.has(forum.id)) throw new GcsForbidden({ permission: "forums.read" });

    const modPowers = await this.modPowers(actor, forum.id);
    const isAuthor = actor.userId !== null && actor.userId === topic.authorId;
    const visible =
      topic.visibility === "VISIBLE" ||
      (topic.visibility === "PENDING" && (isAuthor || has(modPowers, "approve"))) ||
      (topic.visibility === "HIDDEN" && has(modPowers, "hide"));
    if (!visible) throw new GcsNotFound();

    const [perPage, editMinutes, hideOwn, canReplyPerm] = await Promise.all([
      settings.get<number>("forums.posts_per_page"),
      permissions.groupValue<number | boolean>(actor, "forums.edit_own_minutes"),
      permissions.groupValue<boolean>(actor, "forums.hide_own"),
      actor.userId ? permissions.can(actor, "forums.reply", forumContainer(forum.id)) : Promise.resolve(false),
    ]);
    const page = Math.max(1, opts.page);
    const where: Prisma.PostWhereInput = { topicId, ...this.visibilityFilter(actor, modPowers.length > 0) };
    const [total, posts] = await Promise.all([
      db.post.count({ where }),
      db.post.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          authorId: true,
          contentHtml: true,
          visibility: true,
          createdAt: true,
          editedAt: true,
          editedById: true,
          hiddenReason: true,
        },
      }),
    ]);

    const ids = posts.map((p) => p.id);
    const userIds = [...new Set(posts.flatMap((p) => [p.authorId, p.editedById]).filter((id): id is string => id !== null))];
    const { follows, reactions, polls } = this.deps;
    const postKeys = ids.map(String);
    const [users, files, followCount, following, summary, mine, poll, reactionList, rankData] = await Promise.all([
      userIds.length === 0
        ? Promise.resolve([])
        : db.user.findMany({
            where: { id: { in: userIds } },
            select: {
              ...userRefSelect,
              postsCount: true,
              reputation: true,
              createdAt: true,
              rankId: true,
              primaryGroupId: true,
              primaryGroup: { select: { key: true, name: true, title: true, color: true } },
            },
          }),
      ids.length === 0
        ? Promise.resolve([])
        : db.attachment.findMany({
            where: { contentType: POST_CONTENT_TYPE, contentId: { in: ids.map(String) }, NOT: { mime: { startsWith: "image/" } } },
            select: { id: true, filename: true, size: true, mime: true, contentId: true },
            orderBy: { createdAt: "asc" },
          }),
      follows.count("topic", String(topicId)),
      follows.isFollowing(actor.userId, "topic", String(topicId)),
      reactions.summary(POST_CONTENT_TYPE, postKeys),
      reactions.mine(actor.userId, POST_CONTENT_TYPE, postKeys),
      polls.forTopic(actor, topicId),
      reactions.list(),
      this.deps.ranks.data(),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const myReactions = mine;
    const now = Date.now();
    const inWindow = (createdAt: Date) =>
      editMinutes === -1 || (typeof editMinutes === "number" && editMinutes > 0 && now - createdAt.getTime() <= editMinutes * 60_000);

    const views: GcsPostView[] = posts.map((p, i) => {
      const author = p.authorId ? userMap.get(p.authorId) : undefined;
      const editor = p.editedById ? userMap.get(p.editedById) : undefined;
      const mine = actor.userId !== null && actor.userId === p.authorId;
      return {
        id: p.id,
        number: (page - 1) * perPage + i + 1,
        html: p.contentHtml,
        visibility: p.visibility,
        createdAt: p.createdAt.toISOString(),
        editedAt: p.editedAt?.toISOString() ?? null,
        editedBy: editor ? { id: editor.id, name: editor.name } : null,
        hiddenReason: p.visibility === "HIDDEN" ? p.hiddenReason : null,
        author: author
          ? {
              ...toRef(author),
              rank: rankLabel(rankData, author.rankId, author.primaryGroupId),
              groupColor: author.primaryGroup.color,
              groupName: author.primaryGroup.name,
              groupTitle: author.primaryGroup.title,
              postsCount: author.postsCount,
              reputation: author.reputation,
              joinedAt: author.createdAt.toISOString(),
            }
          : null,
        attachments: files.filter((f) => f.contentId === String(p.id)).map(({ contentId: _c, ...f }) => f),
        canEdit: has(modPowers, "edit") || (mine && p.visibility !== "HIDDEN" && !topic.locked && inWindow(p.createdAt)),
        canHide: has(modPowers, "hide") || (mine && hideOwn === true && p.visibility === "VISIBLE"),
        reactions: summary[String(p.id)] ?? [],
        myReaction: myReactions[String(p.id)] ?? null,
      };
    });

    return {
      topic: {
        id: topic.id,
        forumId: topic.forumId,
        title: topic.title,
        slug: topic.slug,
        visibility: topic.visibility,
        pinned: topic.pinned,
        locked: topic.locked,
        featured: topic.featured,
        solvedPostId: topic.solvedPostId,
        firstPostId: topic.firstPostId,
        repliesCount: topic.repliesCount,
        viewsCount: topic.viewsCount,
        createdAt: topic.createdAt.toISOString(),
        prefix: topic.prefix,
        tags: topic.tags.map((x) => x.tag),
        author: topic.author ? toRef(topic.author) : null,
      },
      forum: { id: forum.id, type: forum.type, name: forum.name, slug: forum.slug },
      breadcrumb: this.crumbs(tree, forum.id, viewable),
      posts: views,
      pagination: paginate(page, perPage, total),
      canReply:
        canReplyPerm &&
        (topic.visibility === "VISIBLE" || has(modPowers, "approve")) &&
        (!topic.locked || has(modPowers, "lock")),
      modPowers,
      follow: { count: followCount, following },
      poll: poll ? { ...poll, canVote: poll.canVote && topic.visibility === "VISIBLE" } : null,
      reactions: reactionList,
    };
  }

  /** Topicurile vizibile cu un tag, din forumurile pe care actorul le poate citi. */
  /**
   * Poate actorul citi topicul (forum vizibil și citibil, topic vizibil pentru el) și răspunde în el?
   * Folosit de camerele `gcs-realtime` și de notificări (fără să încarce pagina topicului).
   */
  async topicAccess(actor: GcsActor, topicId: number): Promise<{ canRead: boolean; canReply: boolean }> {
    const none = { canRead: false, canReply: false };
    const topic = await this.deps.db.topic.findUnique({ where: { id: topicId }, select: { forumId: true, authorId: true, visibility: true, locked: true } });
    if (!topic) return none;
    const ref = forumContainer(topic.forumId);
    const [view, read] = await Promise.all([this.deps.permissions.can(actor, "forums.view", ref), this.deps.permissions.can(actor, "forums.read", ref)]);
    if (!view || !read) return none;
    const modPowers = topic.visibility === "VISIBLE" && !topic.locked ? [] : await this.modPowers(actor, topic.forumId);
    const isAuthor = actor.userId !== null && actor.userId === topic.authorId;
    const visible =
      topic.visibility === "VISIBLE" ||
      (topic.visibility === "PENDING" && (isAuthor || has(modPowers, "approve"))) ||
      (topic.visibility === "HIDDEN" && has(modPowers, "hide"));
    if (!visible) return none;
    const canReply =
      actor.userId !== null &&
      (topic.visibility === "VISIBLE" || has(modPowers, "approve")) &&
      (!topic.locked || has(modPowers, "lock")) &&
      (await this.deps.permissions.can(actor, "forums.reply", ref));
    return { canRead: true, canReply };
  }

  async topicsByTag(actor: GcsActor, slug: string, opts: { page: number }): Promise<GcsTagPage> {
    const { db, settings } = this.deps;
    const tag = await db.tag.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
    if (!tag) throw new GcsNotFound();
    const tree = await this.tree();
    const { readable } = await this.access(actor, tree);
    const perPage = await settings.get<number>("forums.topics_per_page");
    const where: Prisma.TopicWhereInput = { forumId: { in: [...readable] }, visibility: "VISIBLE", tags: { some: { tagId: tag.id } } };
    const [total, rows] = await Promise.all([
      db.topic.count({ where }),
      db.topic.findMany({
        where,
        orderBy: [{ lastPostAt: "desc" }, { id: "desc" }],
        skip: (Math.max(1, opts.page) - 1) * perPage,
        take: perPage,
        include: topicRowInclude,
      }),
    ]);
    const [posters, unread] = await Promise.all([this.users(rows.map((t) => t.lastPosterId)), this.deps.readMarkers.unreadTopicIds(actor.userId, rows)]);
    return { tag: { name: tag.name, slug: tag.slug }, topics: rows.map((t) => topicRow(t, posters, unread)), pagination: paginate(opts.page, perPage, total) };
  }

  /** Ultimele topicuri active, doar din forumurile pe care actorul le poate citi. */
  async recentTopics(actor: GcsActor, limit: number): Promise<{ id: number; title: string; slug: string; lastPostAt: string; user: GcsUserRef | null }[]> {
    const tree = await this.tree();
    const { readable } = await this.access(actor, tree);
    if (readable.size === 0) return [];
    const rows = await this.deps.db.topic.findMany({
      where: { forumId: { in: [...readable] }, visibility: "VISIBLE" },
      orderBy: [{ lastPostAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, title: true, slug: true, lastPostAt: true, lastPosterId: true },
    });
    const users = await this.users(rows.map((r) => r.lastPosterId));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      lastPostAt: r.lastPostAt.toISOString(),
      user: r.lastPosterId ? (users.get(r.lastPosterId) ?? null) : null,
    }));
  }

  /** Ultimele postări vizibile din forumurile citibile (widget-ul „Postări recente”), cu un extras de text. */
  async recentPosts(actor: GcsActor, limit: number): Promise<GcsWidgetPost[]> {
    const tree = await this.tree();
    const { readable } = await this.access(actor, tree);
    if (readable.size === 0) return [];
    const rows = await this.deps.db.post.findMany({
      where: { visibility: "VISIBLE", topic: { forumId: { in: [...readable] }, visibility: "VISIBLE" } },
      orderBy: { id: "desc" },
      take: limit,
      select: { id: true, contentJson: true, createdAt: true, authorId: true, topic: { select: { id: true, title: true, slug: true } } },
    });
    const users = await this.users(rows.map((r) => r.authorId));
    return rows.map((r) => ({
      id: r.id,
      topicId: r.topic.id,
      topicTitle: r.topic.title,
      topicSlug: r.topic.slug,
      excerpt: docSnippet(r.contentJson, 120),
      at: r.createdAt.toISOString(),
      user: r.authorId ? (users.get(r.authorId) ?? null) : null,
    }));
  }

  /** Topicurile promovate (`featured`) din forumurile citibile, cele mai noi primele. */
  async featuredTopics(actor: GcsActor, limit: number): Promise<{ id: number; title: string; slug: string; repliesCount: number; createdAt: string; user: GcsUserRef | null }[]> {
    const tree = await this.tree();
    const { readable } = await this.access(actor, tree);
    if (readable.size === 0) return [];
    const rows = await this.deps.db.topic.findMany({
      where: { forumId: { in: [...readable] }, visibility: "VISIBLE", featured: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, title: true, slug: true, repliesCount: true, createdAt: true, authorId: true },
    });
    const users = await this.users(rows.map((r) => r.authorId));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      repliesCount: r.repliesCount,
      createdAt: r.createdAt.toISOString(),
      user: r.authorId ? (users.get(r.authorId) ?? null) : null,
    }));
  }

  /**
   * Cei mai activi membri (widget-ul „Top posteri”): pe săptămână / lună numără postările vizibile din perioadă,
   * pe „total” folosește contorul userului. Cache 10 minute.
   */
  async topPosters(period: "week" | "month" | "all", limit: number): Promise<{ user: GcsUserRef; posts: number }[]> {
    const { cache, db } = this.deps;
    const key = `forums:topPosters:${period}:${limit}`;
    const cached = await cache.get<{ user: GcsUserRef; posts: number }[]>(key);
    if (cached) return cached;
    let counts: { id: string; posts: number }[];
    if (period === "all") {
      const rows = await db.user.findMany({ where: { postsCount: { gt: 0 } }, orderBy: [{ postsCount: "desc" }, { createdAt: "asc" }], take: limit, select: { id: true, postsCount: true } });
      counts = rows.map((r) => ({ id: r.id, posts: r.postsCount }));
    } else {
      const since = new Date(Date.now() - (period === "week" ? 7 : 30) * 86_400_000);
      const rows = await db.post.groupBy({
        by: ["authorId"],
        where: { createdAt: { gte: since }, visibility: "VISIBLE", authorId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { authorId: "desc" } },
        take: limit,
      });
      counts = rows.map((r) => ({ id: r.authorId!, posts: r._count._all }));
    }
    const users = await this.users(counts.map((c) => c.id));
    const list = counts.flatMap((c) => {
      const user = users.get(c.id);
      return user ? [{ user, posts: c.posts }] : [];
    });
    await cache.set(key, list, { ttlSec: 600, tags: ["forums-tree"] });
    return list;
  }

  /** Cei mai noi membri (widget-ul „Membri noi”). Cache 5 minute. */
  async newMembers(limit: number): Promise<{ user: GcsUserRef; joinedAt: string }[]> {
    const { cache, db } = this.deps;
    const key = `forums:newMembers:${limit}`;
    const cached = await cache.get<{ user: GcsUserRef; joinedAt: string }[]>(key);
    if (cached) return cached;
    const rows = await db.user.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: { ...userRefSelect, createdAt: true } });
    const list = rows.map((r) => ({ user: toRef(r), joinedAt: r.createdAt.toISOString() }));
    await cache.set(key, list, { ttlSec: STATS_TTL, tags: ["forums-tree"] });
    return list;
  }

  /** Statisticile comunității (coloana din dreapta), cache-uite 5 minute. */
  async stats(): Promise<{ topics: number; posts: number; members: number; newestMember: GcsUserRef | null }> {
    const { cache, db } = this.deps;
    const cached = await cache.get<Awaited<ReturnType<GcsForumQueries["stats"]>>>("forums:stats");
    if (cached) return cached;
    const tree = await this.tree();
    const [members, newest] = await Promise.all([
      db.user.count(),
      db.user.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: userRefSelect }),
    ]);
    const stats = {
      topics: tree.data.forums.reduce((n, f) => n + f.topicsCount, 0),
      posts: tree.data.forums.reduce((n, f) => n + f.postsCount, 0),
      members,
      newestMember: newest ? toRef(newest) : null,
    };
    await cache.set("forums:stats", stats, { ttlSec: STATS_TTL, tags: ["forums-tree"] });
    return stats;
  }

  /** Arborele forumurilor, cu titlurile ultimelor topicuri și ultimii autori (din cache). */
  private async tree(): Promise<GcsTree> {
    const { cache, db } = this.deps;
    const cached = await cache.get<TreeData>(TREE_KEY);
    if (cached) return new GcsTree(cached);

    const forums = await db.forum.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const topicIds = forums.map((f) => f.lastTopicId).filter((id): id is number => id !== null);
    const [topics, users] = await Promise.all([
      topicIds.length === 0 ? Promise.resolve([]) : db.topic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, slug: true } }),
      this.users(forums.map((f) => f.lastPosterId)),
    ]);
    const data: TreeData = {
      forums: forums.map((f) => ({
        id: f.id,
        parentId: f.parentId,
        type: f.type,
        name: f.name,
        slug: f.slug,
        description: f.description,
        icon: f.icon,
        color: f.color,
        position: f.position,
        linkUrl: f.linkUrl,
        subforumColumns: f.subforumColumns,
        topicsCount: f.topicsCount,
        postsCount: f.postsCount,
        lastPostId: f.lastPostId,
        lastPostAt: f.lastPostAt?.toISOString() ?? null,
        lastTopicId: f.lastTopicId,
        lastPosterId: f.lastPosterId,
      })),
      topics: Object.fromEntries(topics.map((t) => [String(t.id), { title: t.title, slug: t.slug }])),
      users: Object.fromEntries(users),
    };
    // Numele stilizat al ultimului autor se schimbă odată cu grupul lui (tag `user:{id}`).
    await cache.set(TREE_KEY, data, { ttlSec: TREE_TTL, tags: ["forums-tree", ...[...users.keys()].map((id) => `user:${id}`)] });
    return new GcsTree(data);
  }

  private async access(actor: GcsActor, tree: GcsTree): Promise<{ viewable: Set<number>; readable: Set<number> }> {
    const refs = tree.data.forums.map((f) => forumContainer(f.id));
    const [view, read] = await Promise.all([
      this.deps.permissions.filterContainers(actor, "forums.view", refs),
      this.deps.permissions.filterContainers(actor, "forums.read", refs),
    ]);
    const toIds = (s: Set<string>) => new Set([...s].map(Number));
    return { viewable: toIds(view), readable: toIds(read) };
  }

  /** Puterile de moderare pe forum: `["*"]` pentru moderatorii globali (`forums.moderate_all`). */
  private async modPowers(actor: GcsActor, forumId: number): Promise<string[]> {
    if (!actor.userId) return [];
    if (await this.deps.permissions.can(actor, "forums.moderate_all")) return ["*"];
    return this.deps.permissions.moderatorPowers(actor, forumContainer(forumId));
  }

  private crumbs(tree: GcsTree, forumId: number, viewable: Set<number>): GcsCrumb[] {
    return tree
      .path(forumId)
      .filter((f) => viewable.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, slug: f.slug, type: f.type }));
  }

  /** Un forum în listă: contoarele și ultimul mesaj, adunate din subarborele citibil de actor. */
  private row(tree: GcsTree, f: TreeForum, viewable: Set<number>, readable: Set<number>, unread: Set<number>): GcsForumRow {
    const nodes = tree.subtree(f.id).filter((n) => readable.has(n.id));
    const latest = nodes.reduce<TreeForum | null>((best, n) => (n.lastPostId !== null && (best === null || n.lastPostId > best.lastPostId!) ? n : best), null);
    const topic = latest?.lastTopicId ? tree.data.topics[String(latest.lastTopicId)] : undefined;
    return {
      id: f.id,
      type: f.type,
      name: f.name,
      slug: f.slug,
      description: f.description,
      icon: f.icon,
      color: f.color,
      linkUrl: f.linkUrl,
      topicsCount: nodes.reduce((n, x) => n + x.topicsCount, 0),
      postsCount: nodes.reduce((n, x) => n + x.postsCount, 0),
      subforums: tree.childrenOf(f.id).filter((c) => viewable.has(c.id)).map((c) => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, topicsCount: tree.subtree(c.id).filter((n) => readable.has(n.id)).reduce((n, x) => n + x.topicsCount, 0) })),
      subforumColumns: f.subforumColumns ?? 2,
      last:
        latest && topic
          ? {
              postId: latest.lastPostId!,
              topicId: latest.lastTopicId!,
              topicTitle: topic.title,
              topicSlug: topic.slug,
              at: latest.lastPostAt!,
              user: latest.lastPosterId ? (tree.data.users[latest.lastPosterId] ?? null) : null,
            }
          : null,
      unread: nodes.some((n) => unread.has(n.id)),
    };
  }

  /** Userii după id, într-o singură interogare. */
  private async users(ids: (string | null)[]): Promise<Map<string, GcsUserRef>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.deps.db.user.findMany({ where: { id: { in: unique } }, select: userRefSelect });
    return new Map(rows.map((u) => [u.id, toRef(u)]));
  }
}

const topicRowInclude = {
  author: { select: userRefSelect },
  prefix: { select: { id: true, name: true, color: true } },
  tags: { select: { tag: { select: { name: true, slug: true } } } },
} as const satisfies Prisma.TopicInclude;

type TopicWithRow = Prisma.TopicGetPayload<{ include: typeof topicRowInclude }>;

/** Un topic în listă (forum, pagina unui tag). */
function topicRow(t: TopicWithRow, posters: Map<string, GcsUserRef>, unread: Set<number>): GcsTopicRow {
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    visibility: t.visibility,
    pinned: t.pinned,
    locked: t.locked,
    featured: t.featured,
    solved: t.solvedPostId !== null,
    prefix: t.prefix,
    tags: t.tags.map((x) => x.tag),
    author: t.author ? toRef(t.author) : null,
    createdAt: t.createdAt.toISOString(),
    repliesCount: t.repliesCount,
    viewsCount: t.viewsCount,
    last: { at: t.lastPostAt.toISOString(), user: t.lastPosterId ? (posters.get(t.lastPosterId) ?? null) : null },
    unread: unread.has(t.id),
  };
}

function paginate(page: number, perPage: number, total: number): GcsPagination {
  return { page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / perPage)), perPage, total };
}
