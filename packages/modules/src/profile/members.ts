import { GcsForbidden, normalizeUsername, type GcsActor, type GcsPermissionService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "../forums/queries";
import { rankLabel, type GcsRankDirectory, type GcsRankLabel } from "./display";
import type { GcsGroupDirectory } from "./groupDirectory";
import { normalizePrivacy } from "./privacy";

export const MEMBERS_PER_PAGE = 24;
const ONLINE_MS = 5 * 60_000;
export const GCS_MEMBER_SORTS = ["joined", "posts", "reputation", "name"] as const;
export type GcsMemberSort = (typeof GCS_MEMBER_SORTS)[number];

/** Un membru în listă (card): grupul, rangul, contoarele, data înscrierii și statusul online. */
export type GcsMemberCard = GcsUserRef & {
  group: { id: number; name: string; color: string | null };
  /** În lista unui grup: membrul îl are ca grup secundar (eticheta „secundar”). */
  secondary?: boolean;
  rank: GcsRankLabel | null;
  customTitle: string | null;
  postsCount: number;
  reputation: number;
  joinedAt: string;
  online: boolean;
};

export type GcsMemberListQuery = { q?: string; groupId?: number | null; sort?: GcsMemberSort; online?: boolean; page: number };
export type GcsStaffGroup = { id: number; key: string; name: string; color: string | null; icon: string | null; members: GcsMemberCard[] };

const cardSelect = {
  ...userRefSelect,
  rankId: true,
  primaryGroupId: true,
  customTitle: true,
  postsCount: true,
  reputation: true,
  createdAt: true,
  lastActiveAt: true,
  privacy: true,
  primaryGroup: { select: { key: true, name: true, title: true, color: true } },
} as const satisfies Prisma.UserSelect;

type CardRow = Prisma.UserGetPayload<{ select: typeof cardSelect }>;

/**
 * Lista de membri și lista staff-ului (specul etapei 5): carduri cu grupul, rangul, contoarele și statusul online.
 * Accesul cere `core.members_list`. Căutarea merge fără diacritice (pe numele normalizat).
 */
export class GcsMemberList {
  constructor(private readonly deps: { db: PrismaClient; permissions: GcsPermissionService; ranks: GcsRankDirectory; groups?: GcsGroupDirectory }) {}

  private async assertAccess(viewer: GcsActor): Promise<void> {
    if (viewer.isBanned || !(await this.deps.permissions.can(viewer, "core.members_list"))) throw new GcsForbidden({ permission: "core.members_list" });
  }

  private card(row: CardRow, ranks: Awaited<ReturnType<GcsRankDirectory["data"]>>, now: number): GcsMemberCard {
    const privacy = normalizePrivacy(row.privacy);
    return {
      ...toRef(row),
      group: { id: row.primaryGroupId, name: row.primaryGroup.title ?? row.primaryGroup.name, color: row.primaryGroup.color },
      rank: rankLabel(ranks, row.rankId, row.primaryGroupId),
      customTitle: row.customTitle,
      postsCount: row.postsCount,
      reputation: row.reputation,
      joinedAt: row.createdAt.toISOString(),
      online: privacy.showOnline && row.lastActiveAt !== null && now - row.lastActiveAt.getTime() <= ONLINE_MS,
    };
  }

  async list(viewer: GcsActor, query: GcsMemberListQuery, now = Date.now()): Promise<{ members: GcsMemberCard[]; pagination: GcsPagination }> {
    await this.assertAccess(viewer);
    const { db, ranks } = this.deps;
    const q = query.q ? normalizeUsername(query.q).slice(0, 40) : "";
    const since = new Date(now - ONLINE_MS);
    // „Online”: activ în ultimele 5 minute; cei cu statusul ascuns nu apar. Ascunșii se caută separat: un
    // `NOT { privacy.showOnline = false }` ar scoate și conturile fără setarea asta (NULL în SQL), adică aproape pe toți.
    const hidden = query.online
      ? (await db.user.findMany({ where: { lastActiveAt: { gte: since }, privacy: { path: ["showOnline"], equals: false } }, select: { id: true } })).map((u) => u.id)
      : [];
    // Membrii grupului: principal sau secundar (linkul unei pastile de grup), sau doar principal dacă grupul cere.
    const group = query.groupId && this.deps.groups ? await this.deps.groups.group(query.groupId) : null;
    const primaryOnly = group?.primaryOnly === true;
    const where: Prisma.UserWhereInput = {
      ...(q ? { nameNormalized: { contains: q } } : {}),
      ...(query.groupId ? (primaryOnly ? { primaryGroupId: query.groupId } : { OR: [{ primaryGroupId: query.groupId }, { groups: { some: { groupId: query.groupId } } }] }) : {}),
      ...(query.online ? { lastActiveAt: { gte: since }, ...(hidden.length ? { id: { notIn: hidden } } : {}) } : {}),
    };
    const sort = query.sort ?? "joined";
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      sort === "posts"
        ? [{ postsCount: "desc" }, { createdAt: "asc" }]
        : sort === "reputation"
          ? [{ reputation: "desc" }, { createdAt: "asc" }]
          : sort === "name"
            ? [{ nameNormalized: "asc" }]
            : [{ createdAt: "desc" }, { id: "desc" }];
    const page = Math.max(1, Math.floor(query.page) || 1);
    const [total, rows, rankData] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({ where, orderBy, skip: (page - 1) * MEMBERS_PER_PAGE, take: MEMBERS_PER_PAGE, select: cardSelect }),
      ranks.data(),
    ]);
    const members = rows.map((r) => ({ ...this.card(r, rankData, now), ...(query.groupId ? { secondary: r.primaryGroupId !== query.groupId } : {}) }));
    return { members, pagination: { page, pages: Math.max(1, Math.ceil(total / MEMBERS_PER_PAGE)), perPage: MEMBERS_PER_PAGE, total } };
  }

  /** Grupurile pentru filtrul listei (fără Vizitator). */
  async groups(): Promise<{ id: number; name: string }[]> {
    return this.deps.db.group.findMany({ where: { key: { notIn: ["guest"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } });
  }

  /**
   * Staff-ul, grupat pe grupuri: grupurile cu acces la moderare sau la ACP (din permisiunile lor, nu din chei fixe),
   * în ordinea din ACP; un membru apare la grupul lui principal.
   */
  async staff(viewer: GcsActor, now = Date.now()): Promise<GcsStaffGroup[]> {
    await this.assertAccess(viewer);
    const { db, ranks } = this.deps;
    const settings = await db.groupSetting.findMany({ where: { key: { in: ["mod.access", "acp.access"] } }, select: { groupId: true, value: true } });
    const ids = [...new Set(settings.filter((s) => s.value === true).map((s) => s.groupId))];
    if (ids.length === 0) return [];
    const [groups, rows, rankData] = await Promise.all([
      db.group.findMany({ where: { id: { in: ids } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, key: true, name: true, color: true, icon: true } }),
      db.user.findMany({ where: { primaryGroupId: { in: ids } }, orderBy: [{ nameNormalized: "asc" }], select: cardSelect, take: 500 }),
      ranks.data(),
    ]);
    return groups
      .map((g) => ({ ...g, members: rows.filter((r) => r.primaryGroupId === g.id).map((r) => this.card(r, rankData, now)) }))
      .filter((g) => g.members.length > 0);
  }
}
