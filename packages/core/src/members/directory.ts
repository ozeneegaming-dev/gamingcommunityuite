import type { Ban, Prisma, PrismaClient, Warning } from "@gcs/db";
import { normalizeUsername } from "../auth/usernames";

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
/** „Online” în lista ACP: activ în ultimele 5 minute (staff-ul vede și membrii cu statusul ascuns). */
const ONLINE_MS = 5 * 60_000;
/** „Noi”: înscriși în ultimele 7 zile. */
const NEW_MS = 7 * 86_400_000;

/** Filtrele rapide ale listei ACP (Membri v2). */
export const GCS_MEMBER_QUICK_FILTERS = ["online", "new", "unvalidated", "banned", "spammers", "staff"] as const;
export type GcsMemberQuickFilter = (typeof GCS_MEMBER_QUICK_FILTERS)[number];
/** Coloanele după care se poate sorta lista ACP. */
export const GCS_ACP_MEMBER_SORTS = ["name", "group", "ip", "joined", "lastActive", "posts"] as const;
export type GcsAcpMemberSort = (typeof GCS_ACP_MEMBER_SORTS)[number];
/** Metodele de autentificare (furnizorul contului legat: parolă, Steam, Discord, Google). */
export const GCS_LOGIN_METHODS = ["credential", "steam", "discord", "google"] as const;
export type GcsLoginMethod = (typeof GCS_LOGIN_METHODS)[number];

/**
 * Căutarea avansată din ACP → Membri. Toate câmpurile sunt opționale și se combină (ȘI). `groupScope`: grupul ca
 * principal, ca secundar sau oricare.
 */
export type GcsMemberSearch = {
  q?: string;
  quick?: GcsMemberQuickFilter;
  groupId?: number;
  groupScope?: "any" | "primary" | "secondary";
  ip?: string;
  loginMethod?: GcsLoginMethod;
  twoFactor?: boolean;
  /** Codul țării (2 litere), din dispozitivele membrului. */
  country?: string;
  joinedFrom?: Date;
  joinedTo?: Date;
  activeFrom?: Date;
  activeTo?: Date;
  postsMin?: number;
  postsMax?: number;
};

export type GcsMemberListQuery = GcsMemberSearch & { sort?: GcsAcpMemberSort; dir?: "asc" | "desc"; page: number; perPage?: number };

export type GcsMemberListItem = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  postsCount: number;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  isSpammer: boolean;
  /** Ultimul IP văzut (sau cel de la înregistrare, pentru un cont importat). */
  ip: string | null;
  /** Are un ban de cont activ. */
  banned: boolean;
  primaryGroup: { id: number; key: string; name: string };
  secondaryCount: number;
};

export type GcsMemberDetail = Omit<GcsMemberListItem, "secondaryCount" | "banned" | "ip"> & {
  previousPrimaryGroupId: number | null;
  passwordResetRequestedAt: Date | null;
  secondaryGroups: { id: number; key: string; name: string; source: string; expiresAt: Date | null; addedAt: Date }[];
  bans: Ban[];
  warnings: (Warning & { issuedByName: string | null })[];
  /** IP-urile cunoscute (din sesiuni și jurnal). */
  ips: string[];
  /** Alte conturi văzute de pe aceleași IP-uri. */
  sharedIpAccounts: { id: string; name: string; groupKey: string; ip: string }[];
  /** Furnizorii conturilor legate (`credential`, `steam`, `discord`, `google`). */
  loginMethods: string[];
  /** 2FA blocat după prea multe coduri greșite. */
  twoFactorLocked: boolean;
};

const groupSelect = { id: true, key: true, name: true } as const;

/** Grupurile de staff: cele cu acces la moderare sau la ACP (din setările lor, nu din chei fixe). */
export async function staffGroupIds(db: PrismaClient | Prisma.TransactionClient): Promise<number[]> {
  const rows = await db.groupSetting.findMany({ where: { key: { in: ["mod.access", "acp.access"] } }, select: { groupId: true, value: true } });
  return [...new Set(rows.filter((r) => r.value === true).map((r) => r.groupId))];
}

