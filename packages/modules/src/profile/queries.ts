import type { GcsActor, GcsCache, GcsPermissionService } from "@gcs/core";
import type { Badge, ContentVisibility, Prisma, PrismaClient } from "@gcs/db";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { forumContainer } from "../forums/posting";
import { statFor, THRESHOLD_TRIGGERS, userStats, type GcsThresholdTrigger } from "./achievements";
import { slugify } from "../forums/slug";
import { rankLabel, toUserDisplay, userDisplaySelect, type GcsRankDirectory, type GcsRankLabel, type GcsUserDisplay } from "./display";
import { normalizePrivacy } from "./privacy";
import type { GcsProfileService, GcsVisibleField } from "./profile";
import { actorOf, type GcsSocialService } from "./social";

/** Online = activitate în ultimele 15 minute (spec etapa 3 §2). `lastActiveAt` se scrie cel mult o dată la 5 minute. */
export const ONLINE_MS = 15 * 60_000;
const CARD_TTL = 60;
const WALL_PER_PAGE = 10;
const FOLLOWERS_PER_PAGE = 30;

/** Un badge obținut: `art` = adresa insignei generate, `image` = imaginea proprie din ACP (are prioritate). */
export type GcsBadgeView = { key: string; name: string; description: string; symbol: string | null; image: string | null; color: string; art: string; awardedAt: string };
/**
 * Un badge încă neobținut (grila profilului, specul 2026-10-07-insigne-grafice §6.3): cerința celei mai ușoare reguli
 * active care îl acordă și progresul membrului spre ea; `requirement: null` = acordat manual de echipă.
 */
export type GcsLockedBadge = Omit<GcsBadgeView, "awardedAt"> & {
  requirement: { trigger: GcsThresholdTrigger; threshold: number } | null;
  progress: { current: number; target: number } | null;
};

export type GcsLinkedAccount = { provider: "discord" | "steam"; accountId: string; url: string | null };
export type GcsOnline = { online: boolean; hidden: boolean; lastActiveAt: string | null };

export type GcsProfileView = {
  user: GcsUserDisplay & { slug: string; bio: string; accentColor: string | null; cover: { url: string; positionY: number } | null };
  stats: { posts: number; reputation: number; followers: number; points: number; joinedAt: string };
  online: GcsOnline;
  badges: GcsBadgeView[];
  fields: GcsVisibleField[];
  accounts: GcsLinkedAccount[];
  viewer: {
    isSelf: boolean;
    isFollowing: boolean;
    isIgnored: boolean;
    canFollow: boolean;
    /** Staff-ul nu poate fi ignorat. */
    canIgnore: boolean;
    canMessage: boolean;
    canPostWall: boolean;
    canModerate: boolean;
    canSeeWarnings: boolean;
  };
};

export type GcsCardView = {
  /** `cover`: URL-ul copertei; `coverPositionY`: poziția ei verticală salvată (0–100 %), ca pe profil. */
  user: GcsUserDisplay & { slug: string; bio: string; accentColor: string | null; cover: string | null; coverPositionY: number };
  stats: { posts: number; reputation: number; followers: number; joinedAt: string };
  online: GcsOnline;
  badges: GcsBadgeView[];
  fields: { label: string; value: string }[];
  viewer: { isSelf: boolean; isFollowing: boolean; canMessage: boolean; canFollow: boolean };
};

export type GcsActivityItem =
  | { kind: "post" | "topic"; at: string; topicId: number; topicTitle: string; topicSlug: string; postId: number; snippet: string }
  | { kind: "badge"; at: string; badge: GcsBadgeView };

export type GcsWallItem = {
  id: number;
  html: string;
  createdAt: string;
  visibility: ContentVisibility;
  author: GcsUserDisplay | null;
  canManage: boolean;
  replies: Omit<GcsWallItem, "replies">[];
};

type CardBase = Omit<GcsCardView, "online" | "viewer" | "user"> & {
  user: Omit<GcsCardView["user"], "rank">;
  rankId: number | null;
  primaryGroupId: number;
  lastActiveAt: string | null;
  privacy: unknown;
};

