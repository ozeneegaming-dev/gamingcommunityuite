import { docFirstImage, docSnippet } from "../content-text";
import { rankLabel, type GcsRankDirectory, type GcsRankLabel } from "../profile/display";
import { nameKeyOf, nameKeySelect } from "../profile/nameKeys";
import {
  GcsForbidden,
  GcsNotFound,
  staffGroupIds,
  type GcsActor,
  type GcsCache,
  type GcsFollowService,
  type GcsPermissionService,
  type GcsReactionCount,
  type GcsReactionService,
  type GcsReactionView,
  type GcsSettingsService,
} from "@gcs/core";
import { type ContentVisibility, type ForumType, type Prisma, type PrismaClient, jsonInts } from "@gcs/db";
import { hiddenLabels, revealHidden } from "./blocks";
import { isNoticeTone } from "./notices";
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
  /** Forum v2: o pagină („Pagină / Anunț”) cu topicuri dedesubt (altfel rândul nu are contoare). */
  pageTopics: boolean;
};
/** O postare în widget-ul „Postări recente”. */
/** Cel mai nou membru (panoul de statistici): referința, cu data înscrierii. */
export type GcsNewestMember = GcsUserRef & { joinedAt: string };
export type GcsWidgetPost = { id: number; topicId: number; topicTitle: string; topicSlug: string; excerpt: string; at: string; user: GcsUserRef | null };
export type GcsIndexCategory = { id: number; name: string; slug: string; color: string | null; icon: string | null; forums: GcsForumRow[] };

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
  /** Începutul primei postări (setarea temei „Fragment în lista topicurilor”); `null` = necerut sau gol. */
  snippet?: string | null;
  /** Forum v2: nota medie (0 = fără voturi) și numărul voturilor (doar pe forumurile cu nota pornită). */
  rating?: { avg: number; count: number } | null;
  /** Forum v2: topicul e arhivat (doar citire). */
  archived?: boolean;
};

/** Forum v2: sortările listei de topicuri (setarea forumului „Sortarea implicită” și alegerea vizitatorului). */
export const GCS_TOPIC_SORTS = ["last", "created", "replies", "views", "rating", "title"] as const;
export type GcsTopicSort = (typeof GCS_TOPIC_SORTS)[number];
export const isTopicSort = (v: unknown): v is GcsTopicSort => typeof v === "string" && (GCS_TOPIC_SORTS as readonly string[]).includes(v);

/** Forum v2: opțiunile unui forum care schimbă pagina lui (din arborele cache-uit). */
export type GcsForumPageOptions = {
  ownTopicsOnly: boolean;
  hasPassword: boolean;
  rulesMode: "off" | "show" | "accept";
  defaultSort: GcsTopicSort;
  ratingEnabled: boolean;
  pollsEnabled: boolean;
  tagsEnabled: boolean;
  minPosts: number;
};

/** Forum v2: pagina unui nod „Pagină / Anunț”: conținutul (HTML sanitizat), butonul CTA și topicurile de dedesubt. */
export type GcsForumPageContent = { html: string; ctaLabel: string | null; ctaUrl: string | null; ctaIcon: string | null; allowTopics: boolean };

export type GcsForumPage = {
  forum: { id: number; type: ForumType; name: string; slug: string; description: string; linkUrl: string | null; icon: string | null; color: string | null };
  breadcrumb: GcsCrumb[];
  subforums: GcsForumRow[];
  topics: GcsTopicRow[];
  pagination: GcsPagination;
  canCreate: boolean;
  /** Puterile de moderare ale actorului pe forum; `["*"]` = toate. */
  modPowers: string[];
  /** Forum v2: opțiunile forumului, sortarea aplicată și filtrul de notă (`minRating`, ex. 4 = „4★+”). */
  options: GcsForumPageOptions;
  sort: GcsTopicSort;
  minRating: number | null;
  /** Forum v2: pagina unui nod PAGE (altfel `null`). */
  page: GcsForumPageContent | null;
  /** Forum v2: regulile forumului (HTML sanitizat), dacă se afișează. */
  rulesHtml: string | null;
};

