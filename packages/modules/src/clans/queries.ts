import { GcsForbidden, type GcsActor, type GcsAppService, type GcsCache, type GcsPermissionService } from "@gcs/core";
import { type ClanJoinMode, type ClanRole, type ClanStatus, type Prisma, type PrismaClient, ci } from "@gcs/db";
import { forumContainer } from "../forums/posting";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "../forums/queries";
import { readClanOptions, type GcsClanOptions, type GcsClanRight, type GcsClanTagPlace } from "./options";
import type { GcsClanAccess, GcsClanService } from "./service";
import { clanHref, readLinks, tagInk, type GcsClanLinks } from "./text";
import type { GcsSettingsService } from "@gcs/core";
import { sumPlayerStats, type GcsGroupGameStats, type GcsPlayerStatsAggregate } from "../servers/playerStats";
import type { GcsClanGameStatsSource } from "./gameStats";

export const CLANS_PER_PAGE = 24;
export const GCS_CLAN_SORTS = ["rank", "members", "newest"] as const;
export type GcsClanSort = (typeof GCS_CLAN_SORTS)[number];
export const GCS_CLAN_JOIN_FILTERS = ["open", "request", "invite"] as const;
export type GcsClanJoinFilter = (typeof GCS_CLAN_JOIN_FILTERS)[number];
const ROLE_ORDER: Record<ClanRole, number> = { LEADER: 0, OFFICER: 1, MEMBER: 2 };
const TOP_TTL = 300;
const ACTIVITY_LIMIT = 10;
/** Evenimentele publice din jurnalul unui clan („Activitate recentă”); excluderile și deciziile staff-ului nu apar. */
const PUBLIC_ACTIONS = ["clans.create", "clans.approve", "clans.join", "clans.request.accept", "clans.invite.accept", "clans.leave", "clans.promote", "clans.transfer"];

/** Un clan în director, în widget și în listele ACP. */
export type GcsClanCard = {
  id: number;
  tag: string;
  name: string;
  slug: string;
  href: string;
  color: string;
  color2: string;
  /** Culoarea textului pe plăcuța tagului (contrast calculat). */
  ink: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  membersCount: number;
  score: number;
  rank: number | null;
  joinMode: ClanJoinMode;
  status: ClanStatus;
  locked: boolean;
};

/** Tagul unui membru (postbit, hover card, profil). */
export type GcsClanTag = { id: number; tag: string; name: string; href: string; color: string; color2: string; ink: string; logoUrl: string | null; role: ClanRole };

export type GcsClanMemberView = { user: GcsUserRef; role: ClanRole; joinedAt: string };
/**
 * Statisticile de joc ale clanului (aplicația Servere, §15): totalurile și membrii cu statistici (cei mai activi primii).
 * `null` pe pagină = aplicația Servere e oprită (secțiunea nu apare).
 */
export type GcsClanGameView = { totals: GcsGroupGameStats | null; members: { user: GcsUserRef; stats: GcsPlayerStatsAggregate }[] };

export type GcsClanActivity = { kind: "created" | "approved" | "joined" | "left" | "promoted" | "leader"; at: string; user: GcsUserRef | null };

export type GcsClanDetails = GcsClanCard & {
  descriptionHtml: string;
  links: GcsClanLinks;
  lockReason: string | null;
  createdAt: string;
  memberLimit: number | null;
  scoreParts: { posts: number; reputation: number; active: number; members: number; game: { playtimeHours: number; kd: number; mixWins: number; elo: number | null } | null } | null;
  /** Statisticile de joc (doar cu aplicația Servere activă). */
  game: GcsClanGameView | null;
  members: GcsClanMemberView[];
  activity: GcsClanActivity[];
  forum: { id: number; name: string; slug: string; topics: { id: number; title: string; slug: string; lastPostAt: string }[] } | null;
  viewer: {
    role: ClanRole | null;
    staff: boolean;
    /** Are măcar un drept de administrare (pagina „Administrează”). */
    canManage: boolean;
    canJoin: boolean;
    canRequest: boolean;
    pendingRequest: boolean;
    invite: { id: number; invitedBy: GcsUserRef | null } | null;
    /** De ce nu poate intra (pentru un mesaj): oaspete, fără drept, deja în numărul maxim de clanuri. */
    blocked: "guest" | "no_permission" | "max_clans" | null;
    /** Un membru al clanului are contul Steam conectat (statisticile de joc); `null` = nu e membru sau aplicația Servere e oprită. */
    steamLinked: boolean | null;
  };
};

