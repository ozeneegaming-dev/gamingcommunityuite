import type { Prisma, PrismaClient } from "@gcs/db";

export type GcsAuditEntry = {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

/** Valoarea scrisă în jurnal în locul unui secret. */
export const AUDIT_REDACTED = "[ascuns]";

/** Scrie o intrare în jurnalul ACP (spec §12.6). Acceptă și clientul unei tranzacții. */
export async function writeAudit(
  db: Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient,
  entry: GcsAuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      ip: entry.ip ?? null,
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
}

export type GcsAuditQuery = { actorId?: string; action?: string; from?: Date; to?: Date; page: number };
export type GcsAuditItem = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: Date;
};

const AUDIT_PAGE_SIZE = 50;

/** Jurnalul ACP (spec §12.6), cele mai noi primele, cu filtre pe actor, acțiune (prefix) și interval. */
export async function queryAudit(
  db: Pick<PrismaClient, "auditLog" | "user">,
  q: GcsAuditQuery,
): Promise<{ items: GcsAuditItem[]; total: number; page: number; pages: number }> {
  const where: Prisma.AuditLogWhereInput = {};
  if (q.actorId) where.actorId = q.actorId;
  if (q.action) where.action = { startsWith: q.action };
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const page = Math.max(1, Math.floor(q.page) || 1);

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
  ]);
  const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: rows.map((r) => ({ ...r, actorName: r.actorId ? (names.get(r.actorId) ?? null) : null })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}