export type GcsPostAuthor = GcsUserRef & {
  rank: GcsRankLabel | null;
  groupColor: string | null;
  groupName: string;
  groupTitle: string | null;
  postsCount: number;
  reputation: number;
  joinedAt: string;
  /** Semnătura (HTML sanitizat de renderer, etapa 5); gol = fără. */
  signatureHtml: string;
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
  /** Forum v2: IP-ul postării (doar pentru moderatorii globali), pentru linkul spre uneltele IP din ACP. */
  ip: string | null;
  /** Forum v2: autorul e din staff (pastila „Staff” și chenarul în culoarea grupului). */
  staff: boolean;
  /** Forum v2: rândul „Tu, A, B și alți N au reacționat”: primii membri (vizitatorul primul) și totalul. */
  reactors: { users: { id: string; name: string; nameKey: string }[]; total: number; mine: boolean };
  /** Forum v2: votul Q&A (scorul = suma voturilor, `mine` = votul vizitatorului); `null` în afara Q&A sau cu votul oprit. */
  votes: { score: number; mine: -1 | 0 | 1 } | null;
};

/** Scorurile Q&A ale postărilor (suma voturilor) și voturile unui membru pe ele. */
export async function postVotes(db: PrismaClient, postIds: number[], userId: string | null): Promise<{ score: Map<number, number>; mine: Map<number, -1 | 0 | 1> }> {
  const [sums, mine] = await Promise.all([
    db.postVote.groupBy({ by: ["postId"], where: { postId: { in: postIds } }, _sum: { value: true } }),
    userId ? db.postVote.findMany({ where: { postId: { in: postIds }, userId }, select: { postId: true, value: true } }) : Promise.resolve([]),
  ]);
  return {
    score: new Map(sums.map((r) => [r.postId, r._sum.value ?? 0])),
    mine: new Map(mine.map((r) => [r.postId, Math.sign(r.value) as -1 | 0 | 1])),
  };
}

/** Forum v2: mesajul unui moderator într-un topic („Adaugă mesaj”). */
export type GcsTopicNoticeView = { id: number; html: string; tone: "info" | "warn" | "ok" | "danger"; createdAt: string; author: GcsUserRef | null };

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
    /** Forum v2: nota (doar cu nota pornită pe forum), răspunsul recomandat, aprobarea per topic, arhivarea. */
    rating: { avg: number; count: number } | null;
    recommendedPostId: number | null;
    requireApproval: boolean;
    archivedAt: string | null;
  };
  forum: { id: number; type: ForumType; name: string; slug: string; options: GcsForumPageOptions };
  breadcrumb: GcsCrumb[];
  posts: GcsPostView[];
  /** Forum v2: răspunsul recomandat de staff (arătat sus pe prima pagină), dacă e vizibil vizitatorului. */
  recommended: GcsPostView | null;
  /** Forum v2: mesajele moderatorilor din topic. */
  notices: GcsTopicNoticeView[];
  pagination: GcsPagination;
  canReply: boolean;
  modPowers: string[];
  follow: { count: number; following: boolean };
  poll: GcsPollView | null;
  /** Reacțiile active (bara de reacții). */
  reactions: GcsReactionView[];
};

/** Forum v2: rezumatul unui topic lung: cei mai activi postatori, postările cu cele mai multe reacții, zilele active. */
export type GcsTopicSummary = {
  posters: { user: GcsUserRef; posts: number }[];
  popular: { postId: number; user: GcsUserRef | null; reactions: number; excerpt: string; at: string }[];
  days: { day: string; posts: number }[];
};

/** Forum v2: un topic din widget-ul „Cele mai bine notate”. */
export type GcsTopRatedTopic = { id: number; title: string; slug: string; avg: number; count: number };

export type GcsTagPage = { tag: { name: string; slug: string }; topics: GcsTopicRow[]; pagination: GcsPagination };

/** Un card al caruselului topicurilor recomandate. */
export type GcsFeaturedSlide = {
  id: number;
  title: string;
  slug: string;
  createdAt: string;
  user: GcsUserRef | null;
  forum: { id: number; name: string; slug: string; color: string | null } | null;
  excerpt: string;
  /** Prima imagine din primul mesaj (`/files/<id>` sau `https://`), altfel `null`. */
  image: string | null;
};

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
  /** Forum v2: opțiunile forumului (lipsesc în arborii cache-uiți înainte de Forum v2: valorile implicite). */
  options?: GcsForumPageOptions;
  /** Forum v2: pagina unui nod PAGE (topicurile de dedesubt și grupurile care o văd; gol = toți). */
  page?: { allowTopics: boolean; audience: number[] } | null;
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
  ...nameKeySelect,
  avatarFrame: { select: { key: true } },
} as const;

type UserRefRow = { id: string; name: string; image: string | null; primaryGroup: { key: string }; nameStyle: { key: string } | null; nameGroup?: { key: string } | null; avatarFrame: { key: string } | null };