export type GcsClanRequestView = { id: number; user: GcsUserRef; message: string; createdAt: string; expiresAt: string; invitedBy: GcsUserRef | null };

/** Datele paginii de administrare. */
export type GcsClanManage = {
  clan: GcsClanDetails;
  access: GcsClanAccess;
  officerRights: GcsClanRight[];
  descriptionJson: unknown;
  logoId: string | null;
  bannerId: string | null;
  requests: GcsClanRequestView[];
  invites: GcsClanRequestView[];
  options: Pick<GcsClanOptions, "officerRights" | "forumMode" | "tagMin" | "tagMax" | "tagCharset" | "requiredFields" | "logoMaxKb" | "bannerMaxKb">;
  forumParentReady: boolean;
  /** Membrii cu Steam conectat (doar pentru lider și staff, doar cu aplicația Servere activă); `null` = nu se arată. */
  steam: Record<string, boolean> | null;
};

const clanSelect = {
  id: true,
  tag: true,
  name: true,
  slug: true,
  color: true,
  color2: true,
  logoId: true,
  bannerId: true,
  membersCount: true,
  score: true,
  rank: true,
  joinMode: true,
  status: true,
  locked: true,
} as const satisfies Prisma.ClanSelect;
type CardRow = Prisma.ClanGetPayload<{ select: typeof clanSelect }>;

export function toClanCard(c: CardRow): GcsClanCard {
  return {
    id: c.id,
    tag: c.tag,
    name: c.name,
    slug: c.slug,
    href: clanHref(c),
    color: c.color,
    color2: c.color2,
    ink: tagInk(c.color),
    logoUrl: c.logoId ? `/files/${c.logoId}` : null,
    bannerUrl: c.bannerId ? `/files/${c.bannerId}` : null,
    membersCount: c.membersCount,
    score: c.score,
    rank: c.rank,
    joinMode: c.joinMode,
    status: c.status,
    locked: c.locked,
  };
}