/** Textul simplu al unui HTML sanitizat (fără tag-uri), scurtat la `max` caractere. */
export function snippetOf(html: string, max = 160): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

type BadgeArtRow = Pick<Badge, "key" | "name" | "description" | "symbol" | "imageAttachmentId" | "color" | "manual" | "artShape" | "artTier" | "artIcon">;

/** Ce arată orice badge (obținut sau nu): nume, descriere, insignă sau imagine proprie. */
const badgeLook = (b: BadgeArtRow) => ({
  key: b.key,
  name: b.name,
  description: b.description,
  symbol: b.symbol,
  image: b.imageAttachmentId ? `/files/${b.imageAttachmentId}` : null,
  color: b.color,
  art: badgeArtSrc(b),
});

const badgeView = (b: { createdAt: Date; badge: BadgeArtRow }): GcsBadgeView => ({ ...badgeLook(b.badge), awardedAt: b.createdAt.toISOString() });

/** Citirile pentru profil, hover card și activitate (specul etapei 3, §8). Totul respectă confidențialitatea și permisiunile. */
export class GcsProfileQueries {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      permissions: GcsPermissionService;
      profiles: GcsProfileService;
      social: GcsSocialService;
      ranks: GcsRankDirectory;
    },
  ) {}

  /** Starea online: ascunsă celorlalți dacă userul a cerut-o; proprietarul și staff-ul o văd (marcată „ascuns”). */
  online(lastActiveAt: Date | string | null, privacy: unknown, opts: { isSelf: boolean; isModerator: boolean }, now = Date.now()): GcsOnline {
    const at = lastActiveAt ? new Date(lastActiveAt) : null;
    const hidden = !normalizePrivacy(privacy).showOnline;
    if (hidden && !opts.isSelf && !opts.isModerator) return { online: false, hidden: true, lastActiveAt: null };
    return { online: at !== null && now - at.getTime() <= ONLINE_MS, hidden, lastActiveAt: at?.toISOString() ?? null };
  }

  async userDisplays(ids: string[]): Promise<Map<string, GcsUserDisplay>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const [rows, ranks] = await Promise.all([this.deps.db.user.findMany({ where: { id: { in: unique } }, select: userDisplaySelect }), this.deps.ranks.data()]);
    return new Map(rows.map((r) => [r.id, toUserDisplay(r, ranks)]));
  }

  private async canMessage(viewer: GcsActor, userId: string, privacy: unknown): Promise<boolean> {
    if (!viewer.userId || viewer.userId === userId) return false;
    if (!(await this.deps.permissions.can(viewer, "pm.send"))) return false;
    return this.deps.social.allowsContact(viewer, userId, normalizePrivacy(privacy).messages, { staffBypass: true });
  }

  /** Pagina de profil. `null` = userul nu există sau viewer-ul nu are voie să-l vadă (pagina dă 404). */
  async profile(viewer: GcsActor, userId: string): Promise<GcsProfileView | null> {
    const { db, profiles, social, ranks } = this.deps;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        ...userDisplaySelect,
        bio: true,
        accentColor: true,
        coverAttachmentId: true,
        coverPositionY: true,
        privacy: true,
        postsCount: true,
        reputation: true,
        followersCount: true,
        points: true,
        createdAt: true,
        lastActiveAt: true,
        accounts: { where: { providerId: { in: ["discord", "steam"] } }, select: { providerId: true, accountId: true } },
        badges: { include: { badge: true }, orderBy: [{ badge: { position: "asc" } }, { createdAt: "asc" }] },
      },
    });
    if (!user || !(await profiles.canView(viewer, user))) return null;
    const isSelf = viewer.userId === userId;
    const isModerator = viewer.userId !== null && (await profiles.isModerator(viewer));
    const target = viewer.userId && !isSelf ? await actorOf(db, userId) : null;
    const [rankData, fields, isFollowing, isIgnored, canMessage, canPostWall, targetIsStaff] = await Promise.all([
      ranks.data(),
      profiles.visibleFields(viewer, userId),
      social.isFollowing(viewer.userId, userId),
      viewer.userId ? social.isIgnoring(viewer.userId, userId, "posts") : Promise.resolve(false),
      this.canMessage(viewer, userId, user.privacy),
      social.canPostOnWall(viewer, user),
      target ? this.deps.permissions.can(target, "profile.moderate") : Promise.resolve(true),
    ]);
    return {
      user: {
        ...toUserDisplay(user, rankData),
        slug: slugify(user.name),
        bio: user.bio,
        accentColor: user.accentColor,
        cover: user.coverAttachmentId ? { url: `/files/${user.coverAttachmentId}`, positionY: user.coverPositionY } : null,
      },
      stats: { posts: user.postsCount, reputation: user.reputation, followers: user.followersCount, points: user.points, joinedAt: user.createdAt.toISOString() },
      online: this.online(user.lastActiveAt, user.privacy, { isSelf, isModerator }),
      badges: user.badges.map(badgeView),
      fields,
      accounts: user.accounts.map((a) => ({
        provider: a.providerId as "discord" | "steam",
        accountId: a.accountId,
        url: a.providerId === "steam" && /^\d{17}$/.test(a.accountId) ? `https://steamcommunity.com/profiles/${a.accountId}` : null,
      })),
      viewer: {
        isSelf,
        isFollowing,
        isIgnored,
        canFollow: viewer.userId !== null && !isSelf,
        canIgnore: viewer.userId !== null && !isSelf && !targetIsStaff,
        canMessage,
        canPostWall,
        canModerate: isModerator,
        canSeeWarnings: isSelf || isModerator,
      },
    };
  }

  /** Datele comune ale cardului (fără partea care depinde de viewer), cache 60 s pe tag-ul `user:{id}`. */
  private async cardBase(userId: string): Promise<CardBase | null> {
    const { db, cache } = this.deps;
    // `v2`: vizualizarea badge-urilor are insigna (`art`); intrările vechi din cache nu o au.
    const key = `profile:card:v2:${userId}`;
    const cached = await cache.get<CardBase>(key);
    if (cached) return cached;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        ...userDisplaySelect,
        bio: true,
        accentColor: true,
        coverAttachmentId: true,
        coverPositionY: true,
        privacy: true,
        postsCount: true,
        reputation: true,
        followersCount: true,
        createdAt: true,
        lastActiveAt: true,
        badges: { include: { badge: true }, orderBy: { createdAt: "desc" }, take: 3 },
        profileValues: { where: { field: { showOnCard: true, visibility: "PUBLIC" } }, include: { field: true } },
      },
    });
    if (!user) return null;
    const display = toUserDisplay(user, { ranks: {}, overrides: {} });
    const base: CardBase = {
      user: {
        id: display.id,
        name: display.name,
        image: display.image,
        nameKey: display.nameKey,
        frameKey: display.frameKey,
        groupKey: display.groupKey,
        group: display.group,
        slug: slugify(user.name),
        bio: user.bio,
        accentColor: user.accentColor,
        cover: user.coverAttachmentId ? `/files/${user.coverAttachmentId}` : null,
        coverPositionY: user.coverPositionY,
      },
      rankId: user.rankId,
      primaryGroupId: user.primaryGroupId,
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      privacy: user.privacy,
      stats: { posts: user.postsCount, reputation: user.reputation, followers: user.followersCount, joinedAt: user.createdAt.toISOString() },
      badges: user.badges.map(badgeView),
      fields: user.profileValues
        .filter((v) => v.value !== "")
        .sort((a, b) => a.field.position - b.field.position)
        .map((v) => ({ label: v.field.label, value: v.value })),
    };
    await cache.set(key, base, { ttlSec: CARD_TTL, tags: [`user:${userId}`, "cosmetics", "badges"] });
    return base;
  }

  /** Hover card-ul. `null` = nu există sau nu e vizibil pentru viewer. */
  async card(viewer: GcsActor, userId: string): Promise<GcsCardView | null> {
    const { profiles, social, ranks } = this.deps;
    const base = await this.cardBase(userId);
    if (!base || !(await profiles.canView(viewer, { id: userId, privacy: base.privacy }))) return null;
    const isSelf = viewer.userId === userId;
    const isModerator = viewer.userId !== null && (await profiles.isModerator(viewer));
    const [rankData, isFollowing, canMessage] = await Promise.all([ranks.data(), social.isFollowing(viewer.userId, userId), this.canMessage(viewer, userId, base.privacy)]);
    const rank: GcsRankLabel | null = rankLabel(rankData, base.rankId, base.primaryGroupId);
    return {
      // `?? 50`: o intrare din cache scrisă înainte de câmpul nou.
      user: { ...base.user, coverPositionY: base.user.coverPositionY ?? 50, rank },
      stats: base.stats,
      online: this.online(base.lastActiveAt, base.privacy, { isSelf, isModerator }),
      badges: base.badges,
      fields: base.fields,
      viewer: { isSelf, isFollowing, canMessage, canFollow: viewer.userId !== null && !isSelf },
    };
  }

  /**
   * Toate badge-urile pentru tabul „Badge-uri”: cele obținute (cu data) și cele blocate (cu cerința și progresul).
   * Badge-urile automate fără nicio regulă activă nu se pot obține, deci nu apar. `null` = profil invizibil.
   */
  async badgeShowcase(viewer: GcsActor, userId: string, now = new Date()): Promise<{ earned: GcsBadgeView[]; locked: GcsLockedBadge[] } | null> {
    const { db, profiles } = this.deps;
    const owner = await db.user.findUnique({ where: { id: userId }, select: { id: true, privacy: true } });
    if (!owner || !(await profiles.canView(viewer, owner))) return null;
    const [earned, badges, stats] = await Promise.all([
      db.userBadge.findMany({ where: { userId }, include: { badge: true }, orderBy: [{ badge: { position: "asc" } }, { createdAt: "asc" }] }),
      db.badge.findMany({
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: { rules: { where: { enabled: true, trigger: { in: THRESHOLD_TRIGGERS } }, orderBy: [{ threshold: "asc" }, { id: "asc" }], take: 1 } },
      }),
      userStats(db, userId, now),
    ]);
    const owned = new Set(earned.map((e) => e.badgeId));
    const locked: GcsLockedBadge[] = [];
    for (const b of badges) {
      if (owned.has(b.id)) continue;
      const rule = b.rules[0];
      if (!rule && !b.manual) continue;
      const trigger = rule?.trigger as GcsThresholdTrigger | undefined;
      const target = Math.max(1, rule?.threshold ?? 0);
      locked.push({
        ...badgeLook(b),
        requirement: rule && trigger ? { trigger, threshold: rule.threshold } : null,
        progress: trigger && trigger !== "IS_VIP" && stats ? { current: Math.max(0, Math.min(target, statFor(trigger, stats))), target } : null,
      });
    }
    // Întâi cele care se pot câștiga (în ordinea din ACP), apoi cele acordate de echipă.
    locked.sort((a, b) => Number(a.requirement === null) - Number(b.requirement === null));
    return { earned: earned.map(badgeView), locked };
  }

  /** Activitatea: postări, topicuri noi și badge-uri, doar din forumurile pe care viewer-ul le poate citi. Paginare cu cursor (data). */
  async activity(viewer: GcsActor, userId: string, opts: { before?: string; limit?: number } = {}): Promise<{ items: GcsActivityItem[]; next: string | null }> {
    const { db, permissions } = this.deps;
    const limit = Math.min(opts.limit ?? 20, 50);
    const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before) : undefined;
    const forums = await db.forum.findMany({ select: { id: true } });
    const readable = await permissions.filterContainers(viewer, "forums.read", forums.map((f) => forumContainer(f.id)));
    const forumIds = [...readable].map(Number);
    const createdAt: Prisma.DateTimeFilter | undefined = before ? { lt: before } : undefined;
    const [posts, badges] = await Promise.all([
      forumIds.length === 0
        ? Promise.resolve([])
        : db.post.findMany({
            where: { authorId: userId, visibility: "VISIBLE", topic: { visibility: "VISIBLE", forumId: { in: forumIds } }, ...(createdAt ? { createdAt } : {}) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit,
            select: { id: true, contentHtml: true, createdAt: true, topic: { select: { id: true, title: true, slug: true, firstPostId: true } } },
          }),
      db.userBadge.findMany({ where: { userId, ...(createdAt ? { createdAt } : {}) }, orderBy: { createdAt: "desc" }, take: limit, include: { badge: true } }),
    ]);
    const items: GcsActivityItem[] = [
      ...posts.map((p) => ({
        kind: p.topic.firstPostId === p.id ? ("topic" as const) : ("post" as const),
        at: p.createdAt.toISOString(),
        topicId: p.topic.id,
        topicTitle: p.topic.title,
        topicSlug: p.topic.slug,
        postId: p.id,
        snippet: snippetOf(p.contentHtml),
      })),
      ...badges.map((b) => ({ kind: "badge" as const, at: b.createdAt.toISOString(), badge: badgeView(b) })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
    const more = posts.length === limit || badges.length === limit;
    return { items, next: more && items.length > 0 ? items[items.length - 1]!.at : null };
  }

  async followers(viewer: GcsActor, userId: string, page: number): Promise<{ users: GcsUserDisplay[]; total: number; pages: number } | null> {
    const { db, profiles } = this.deps;
    const owner = await db.user.findUnique({ where: { id: userId }, select: { id: true, privacy: true } });
    if (!owner || !(await profiles.canView(viewer, owner))) return null;
    const where = { contentType: "user", contentId: userId };
    const [rows, total] = await Promise.all([
      db.follow.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * FOLLOWERS_PER_PAGE, take: FOLLOWERS_PER_PAGE, select: { userId: true } }),
      db.follow.count({ where }),
    ]);
    const displays = await this.userDisplays(rows.map((r) => r.userId));
    return { users: rows.map((r) => displays.get(r.userId)).filter((u): u is GcsUserDisplay => u !== undefined), total, pages: Math.max(1, Math.ceil(total / FOLLOWERS_PER_PAGE)) };
  }

  /** Peretele: statusurile (cu răspunsurile lor), 10 pe pagină. Moderatorii văd și pe cele ascunse, marcate. */
  async wall(viewer: GcsActor, userId: string, page: number): Promise<{ items: GcsWallItem[]; total: number; pages: number } | null> {
    const { db, profiles } = this.deps;
    const owner = await db.user.findUnique({ where: { id: userId }, select: { id: true, privacy: true } });
    if (!owner || !(await profiles.canView(viewer, owner))) return null;
    const isModerator = viewer.userId !== null && (await profiles.isModerator(viewer));
    const visible: Prisma.StatusUpdateWhereInput = isModerator ? {} : { visibility: "VISIBLE" };
    const where: Prisma.StatusUpdateWhereInput = { profileUserId: userId, parentId: null, ...visible };
    const [rows, total] = await Promise.all([
      db.statusUpdate.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * WALL_PER_PAGE,
        take: WALL_PER_PAGE,
        include: { replies: { where: visible, orderBy: { id: "asc" } } },
      }),
      db.statusUpdate.count({ where }),
    ]);
    const displays = await this.userDisplays(rows.flatMap((r) => [r.authorId, ...r.replies.map((x) => x.authorId)]).filter((id): id is string => id !== null));
    const canManage = (authorId: string | null) => viewer.userId !== null && (isModerator || viewer.userId === authorId || viewer.userId === userId);
    const item = (s: { id: number; contentHtml: string; createdAt: Date; visibility: ContentVisibility; authorId: string | null }) => ({
      id: s.id,
      html: s.contentHtml,
      createdAt: s.createdAt.toISOString(),
      visibility: s.visibility,
      author: s.authorId ? (displays.get(s.authorId) ?? null) : null,
      canManage: canManage(s.authorId),
    });
    return { items: rows.map((r) => ({ ...item(r), replies: r.replies.map(item) })), total, pages: Math.max(1, Math.ceil(total / WALL_PER_PAGE)) };
  }

  /** Avertismentele: doar userul însuși și staff-ul (`null` pentru ceilalți). */
  async warnings(viewer: GcsActor, userId: string) {
    if (!viewer.userId) return null;
    if (viewer.userId !== userId && !(await this.deps.profiles.isModerator(viewer))) return null;
    return this.deps.db.warning.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, points: true, reason: true, expiresAt: true, createdAt: true, issuedBy: { select: { id: true, name: true } } },
    });
  }
}