export function toRef(u: UserRefRow): GcsUserRef {
  return { id: u.id, name: u.name, image: u.image, groupKey: u.primaryGroup.key, nameKey: nameKeyOf(u), frameKey: u.avatarFrame?.key ?? null };
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
      if (forums.length > 0) categories.push({ id: cat.id, name: cat.name, slug: cat.slug, color: cat.color, icon: cat.icon, forums });
    }
    return categories;
  }

  /**
   * `snippets`: începutul primei postări a fiecărui topic (setarea temei „Fragment în lista topicurilor”). Forum v2:
   * `sort` (implicit sortarea forumului), `minRating` (filtrul „4★+”, doar cu nota pornită), topicurile proprii pe
   * forumurile „doar topicurile mele” și pagina unui nod PAGE.
   */
  async forum(actor: GcsActor, forumId: number, opts: { page: number; prefixId?: number; snippets?: boolean; sort?: string; minRating?: number }): Promise<GcsForumPage> {
    const { db, settings } = this.deps;
    const tree = await this.tree();
    const node = tree.byId.get(forumId);
    const { viewable, readable } = await this.access(actor, tree);
    if (!node || !viewable.has(node.id)) throw new GcsNotFound();
    if (!readable.has(node.id)) throw new GcsForbidden({ permission: "forums.read" });

    const options = nodeOptions(node);
    const modPowers = await this.modPowers(actor, forumId);
    const isMod = modPowers.length > 0;
    const [perPage, pinnedFirst] = await Promise.all([settings.get<number>("forums.topics_per_page"), settings.get<boolean>("forums.pinned_first")]);
    const hostsTopics = node.type === "FORUM" || node.type === "QA" || (node.type === "PAGE" && (node.page?.allowTopics ?? false));
    const sort: GcsTopicSort = isTopicSort(opts.sort) && (opts.sort !== "rating" || options.ratingEnabled) ? opts.sort : options.defaultSort === "rating" && !options.ratingEnabled ? "last" : options.defaultSort;
    const minRating = options.ratingEnabled && opts.minRating !== undefined && opts.minRating >= 1 && opts.minRating <= 5 ? opts.minRating : null;
    const where: Prisma.TopicWhereInput = {
      forumId,
      ...this.visibilityFilter(actor, isMod),
      ...(opts.prefixId ? { prefixId: opts.prefixId } : {}),
      ...(minRating !== null ? { ratingAvg: { gte: minRating } } : {}),
    };
    // „Doar topicurile mele”: membrii văd doar topicurile lor, vizitatorii niciunul; moderatorii văd tot.
    if (options.ownTopicsOnly && !isMod) where.authorId = actor.userId ?? "__none__";

    const [total, rows] = hostsTopics
      ? await Promise.all([
          db.topic.count({ where }),
          db.topic.findMany({
            where,
            orderBy: [...(pinnedFirst ? [{ pinned: "desc" as const }] : []), ...topicOrder(sort), { id: "desc" }],
            skip: (Math.max(1, opts.page) - 1) * perPage,
            take: perPage,
            include: topicRowInclude,
          }),
        ])
      : [0, []];
    const [pageRow, rulesRow] = await Promise.all([
      node.type === "PAGE" ? db.forumPage.findUnique({ where: { forumId }, select: { contentHtml: true, ctaLabel: true, ctaUrl: true, ctaIcon: true, allowTopics: true } }) : null,
      options.rulesMode !== "off" ? db.forum.findUnique({ where: { id: forumId }, select: { rulesHtml: true } }) : null,
    ]);
    const subtreeIds = tree.subtree(forumId).filter((f) => readable.has(f.id)).map((f) => f.id);
    const firstIds = opts.snippets ? rows.map((t) => t.firstPostId).filter((id): id is number => id !== null) : [];
    const [posters, unreadTopics, unreadForums, firstPosts] = await Promise.all([
      this.users(rows.map((t) => t.lastPosterId)),
      this.deps.readMarkers.unreadTopicIds(actor.userId, rows.filter((t) => t.visibility === "VISIBLE")),
      this.deps.readMarkers.unreadForumIds(actor.userId, subtreeIds.filter((id) => id !== forumId)),
      firstIds.length > 0 ? db.post.findMany({ where: { id: { in: firstIds }, visibility: "VISIBLE" }, select: { id: true, contentJson: true } }) : [],
    ]);
    const snippets = new Map(firstPosts.map((p) => [p.id, docSnippet(p.contentJson, 160)]));

    return {
      forum: { id: node.id, type: node.type, name: node.name, slug: node.slug, description: node.description, linkUrl: node.linkUrl, icon: node.icon, color: node.color },
      breadcrumb: this.crumbs(tree, forumId, viewable),
      subforums: tree.childrenOf(forumId).filter((f) => viewable.has(f.id)).map((f) => this.row(tree, f, viewable, readable, unreadForums)),
      topics: rows.map((t) => {
        const row = topicRow(t, posters, unreadTopics, options.ratingEnabled);
        return opts.snippets ? { ...row, snippet: (t.firstPostId !== null ? snippets.get(t.firstPostId) : null) || null } : row;
      }),
      pagination: paginate(opts.page, perPage, total),
      canCreate: hostsTopics && actor.userId !== null && (await this.deps.permissions.can(actor, "forums.create", forumContainer(forumId))),
      modPowers,
      options,
      sort,
      minRating,
      page: pageRow
        ? { html: pageRow.contentHtml, ctaLabel: pageRow.ctaLabel, ctaUrl: pageRow.ctaUrl, ctaIcon: pageRow.ctaIcon, allowTopics: pageRow.allowTopics }
        : node.type === "PAGE"
          ? { html: "", ctaLabel: null, ctaUrl: null, ctaIcon: null, allowTopics: false }
          : null,
      rulesHtml: rulesRow?.rulesHtml ? rulesRow.rulesHtml : null,
    };
  }

  async topic(actor: GcsActor, topicId: number, opts: { page: number; locale?: string }): Promise<GcsTopicPage> {
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
    const options = nodeOptions(forum);
    // „Doar topicurile mele”: topicul altcuiva nu există pentru un membru fără puteri de moderare.
    if (options.ownTopicsOnly && modPowers.length === 0 && !isAuthor) throw new GcsNotFound();

    const [perPage, editMinutes, hideOwn, canReplyPerm] = await Promise.all([
      settings.get<number>("forums.posts_per_page"),
      permissions.groupValue<number | boolean>(actor, "forums.edit_own_minutes"),
      permissions.groupValue<boolean>(actor, "forums.hide_own"),
      actor.userId ? permissions.can(actor, "forums.reply", forumContainer(forum.id)) : Promise.resolve(false),
    ]);
    const page = Math.max(1, opts.page);
    const archived = topic.archivedAt !== null;
    const where: Prisma.PostWhereInput = { topicId, ...this.visibilityFilter(actor, modPowers.length > 0) };
    const postSelect = {
      id: true,
      authorId: true,
      contentHtml: true,
      hiddenParts: true,
      visibility: true,
      createdAt: true,
      editedAt: true,
      editedById: true,
      hiddenReason: true,
      ip: true,
    } as const;
    const [total, posts, noticeRows] = await Promise.all([
      db.post.count({ where }),
      db.post.findMany({ where, orderBy: { id: "asc" }, skip: (page - 1) * perPage, take: perPage, select: postSelect }),
      db.topicNotice.findMany({ where: { topicId }, orderBy: { id: "asc" }, take: 20 }),
    ]);
    // Răspunsul recomandat: doar pe prima pagină și doar dacă vizitatorul îl vede (regula de vizibilitate a postărilor).
    const recommendedRow =
      page === 1 && topic.recommendedPostId !== null && topic.recommendedPostId !== topic.firstPostId
        ? await db.post.findFirst({ where: { ...where, id: topic.recommendedPostId }, select: postSelect })
        : null;
    const recommendedNumber = recommendedRow ? await db.post.count({ where: { ...where, id: { lte: recommendedRow.id } } }) : 0;

    const all = recommendedRow ? [...posts, recommendedRow] : posts;
    const ids = [...new Set(all.map((p) => p.id))];
    const votes = forum.type === "QA" && ids.length > 0 && (await settings.get<boolean>("forums.qa_voting")) ? await postVotes(db, ids, actor.userId) : null;
    const userIds = [...new Set([...all.flatMap((p) => [p.authorId, p.editedById]), ...noticeRows.map((n) => n.authorId)].filter((id): id is string => id !== null))];
    const { follows, reactions, polls } = this.deps;
    const postKeys = ids.map(String);
    const [users, files, followCount, following, summary, myReactions, poll, reactionList, rankData, staffIds, reactorRows, isGlobalMod, ownVisiblePost] = await Promise.all([
      userIds.length === 0
        ? Promise.resolve([])
        : db.user.findMany({
            where: { id: { in: userIds } },
            select: {
              ...userRefSelect,
              postsCount: true,
              reputation: true,
              createdAt: true,
              signatureHtml: true,
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
      staffGroupIds(db),
      ids.length === 0
        ? Promise.resolve([])
        : db.contentReaction.findMany({
            where: { contentType: POST_CONTENT_TYPE, contentId: { in: postKeys } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1000,
            select: { contentId: true, user: { select: { id: true, name: true, ...nameKeySelect } } },
          }),
      actor.userId ? permissions.can(actor, "forums.moderate_all") : Promise.resolve(false),
      // „Răspunde ca să vezi”: vizitatorul are o postare vizibilă în topic.
      actor.userId ? db.post.findFirst({ where: { topicId, authorId: actor.userId, visibility: "VISIBLE" }, select: { id: true } }) : Promise.resolve(null),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const staff = new Set(staffIds);
    const now = Date.now();
    const inWindow = (createdAt: Date) =>
      editMinutes === -1 || (typeof editMinutes === "number" && editMinutes > 0 && now - createdAt.getTime() <= editMinutes * 60_000);
    const reactorsOf = new Map<string, { id: string; name: string; nameKey: string }[]>();
    for (const r of reactorRows) {
      const list = reactorsOf.get(r.contentId) ?? [];
      list.push({ id: r.user.id, name: r.user.name, nameKey: nameKeyOf(r.user) });
      reactorsOf.set(r.contentId, list);
    }
    const viewer = { userId: actor.userId, groupIds: actor.groupIds, replied: ownVisiblePost !== null || modPowers.length > 0 };
    const labels = hiddenLabels(opts.locale);

    const toView = (p: (typeof posts)[number], number: number): GcsPostView => {
      const author = p.authorId ? userMap.get(p.authorId) : undefined;
      const editor = p.editedById ? userMap.get(p.editedById) : undefined;
      const mine = actor.userId !== null && actor.userId === p.authorId;
      const list = reactorsOf.get(String(p.id)) ?? [];
      const reactedMine = actor.userId !== null && list.some((u) => u.id === actor.userId);
      const ordered = reactedMine ? [list.find((u) => u.id === actor.userId)!, ...list.filter((u) => u.id !== actor.userId)] : list;
      const totalReactions = (summary[String(p.id)] ?? []).reduce((n, r) => n + r.count, 0);
      return {
        id: p.id,
        number,
        html: revealHidden(p.contentHtml, p.hiddenParts, { ...viewer, isAuthor: mine, labels }),
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
              signatureHtml: author.signatureHtml,
            }
          : null,
        attachments: files.filter((f) => f.contentId === String(p.id)).map(({ contentId: _c, ...f }) => f),
        canEdit: !archived && (has(modPowers, "edit") || (mine && p.visibility !== "HIDDEN" && !topic.locked && inWindow(p.createdAt))),
        canHide: has(modPowers, "hide") || (!archived && mine && hideOwn === true && p.visibility === "VISIBLE"),
        reactions: summary[String(p.id)] ?? [],
        myReaction: myReactions[String(p.id)] ?? null,
        ip: isGlobalMod ? (p.ip ?? null) : null,
        staff: author ? staff.has(author.primaryGroupId) : false,
        reactors: { users: ordered.slice(0, 3), total: Math.max(totalReactions, list.length), mine: reactedMine },
        votes: votes ? { score: votes.score.get(p.id) ?? 0, mine: votes.mine.get(p.id) ?? 0 } : null,
      };
    };
    const views: GcsPostView[] = posts.map((p, i) => toView(p, (page - 1) * perPage + i + 1));

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
        rating: options.ratingEnabled ? { avg: topic.ratingAvg, count: topic.ratingCount } : null,
        recommendedPostId: topic.recommendedPostId,
        requireApproval: topic.requireApproval,
        archivedAt: topic.archivedAt?.toISOString() ?? null,
      },
      forum: { id: forum.id, type: forum.type, name: forum.name, slug: forum.slug, options },
      breadcrumb: this.crumbs(tree, forum.id, viewable),
      posts: views,
      recommended: recommendedRow ? toView(recommendedRow, recommendedNumber) : null,
      notices: noticeRows.map((n) => {
        const author = n.authorId ? userMap.get(n.authorId) : undefined;
        return { id: n.id, html: n.contentHtml, tone: isNoticeTone(n.tone) ? n.tone : "info", createdAt: n.createdAt.toISOString(), author: author ? toRef(author) : null };
      }),
      pagination: paginate(page, perPage, total),
      canReply:
        !archived &&
        canReplyPerm &&
        (topic.visibility === "VISIBLE" || has(modPowers, "approve")) &&
        (!topic.locked || has(modPowers, "lock")),
      modPowers,
      follow: { count: followCount, following },
      poll: poll ? { ...poll, canVote: poll.canVote && topic.visibility === "VISIBLE" && !archived } : null,
      reactions: reactionList,
    };
  }

  /** Topicurile vizibile cu un tag, din forumurile pe care actorul le poate citi. */
  /**
   * Poate actorul citi topicul (forum vizibil și citibil, topic vizibil pentru el) și răspunde în el?
   * Folosit de camerele `gcs-realtime` și de notificări (fără să încarce pagina topicului).
   */
  /**
   * Forum v2: rezumatul unui topic (postările vizibile): primii 5 postatori, primele 3 postări după reacții și primele 3
   * zile după numărul de postări. Apelantul a verificat deja că actorul vede topicul (pagina topicului).
   */
  async topicSummary(topicId: number): Promise<GcsTopicSummary> {
    const { db } = this.deps;
    const [posters, reacted, days] = await Promise.all([
      db.post.groupBy({ by: ["authorId"], where: { topicId, visibility: "VISIBLE", authorId: { not: null } }, _count: { _all: true }, orderBy: { _count: { authorId: "desc" } }, take: 5 }),
      db.$queryRaw<{ id: number; n: number }[]>`
        SELECT p.id, count(r.id)::int AS n FROM posts p JOIN content_reactions r ON r."contentType" = ${POST_CONTENT_TYPE} AND r."contentId" = p.id::text
        WHERE p."topicId" = ${topicId} AND p.visibility = 'VISIBLE' GROUP BY p.id ORDER BY n DESC, p.id ASC LIMIT 3`,
      db.$queryRaw<{ day: Date; n: number }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*)::int AS n FROM posts
        WHERE "topicId" = ${topicId} AND visibility = 'VISIBLE' GROUP BY 1 ORDER BY n DESC, day ASC LIMIT 3`,
    ]);
    const posts = reacted.length > 0 ? await db.post.findMany({ where: { id: { in: reacted.map((r) => r.id) } }, select: { id: true, authorId: true, contentJson: true, createdAt: true } }) : [];
    const users = await this.users([...posters.map((p) => p.authorId), ...posts.map((p) => p.authorId)]);
    const byId = new Map(posts.map((p) => [p.id, p]));
    return {
      posters: posters.flatMap((p) => {
        const user = p.authorId ? users.get(p.authorId) : undefined;
        return user ? [{ user, posts: p._count._all }] : [];
      }),
      popular: reacted.flatMap((r) => {
        const p = byId.get(r.id);
        return p && r.n > 0 ? [{ postId: p.id, user: p.authorId ? (users.get(p.authorId) ?? null) : null, reactions: r.n, excerpt: docSnippet(p.contentJson, 120), at: p.createdAt.toISOString() }] : [];
      }),
      days: days.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), posts: d.n })),
    };
  }

  /** Forum v2: „Popular acum”: topicurile din listă cu cel puțin `threshold` răspunsuri în ultimele 24 de ore. */
  async popularNow(topicIds: number[], threshold: number): Promise<Set<number>> {
    if (topicIds.length === 0 || threshold <= 0) return new Set();
    const rows = await this.deps.db.post.groupBy({
      by: ["topicId"],
      where: { topicId: { in: topicIds }, visibility: "VISIBLE", createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      _count: { _all: true },
    });
    return new Set(rows.filter((r) => r._count._all >= threshold).map((r) => r.topicId));
  }

  /** Forum v2: widget-ul „Cele mai bine notate”: topicurile notate din forumurile citibile, cu cel puțin `minVotes` voturi. */
  async topRated(actor: GcsActor, opts: { limit: number; minVotes: number; days: number }): Promise<GcsTopRatedTopic[]> {
    const tree = await this.tree();
    const { readable } = await this.access(actor, tree);
    const rated = [...readable].filter((id) => nodeOptions(tree.byId.get(id) ?? {}).ratingEnabled);
    if (rated.length === 0) return [];
    const rows = await this.deps.db.topic.findMany({
      where: {
        ...this.aggregateWhere(actor, tree, new Set(rated)),
        visibility: "VISIBLE",
        ratingCount: { gte: Math.max(1, opts.minVotes) },
        ...(opts.days > 0 ? { lastPostAt: { gte: new Date(Date.now() - opts.days * 86_400_000) } } : {}),
      },
      orderBy: [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { id: "desc" }],
      take: opts.limit,
      select: { id: true, title: true, slug: true, ratingAvg: true, ratingCount: true },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, slug: r.slug, avg: r.ratingAvg, count: r.ratingCount }));
  }

  async topicAccess(actor: GcsActor, topicId: number): Promise<{ canRead: boolean; canReply: boolean }> {
    const none = { canRead: false, canReply: false };
    const topic = await this.deps.db.topic.findUnique({
      where: { id: topicId },
      select: { forumId: true, authorId: true, visibility: true, locked: true, archivedAt: true, forum: { select: { ownTopicsOnly: true } } },
    });
    if (!topic) return none;
    const ref = forumContainer(topic.forumId);
    const [view, read] = await Promise.all([this.deps.permissions.can(actor, "forums.view", ref), this.deps.permissions.can(actor, "forums.read", ref)]);
    if (!view || !read) return none;
    const isAuthor = actor.userId !== null && actor.userId === topic.authorId;
    const needPowers = topic.visibility !== "VISIBLE" || topic.locked || (topic.forum.ownTopicsOnly && !isAuthor);
    const modPowers = needPowers ? await this.modPowers(actor, topic.forumId) : [];
    // Forum v2: „doar topicurile mele”: topicul altcuiva e doar al moderatorilor.
    if (topic.forum.ownTopicsOnly && !isAuthor && modPowers.length === 0) return none;
    const visible =
      topic.visibility === "VISIBLE" ||
      (topic.visibility === "PENDING" && (isAuthor || has(modPowers, "approve"))) ||
      (topic.visibility === "HIDDEN" && has(modPowers, "hide"));
    if (!visible) return none;
    const canReply =
      actor.userId !== null &&
      topic.archivedAt === null &&
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
    const where: Prisma.TopicWhereInput = { ...this.aggregateWhere(actor, tree, readable), visibility: "VISIBLE", tags: { some: { tagId: tag.id } } };
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
      where: { ...this.aggregateWhere(actor, tree, readable), visibility: "VISIBLE" },
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
      where: { visibility: "VISIBLE", topic: { ...this.aggregateWhere(actor, tree, readable), visibility: "VISIBLE" } },
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
      where: { ...this.aggregateWhere(actor, tree, readable), visibility: "VISIBLE", featured: true },
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
   * Caruselul topicurilor recomandate (`featured`) din forumurile citibile, cele mai noi primele: forumul (pastila),
   * data, titlul, extrasul și prima imagine din primul mesaj (sau `null`: cardul primește un gradient), autorul.
   */
  async featuredCarousel(actor: GcsActor, limit: number): Promise<GcsFeaturedSlide[]> {
    const tree = await this.tree();
    const { readable } = await this.access(actor, tree);
    if (readable.size === 0) return [];
    const rows = await this.deps.db.topic.findMany({
      where: { ...this.aggregateWhere(actor, tree, readable), visibility: "VISIBLE", featured: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, title: true, slug: true, createdAt: true, authorId: true, forumId: true, firstPostId: true },
    });
    const firstIds = rows.map((r) => r.firstPostId).filter((id): id is number => id !== null);
    const [users, posts] = await Promise.all([
      this.users(rows.map((r) => r.authorId)),
      firstIds.length > 0 ? this.deps.db.post.findMany({ where: { id: { in: firstIds }, visibility: "VISIBLE" }, select: { id: true, contentJson: true } }) : Promise.resolve([]),
    ]);
    const content = new Map(posts.map((p) => [p.id, p.contentJson]));
    return rows.map((r) => {
      const forum = tree.byId.get(r.forumId);
      const json = r.firstPostId !== null ? content.get(r.firstPostId) : undefined;
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        createdAt: r.createdAt.toISOString(),
        user: r.authorId ? (users.get(r.authorId) ?? null) : null,
        forum: forum ? { id: forum.id, name: forum.name, slug: forum.slug, color: forum.color ?? null } : null,
        excerpt: json ? docSnippet(json, 180) : "",
        image: json ? docFirstImage(json) : null,
      };
    });
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

  /** Statisticile comunității (coloana din dreapta și panoul de statistici), cache-uite 5 minute. */
  async stats(): Promise<{ topics: number; posts: number; members: number; newestMember: GcsNewestMember | null }> {
    const { cache, db } = this.deps;
    const cached = await cache.get<Awaited<ReturnType<GcsForumQueries["stats"]>>>("forums:stats");
    if (cached) return cached;
    const tree = await this.tree();
    const [members, newest] = await Promise.all([
      db.user.count(),
      db.user.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { ...userRefSelect, createdAt: true } }),
    ]);
    const stats = {
      topics: tree.data.forums.reduce((n, f) => n + f.topicsCount, 0),
      posts: tree.data.forums.reduce((n, f) => n + f.postsCount, 0),
      members,
      newestMember: newest ? { ...toRef(newest), joinedAt: newest.createdAt.toISOString() } : null,
    };
    await cache.set("forums:stats", stats, { ttlSec: STATS_TTL, tags: ["forums-tree"] });
    return stats;
  }

  /** Arborele forumurilor, cu titlurile ultimelor topicuri și ultimii autori (din cache). */
  private async tree(): Promise<GcsTree> {
    const { cache, db } = this.deps;
    const cached = await cache.get<TreeData>(TREE_KEY);
    if (cached) return new GcsTree(cached);

    const forums = await db.forum.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], include: { page: { select: { allowTopics: true, audienceGroupIds: true } } } });
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
        page: f.type === "PAGE" ? { allowTopics: f.page?.allowTopics ?? false, audience: jsonInts(f.page?.audienceGroupIds) } : null,
        options: {
          ownTopicsOnly: f.ownTopicsOnly,
          hasPassword: f.passwordHash !== null,
          rulesMode: f.rulesMode === "show" || f.rulesMode === "accept" ? f.rulesMode : "off",
          defaultSort: isTopicSort(f.defaultSort) ? f.defaultSort : "last",
          ratingEnabled: f.ratingEnabled,
          pollsEnabled: f.pollsEnabled,
          tagsEnabled: f.tagsEnabled,
          minPosts: f.minPosts,
        },
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
    const viewable = toIds(view);
    const readable = toIds(read);
    // Forum v2: o pagină cu public restrâns (grupuri) e doar a membrilor acelor grupuri (și a moderatorilor globali).
    const restricted = tree.data.forums.filter((f) => f.type === "PAGE" && (f.page?.audience.length ?? 0) > 0 && viewable.has(f.id));
    if (restricted.length > 0 && !(actor.userId && (await this.deps.permissions.can(actor, "forums.moderate_all")))) {
      for (const f of restricted) {
        if (f.page!.audience.some((g) => actor.groupIds.includes(g))) continue;
        viewable.delete(f.id);
        readable.delete(f.id);
      }
    }
    return { viewable, readable };
  }

  /**
   * Forum v2: filtrul listelor adunate din mai multe forumuri (topicuri recente, tag-uri, carusel…): forumurile citibile,
   * fără cele cu parolă, iar din cele „doar topicurile mele” doar topicurile actorului.
   */
  private aggregateWhere(actor: GcsActor, tree: GcsTree, readable: Set<number>): Prisma.TopicWhereInput {
    const open: number[] = [];
    const own: number[] = [];
    for (const id of readable) {
      const o = nodeOptions(tree.byId.get(id) ?? {});
      if (o.hasPassword) continue;
      (o.ownTopicsOnly ? own : open).push(id);
    }
    if (own.length === 0 || !actor.userId) return { forumId: { in: open } };
    return { OR: [{ forumId: { in: open } }, { forumId: { in: own }, authorId: actor.userId }] };
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
    const shareable = nodes.filter((n) => !nodeOptions(n).hasPassword && !nodeOptions(n).ownTopicsOnly);
    const latest = shareable.reduce<TreeForum | null>((best, n) => (n.lastPostId !== null && (best === null || n.lastPostId > best.lastPostId!) ? n : best), null);
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
      pageTopics: f.type === "PAGE" && (f.page?.allowTopics ?? false),
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

/** Ordinea topicurilor după sortarea aleasă (după `pinned`, dacă fixatele sunt primele). */
function topicOrder(sort: GcsTopicSort): Prisma.TopicOrderByWithRelationInput[] {
  switch (sort) {
    case "created":
      return [{ createdAt: "desc" }];
    case "replies":
      return [{ repliesCount: "desc" }, { lastPostAt: "desc" }];
    case "views":
      return [{ viewsCount: "desc" }, { lastPostAt: "desc" }];
    case "rating":
      return [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { lastPostAt: "desc" }];
    case "title":
      return [{ title: "asc" }];
    default:
      return [{ lastPostAt: "desc" }];
  }
}

const DEFAULT_OPTIONS: GcsForumPageOptions = {
  ownTopicsOnly: false,
  hasPassword: false,
  rulesMode: "off",
  defaultSort: "last",
  ratingEnabled: false,
  pollsEnabled: true,
  tagsEnabled: true,
  minPosts: 0,
};

/** Opțiunile unui nod din arbore (arborii cache-uiți înainte de Forum v2 nu le au: valorile implicite). */
function nodeOptions(node: { options?: GcsForumPageOptions | undefined }): GcsForumPageOptions {
  return node.options ?? DEFAULT_OPTIONS;
}

/** Un topic în listă (forum, pagina unui tag). `rated`: forumul are nota pornită (rândul arată stelele). */
function topicRow(t: TopicWithRow, posters: Map<string, GcsUserRef>, unread: Set<number>, rated = false): GcsTopicRow {
  return {
    rating: rated ? { avg: t.ratingAvg, count: t.ratingCount } : null,
    archived: t.archivedAt !== null,
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