/** Citirile publice ale clanurilor (specul 2026-10-08-clanuri §7): directorul, pagina clanului, tagurile, widget-ul. */
export class GcsClanQueries {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      permissions: GcsPermissionService;
      settings: GcsSettingsService;
      apps: GcsAppService;
      clans: GcsClanService;
      /** Statisticile de joc din aplicația Servere (opționale, doar citire). */
      gameStats?: GcsClanGameStatsSource | null;
    },
  ) {}

  appEnabled(): Promise<boolean> {
    return this.deps.apps.enabled("clans");
  }

  /** Aplicația activă și `clans.view`. */
  async canView(actor: GcsActor): Promise<boolean> {
    return (await this.appEnabled()) && (await this.deps.permissions.can(actor, "clans.view"));
  }

  /** Vede viewer-ul acest clan (și imaginile lui)? Un clan în așteptare: doar fondatorul și staff-ul. */
  async canSeeClan(actor: GcsActor, clanId: number): Promise<boolean> {
    if (!Number.isInteger(clanId) || !(await this.canView(actor))) return false;
    const clan = await this.deps.db.clan.findUnique({ where: { id: clanId }, select: { id: true, status: true, locked: true, officerRights: true } });
    if (!clan) return false;
    if (clan.status !== "PENDING") return true;
    const access = await this.deps.clans.access(actor, clan);
    return access.staff || access.role !== null;
  }

  private async assertView(actor: GcsActor): Promise<void> {
    if (!(await this.canView(actor))) throw new GcsForbidden({ permission: "clans.view" });
  }

  options(): Promise<GcsClanOptions> {
    return readClanOptions(this.deps.settings);
  }

  /** Directorul: căutarea (tag sau nume), sortarea, filtrul pe recrutare și clanurile arhivate; 24 pe pagină. */
  async directory(
    actor: GcsActor,
    query: { q?: string; sort?: GcsClanSort; join?: GcsClanJoinFilter | null; archived?: boolean; page?: number },
  ): Promise<{ clans: GcsClanCard[]; pagination: GcsPagination; activeTotal: number }> {
    await this.assertView(actor);
    const { db } = this.deps;
    const q = (query.q ?? "").trim().slice(0, 40);
    const where: Prisma.ClanWhereInput = {
      status: query.archived ? "ARCHIVED" : "ACTIVE",
      ...(query.join ? { joinMode: query.join.toUpperCase() as ClanJoinMode } : {}),
      ...(q ? { OR: [{ tag: ci({ contains: q }) }, { name: ci({ contains: q }) }] } : {}),
    };
    const sort = query.sort ?? "rank";
    const orderBy: Prisma.ClanOrderByWithRelationInput[] =
      sort === "members"
        ? [{ membersCount: "desc" }, { id: "asc" }]
        : sort === "newest"
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ rank: { sort: "asc", nulls: "last" } }, { membersCount: "desc" }, { id: "asc" }];
    const [total, activeTotal] = await Promise.all([db.clan.count({ where }), db.clan.count({ where: { status: "ACTIVE" } })]);
    const pages = Math.max(1, Math.ceil(total / CLANS_PER_PAGE));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    const rows = await db.clan.findMany({ where, orderBy, skip: (page - 1) * CLANS_PER_PAGE, take: CLANS_PER_PAGE, select: clanSelect });
    return { clans: rows.map(toClanCard), pagination: { page, pages, perPage: CLANS_PER_PAGE, total }, activeTotal };
  }

  /**
   * Pagina clanului. `null` = nu există, aplicația e oprită, viewer-ul nu are `clans.view` sau clanul e în așteptare și
   * viewer-ul nu e fondatorul (membru) sau staff.
   */
  async details(actor: GcsActor, clanId: number): Promise<GcsClanDetails | null> {
    if (!(await this.canView(actor))) return null;
    const { db, permissions, clans } = this.deps;
    const clan = Number.isInteger(clanId) ? await db.clan.findUnique({ where: { id: clanId } }) : null;
    if (!clan) return null;
    const options = await this.options();
    const access = await clans.access(actor, clan, options);
    if (clan.status === "PENDING" && !access.staff && access.role === null) return null;

    const [members, log, invite, request, memberLimit, myClans, canJoinPerm] = await Promise.all([
      db.clanMember.findMany({ where: { clanId }, orderBy: [{ joinedAt: "asc" }], select: { role: true, joinedAt: true, user: { select: userRefSelect } } }),
      db.auditLog.findMany({ where: { targetType: "clan", targetId: String(clanId), action: { in: PUBLIC_ACTIONS } }, orderBy: { createdAt: "desc" }, take: ACTIVITY_LIMIT }),
      actor.userId ? db.clanRequest.findFirst({ where: { clanId, userId: actor.userId, kind: "INVITE", status: "PENDING", expiresAt: { gt: new Date() } }, include: { invitedBy: { select: userRefSelect } } }) : null,
      actor.userId ? db.clanRequest.findFirst({ where: { clanId, userId: actor.userId, kind: "REQUEST", status: "PENDING", expiresAt: { gt: new Date() } }, select: { id: true } }) : null,
      clans.memberLimit(clan),
      actor.userId ? db.clanMember.count({ where: { userId: actor.userId } }) : Promise.resolve(0),
      actor.userId ? permissions.can(actor, "clans.join") : Promise.resolve(false),
    ]);

    // Activitatea: utilizatorii din jurnal (actorul sau ținta evenimentului).
    const subject = (entry: (typeof log)[number]): string | null => {
      const after = (entry.after ?? {}) as Record<string, unknown>;
      const before = (entry.before ?? {}) as Record<string, unknown>;
      const id = entry.action === "clans.transfer" ? after.leaderId : (after.userId ?? before.userId ?? (entry.action === "clans.create" ? entry.actorId : null));
      return typeof id === "string" ? id : null;
    };
    const ids = [...new Set(log.map(subject).filter((id): id is string => id !== null))];
    const users = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: userRefSelect })).map((u) => [u.id, toRef(u)] as const));
    const kindOf: Record<string, GcsClanActivity["kind"]> = {
      "clans.create": "created",
      "clans.approve": "approved",
      "clans.join": "joined",
      "clans.request.accept": "joined",
      "clans.invite.accept": "joined",
      "clans.leave": "left",
      "clans.promote": "promoted",
      "clans.transfer": "leader",
    };
    const activity = log.map((entry) => {
      const id = subject(entry);
      return { kind: kindOf[entry.action]!, at: entry.createdAt.toISOString(), user: id ? (users.get(id) ?? null) : null };
    });

    // Forumul clanului: doar pentru cine îl poate citi (membrii, staff-ul ales); ultimele 5 topicuri vizibile.
    let forum: GcsClanDetails["forum"] = null;
    if (clan.forumId !== null && (await permissions.can(actor, "forums.read", forumContainer(clan.forumId)))) {
      const row = await db.forum.findUnique({ where: { id: clan.forumId }, select: { id: true, name: true, slug: true } });
      if (row) {
        const topics = await db.topic.findMany({
          where: { forumId: row.id, visibility: "VISIBLE" },
          orderBy: [{ lastPostAt: "desc" }, { id: "desc" }],
          take: 5,
          select: { id: true, title: true, slug: true, lastPostAt: true },
        });
        forum = { ...row, topics: topics.map((t) => ({ id: t.id, title: t.title, slug: t.slug, lastPostAt: t.lastPostAt.toISOString() })) };
      }
    }

    // Statisticile de joc (aplicația Servere activă): totalurile clanului și membrii cu statistici; Steam-ul viewer-ului membru.
    const gamesOn = Boolean(this.deps.gameStats) && (await this.deps.gameStats!.enabled());
    let game: GcsClanGameView | null = null;
    let steamLinked: boolean | null = null;
    if (gamesOn) {
      const stats = await this.deps.gameStats!.forUsers(
        members.map((m) => m.user.id),
        { scope: "all" },
      );
      const withStats = members.flatMap((m) => {
        const s = stats.get(m.user.id);
        return s ? [{ user: toRef(m.user), stats: s }] : [];
      });
      game = { totals: sumPlayerStats(withStats.map((m) => m.stats)), members: withStats.sort((a, b) => b.stats.playtimeSeconds - a.stats.playtimeSeconds).slice(0, 10) };
      if (access.role !== null && actor.userId) steamLinked = (await this.steamStatus([actor.userId]))[actor.userId] === true;
    }
    const open = clan.status === "ACTIVE" && !clan.locked;
    const blocked: GcsClanDetails["viewer"]["blocked"] = !actor.userId ? "guest" : !canJoinPerm ? "no_permission" : myClans >= options.maxPerMember ? "max_clans" : null;
    const parts = clan.scoreParts as Record<string, unknown>;
    return {
      ...toClanCard(clan),
      descriptionHtml: clan.descriptionHtml,
      links: readLinks(clan.links),
      lockReason: clan.lockReason,
      createdAt: clan.createdAt.toISOString(),
      memberLimit,
      scoreParts:
        typeof parts.members === "number"
          ? {
              posts: Number(parts.posts) || 0,
              reputation: Number(parts.reputation) || 0,
              active: Number(parts.active) || 0,
              members: parts.members,
              // Partea de joc a scorului se arată doar cu aplicația Servere activă.
              game: gamesOn && parts.game && typeof parts.game === "object" ? (parts.game as NonNullable<GcsClanDetails["scoreParts"]>["game"]) : null,
            }
          : null,
      game,
      members: members
        .map((m) => ({ user: toRef(m.user), role: m.role, joinedAt: m.joinedAt.toISOString() }))
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.localeCompare(b.joinedAt)),
      activity,
      forum,
      viewer: {
        role: access.role,
        staff: access.staff,
        canManage: access.staff || access.role === "LEADER" || Object.values(access.can).some(Boolean),
        canJoin: open && access.role === null && blocked === null && clan.joinMode === "OPEN",
        canRequest: open && access.role === null && blocked === null && clan.joinMode === "REQUEST" && !request,
        pendingRequest: request !== null,
        invite: invite && access.role === null ? { id: invite.id, invitedBy: invite.invitedBy ? toRef(invite.invitedBy) : null } : null,
        blocked: access.role === null ? blocked : null,
        steamLinked,
      },
    };
  }

  /** Datele administrării (lider, ofițeri cu vreun drept, staff); `null` = fără acces. */
  async manage(actor: GcsActor, clanId: number): Promise<GcsClanManage | null> {
    const details = await this.details(actor, clanId);
    if (!details || !details.viewer.canManage) return null;
    const { db, clans } = this.deps;
    const [clan, options] = await Promise.all([db.clan.findUniqueOrThrow({ where: { id: clanId } }), this.options()]);
    const access = await clans.access(actor, clan, options);
    const now = new Date();
    const rows = await db.clanRequest.findMany({
      where: { clanId, status: "PENDING", expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
      include: { user: { select: userRefSelect }, invitedBy: { select: userRefSelect } },
    });
    const view = (r: (typeof rows)[number]): GcsClanRequestView => ({
      id: r.id,
      user: toRef(r.user),
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      invitedBy: r.invitedBy ? toRef(r.invitedBy) : null,
    });
    const parent = options.forumParent > 0 ? await db.forum.findUnique({ where: { id: options.forumParent }, select: { type: true } }) : null;
    return {
      clan: details,
      access,
      officerRights: clan.officerRights as GcsClanRight[],
      descriptionJson: clan.descriptionJson,
      logoId: clan.logoId,
      bannerId: clan.bannerId,
      requests: access.can.requests ? rows.filter((r) => r.kind === "REQUEST").map(view) : [],
      invites: access.can.invite ? rows.filter((r) => r.kind === "INVITE").map(view) : [],
      options: {
        officerRights: options.officerRights,
        forumMode: options.forumMode,
        tagMin: options.tagMin,
        tagMax: options.tagMax,
        tagCharset: options.tagCharset,
        requiredFields: options.requiredFields,
        logoMaxKb: options.logoMaxKb,
        bannerMaxKb: options.bannerMaxKb,
      },
      forumParentReady: parent !== null && parent.type !== "LINK",
      steam: details.game !== null && access.leader ? await this.steamStatus(details.members.map((m) => m.user.id)) : null,
    };
  }

  /**
   * Care dintre membri au contul Steam conectat sau o identitate de joc legată prin cod (statisticile de joc ale
   * aplicației Servere, citite prin furnizorul ei).
   */
  private async steamStatus(userIds: string[]): Promise<Record<string, boolean>> {
    const [rows, games] = await Promise.all([
      this.deps.db.account.findMany({ where: { userId: { in: userIds }, providerId: "steam" }, select: { userId: true } }),
      this.deps.gameStats?.linkedUsers ? this.deps.gameStats.linkedUsers(userIds) : Promise.resolve(new Set<string>()),
    ]);
    const linked = new Set([...rows.map((r) => r.userId), ...games]);
    return Object.fromEntries(userIds.map((id) => [id, linked.has(id)]));
  }

  /** Invitațiile în așteptare ale viewer-ului (directorul le arată sus). */
  async invitations(actor: GcsActor): Promise<{ id: number; clan: GcsClanCard; invitedBy: GcsUserRef | null }[]> {
    if (!actor.userId || !(await this.canView(actor))) return [];
    const rows = await this.deps.db.clanRequest.findMany({
      where: { userId: actor.userId, kind: "INVITE", status: "PENDING", expiresAt: { gt: new Date() }, clan: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { clan: { select: clanSelect }, invitedBy: { select: userRefSelect } },
    });
    return rows.map((r) => ({ id: r.id, clan: toClanCard(r.clan), invitedBy: r.invitedBy ? toRef(r.invitedBy) : null }));
  }

  /**
   * Tagul afișat lângă numele fiecărui membru, dacă locul e ales în opțiuni (`clans.tag_places`): clanul activ în care
   * are rolul cel mai mare, apoi cel mai vechi. O singură interogare pentru toți membrii paginii.
   */
  async tagsFor(userIds: string[], place: GcsClanTagPlace): Promise<Map<string, GcsClanTag>> {
    const out = new Map<string, GcsClanTag>();
    const ids = [...new Set(userIds)];
    if (ids.length === 0 || !(await this.appEnabled())) return out;
    if (!(await this.options()).tagPlaces.includes(place)) return out;
    const rows = await this.deps.db.clanMember.findMany({
      where: { userId: { in: ids }, clan: { status: "ACTIVE" } },
      orderBy: { joinedAt: "asc" },
      select: { userId: true, role: true, clan: { select: clanSelect } },
    });
    for (const r of rows) {
      const current = out.get(r.userId);
      if (current && ROLE_ORDER[current.role] <= ROLE_ORDER[r.role]) continue;
      out.set(r.userId, tagOf(r.clan, r.role));
    }
    return out;
  }

  /** Clanurile active ale unui membru (profilul), cu opțiunile de afișare. */
  async memberClans(userId: string): Promise<{ clans: GcsClanTag[]; badge: boolean; tagOnName: boolean }> {
    if (!(await this.appEnabled())) return { clans: [], badge: false, tagOnName: false };
    const options = await this.options();
    const rows = await this.deps.db.clanMember.findMany({
      where: { userId, clan: { status: "ACTIVE" } },
      orderBy: { joinedAt: "asc" },
      select: { role: true, clan: { select: clanSelect } },
    });
    const clans = rows.map((r) => tagOf(r.clan, r.role)).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    return { clans, badge: options.profileBadge, tagOnName: options.tagPlaces.includes("profile") };
  }

  /** Primele clanuri din clasament (widget-ul „Top clanuri”), cache 5 minute pe tag-ul `clans`. */
  async top(limit: number): Promise<GcsClanCard[]> {
    const { db, cache } = this.deps;
    const n = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20);
    const key = `clans:top:${n}`;
    const cached = await cache.get<GcsClanCard[]>(key);
    if (cached) return cached;
    const rows = await db.clan.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { membersCount: "desc" }, { id: "asc" }],
      take: n,
      select: clanSelect,
    });
    const cards = rows.map(toClanCard);
    await cache.set(key, cards, { ttlSec: TOP_TTL, tags: ["clans"] });
    return cards;
  }
}

function tagOf(c: CardRow, role: ClanRole): GcsClanTag {
  return { id: c.id, tag: c.tag, name: c.name, href: clanHref(c), color: c.color, color2: c.color2, ink: tagInk(c.color), logoUrl: c.logoId ? `/files/${c.logoId}` : null, role };
}

/**
 * Clanurile active ale unui membru, cu rolul lui: interfața publică pentru alte aplicații (ex. categoria de descărcări
 * a unui clan, ale cărei drepturi vin din apartenență).
 */
export async function activeClanRoles(db: PrismaClient, userId: string): Promise<{ clanId: number; role: ClanRole }[]> {
  const rows = await db.clanMember.findMany({ where: { userId, clan: { status: "ACTIVE" } }, select: { clanId: true, role: true } });
  return rows.map((r) => ({ clanId: r.clanId, role: r.role }));
}
