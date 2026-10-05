import type { Ban, Prisma, PrismaClient, Warning } from "@gcs/db";
import { normalizeUsername } from "../auth/usernames";

const PAGE_SIZE = 25;

export type GcsMemberListItem = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  primaryGroup: { id: number; key: string; name: string };
};

export type GcsMemberDetail = GcsMemberListItem & {
  image: string | null;
  twoFactorEnabled: boolean;
  previousPrimaryGroupId: number | null;
  secondaryGroups: { id: number; key: string; name: string }[];
  bans: Ban[];
  warnings: (Warning & { issuedByName: string | null })[];
  /** IP-urile cunoscute (din sesiuni și jurnal). */
  ips: string[];
  /** Alte conturi văzute de pe aceleași IP-uri. */
  sharedIpAccounts: { id: string; name: string; groupKey: string; ip: string }[];
};

const groupSelect = { id: true, key: true, name: true } as const;

/** Lista și fișa membrilor din ACP (ACP → Membri). Doar citire; scrierile trec prin serviciile de grupuri și moderare. */
export class GcsMemberDirectory {
  constructor(private readonly deps: { db: PrismaClient }) {}

  async list(q: { q?: string; groupId?: number; page: number }): Promise<{
    items: GcsMemberListItem[];
    total: number;
    page: number;
    pages: number;
  }> {
    const where: Prisma.UserWhereInput = {};
    const search = q.q?.trim();
    if (search) {
      where.OR = [
        { nameNormalized: { contains: normalizeUsername(search) } },
        { email: { contains: search.toLowerCase() } },
      ];
    }
    if (q.groupId) {
      where.AND = [{ OR: [{ primaryGroupId: q.groupId }, { groups: { some: { groupId: q.groupId } } }] }];
    }
    const page = Math.max(1, Math.floor(q.page) || 1);
    const [total, items] = await Promise.all([
      this.deps.db.user.count({ where }),
      this.deps.db.user.findMany({
        where,
        orderBy: { nameNormalized: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, name: true, email: true, createdAt: true, lastActiveAt: true, primaryGroup: { select: groupSelect } },
      }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
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
        twoFactorEnabled: true,
        previousPrimaryGroupId: true,
        primaryGroup: { select: groupSelect },
        groups: { select: { group: { select: groupSelect } } },
        bans: { orderBy: { createdAt: "desc" } },
        warnings: { orderBy: { createdAt: "desc" }, include: { issuedBy: { select: { name: true } } } },
        sessions: { select: { ipAddress: true } },
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
      ...new Set([...user.sessions.map((s) => s.ipAddress), ...audit.map((a) => a.ip)].filter((ip): ip is string => !!ip)),
    ];

    const shared = ips.length
      ? await db.session.findMany({
          where: { ipAddress: { in: ips }, userId: { not: id } },
          select: { ipAddress: true, user: { select: { id: true, name: true, primaryGroup: { select: { key: true } } } } },
          distinct: ["userId"],
          take: 50,
        })
      : [];

    const { groups, sessions: _sessions, warnings, ...rest } = user;
    return {
      ...rest,
      secondaryGroups: groups.map((g) => g.group),
      warnings: warnings.map(({ issuedBy, ...w }) => ({ ...w, issuedByName: issuedBy?.name ?? null })),
      ips,
      sharedIpAccounts: shared.map((s) => ({
        id: s.user.id,
        name: s.user.name,
        groupKey: s.user.primaryGroup.key,
        ip: s.ipAddress ?? "",
      })),
    };
  }
}