/** Banul de cont activ (nescos și neexpirat). */
const activeBan = (now: Date): Prisma.BanWhereInput => ({ type: "ACCOUNT", liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/**
 * Condiția Prisma a unei căutări (lista, exportul CSV, acțiunile „toți cei filtrați”). `staffIds` = grupurile de staff
 * (necesare doar pentru filtrul rapid „Staff”).
 */
export function memberSearchWhere(s: GcsMemberSearch, ctx: { now: Date; staffIds: number[] }): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  const text = s.q?.trim();
  if (text) and.push({ OR: [{ nameNormalized: { contains: normalizeUsername(text) } }, { email: { contains: text.toLowerCase() } }] });
  if (s.groupId) {
    const primary: Prisma.UserWhereInput = { primaryGroupId: s.groupId };
    const secondary: Prisma.UserWhereInput = { groups: { some: { groupId: s.groupId } } };
    and.push(s.groupScope === "primary" ? primary : s.groupScope === "secondary" ? secondary : { OR: [primary, secondary] });
  }
  const ip = s.ip?.trim();
  if (ip) {
    and.push({
      OR: [{ lastIp: { contains: ip } }, { registrationIp: { contains: ip } }, { sessions: { some: { ipAddress: { contains: ip } } } }, { devices: { some: { ip: { contains: ip } } } }],
    });
  }
  if (s.loginMethod) and.push({ accounts: { some: { providerId: s.loginMethod } } });
  if (s.twoFactor !== undefined) and.push({ twoFactorEnabled: s.twoFactor });
  const country = s.country?.trim().toUpperCase();
  if (country) and.push({ devices: { some: { location: country } } });
  if (s.joinedFrom || s.joinedTo) and.push({ createdAt: { ...(s.joinedFrom ? { gte: s.joinedFrom } : {}), ...(s.joinedTo ? { lte: s.joinedTo } : {}) } });
  if (s.activeFrom || s.activeTo) and.push({ lastActiveAt: { ...(s.activeFrom ? { gte: s.activeFrom } : {}), ...(s.activeTo ? { lte: s.activeTo } : {}) } });
  if (s.postsMin !== undefined || s.postsMax !== undefined) {
    and.push({ postsCount: { ...(s.postsMin !== undefined ? { gte: s.postsMin } : {}), ...(s.postsMax !== undefined ? { lte: s.postsMax } : {}) } });
  }
  switch (s.quick) {
    case "online":
      and.push({ lastActiveAt: { gte: new Date(ctx.now.getTime() - ONLINE_MS) } });
      break;
    case "new":
      and.push({ createdAt: { gte: new Date(ctx.now.getTime() - NEW_MS) } });
      break;
    case "unvalidated":
      and.push({ emailVerified: false });
      break;
    case "banned":
      and.push({ OR: [{ bans: { some: activeBan(ctx.now) } }, { primaryGroup: { key: "banned" } }] });
      break;
    case "spammers":
      and.push({ isSpammer: true });
      break;
    case "staff":
      and.push({ OR: [{ primaryGroupId: { in: ctx.staffIds } }, { groups: { some: { groupId: { in: ctx.staffIds } } } }] });
      break;
  }
  return and.length > 0 ? { AND: and } : {};
}

function orderFor(sort: GcsAcpMemberSort | undefined, dir: "asc" | "desc" | undefined): Prisma.UserOrderByWithRelationInput[] {
  const d = dir ?? (sort === "joined" || sort === "lastActive" || sort === "posts" ? "desc" : "asc");
  switch (sort) {
    case "group":
      return [{ primaryGroup: { position: d } }, { nameNormalized: "asc" }];
    case "ip":
      return [{ lastIp: { sort: d, nulls: "last" } }, { nameNormalized: "asc" }];
    case "joined":
      return [{ createdAt: d }, { id: d }];
    case "lastActive":
      return [{ lastActiveAt: { sort: d, nulls: "last" } }, { nameNormalized: "asc" }];
    case "posts":
      return [{ postsCount: d }, { nameNormalized: "asc" }];
    default:
      return [{ nameNormalized: d }];
  }
}

/** Lista și fișa membrilor din ACP (ACP → Membri). Doar citire; scrierile trec prin serviciile de grupuri și moderare. */
export class GcsMemberDirectory {
  constructor(private readonly deps: { db: PrismaClient }) {}

  /** Condiția Prisma a unei căutări, cu grupurile de staff aduse din baza de date. */
  async where(s: GcsMemberSearch, now = new Date()): Promise<Prisma.UserWhereInput> {
    return memberSearchWhere(s, { now, staffIds: s.quick === "staff" ? await staffGroupIds(this.deps.db) : [] });
  }

  async list(q: GcsMemberListQuery, now = new Date()): Promise<{
    items: GcsMemberListItem[];
    total: number;
    page: number;
    pages: number;
  }> {
    const where = await this.where(q, now);
    const perPage = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(q.perPage ?? PAGE_SIZE)));
    const page = Math.max(1, Math.floor(q.page) || 1);
    const [total, rows] = await Promise.all([
      this.deps.db.user.count({ where }),
      this.deps.db.user.findMany({
        where,
        orderBy: orderFor(q.sort, q.dir),
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          createdAt: true,
          lastActiveAt: true,
          postsCount: true,
          emailVerified: true,
          twoFactorEnabled: true,
          isSpammer: true,
          lastIp: true,
          registrationIp: true,
          primaryGroup: { select: groupSelect },
          _count: { select: { groups: true } },
          bans: { where: activeBan(now), select: { id: true }, take: 1 },
        },
      }),
    ]);
    const items = rows.map(({ _count, bans, lastIp, registrationIp, ...r }) => ({
      ...r,
      ip: lastIp ?? registrationIp,
      banned: bans.length > 0 || r.primaryGroup.key === "banned",
      secondaryCount: _count.groups,
    }));
    return { items, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /** Id-urile tuturor membrilor care se potrivesc (acțiunile în masă pe „toți cei filtrați”), cel mult `limit`. */
  async ids(s: GcsMemberSearch, limit = 5000, now = new Date()): Promise<string[]> {
    const rows = await this.deps.db.user.findMany({ where: await this.where(s, now), select: { id: true }, orderBy: { nameNormalized: "asc" }, take: limit });
    return rows.map((r) => r.id);
  }

  async detail(id: string): Promise<GcsMemberDetail | null> {
    const { db } = this.deps;
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        lastActiveAt: true,
        postsCount: true,
        emailVerified: true,
        twoFactorEnabled: true,
        isSpammer: true,
        previousPrimaryGroupId: true,
        passwordResetRequestedAt: true,
        primaryGroup: { select: groupSelect },
        groups: { select: { source: true, expiresAt: true, addedAt: true, group: { select: groupSelect } }, orderBy: { group: { position: "asc" } } },
        bans: { orderBy: { createdAt: "desc" } },
        warnings: { orderBy: { createdAt: "desc" }, include: { issuedBy: { select: { name: true } } } },
        sessions: { select: { ipAddress: true } },
        accounts: { select: { providerId: true } },
        twoFactors: { select: { lockedUntil: true } },
        registrationIp: true,
        lastIp: true,
      },
    });
    if (!user) return null;

    const audit = await db.auditLog.findMany({
      where: { actorId: id, ip: { not: null } },
      select: { ip: true },
      distinct: ["ip"],
      take: 50,
    });
    const ips = [
      // Plus IP-ul de înregistrare al unui membru importat din altă platformă.
      ...new Set([user.lastIp, ...user.sessions.map((s) => s.ipAddress), ...audit.map((a) => a.ip), user.registrationIp].filter((ip): ip is string => !!ip)),
    ];

    const shared = ips.length
      ? await db.session.findMany({
          where: { ipAddress: { in: ips }, userId: { not: id } },
          select: { ipAddress: true, user: { select: { id: true, name: true, primaryGroup: { select: { key: true } } } } },
          distinct: ["userId"],
          take: 50,
        })
      : [];

    const { groups, sessions: _sessions, warnings, accounts, twoFactors, registrationIp: _r, lastIp: _l, ...rest } = user;
    const now = Date.now();
    return {
      ...rest,
      secondaryGroups: groups.map((g) => ({ ...g.group, source: g.source, expiresAt: g.expiresAt, addedAt: g.addedAt })),
      warnings: warnings.map(({ issuedBy, ...w }) => ({ ...w, issuedByName: issuedBy?.name ?? null })),
      ips,
      sharedIpAccounts: shared.map((s) => ({
        id: s.user.id,
        name: s.user.name,
        groupKey: s.user.primaryGroup.key,
        ip: s.ipAddress ?? "",
      })),
      loginMethods: [...new Set(accounts.map((a) => a.providerId))],
      twoFactorLocked: twoFactors.some((t) => t.lockedUntil !== null && t.lockedUntil.getTime() > now),
    };
  }
}
