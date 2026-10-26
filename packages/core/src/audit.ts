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

export type GcsAuditQuery = { actorId?: string; action?: string; targetType?: string; targetId?: string; from?: Date; to?: Date; page: number };
export type GcsAuditItem = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  /** Numele membrului-țintă, când ținta e un user. */
  targetName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: Date;
};

const AUDIT_PAGE_SIZE = 50;
/** Exportul CSV: cel mult atâtea rânduri (cele mai noi). */
export const AUDIT_EXPORT_LIMIT = 10_000;

function auditWhere(q: Omit<GcsAuditQuery, "page">): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (q.actorId) where.actorId = q.actorId;
  if (q.action) where.action = { startsWith: q.action };
  if (q.targetType) where.targetType = q.targetType;
  if (q.targetId) where.targetId = q.targetId;
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  return where;
}

/** Numele actorilor și ale membrilor-țintă (`targetType: user`) ai rândurilor. */
async function withNames(db: Pick<PrismaClient, "user">, rows: Omit<GcsAuditItem, "actorName" | "targetName">[]): Promise<GcsAuditItem[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.targetType === "user" ? r.targetId : null]).filter((id): id is string => !!id))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, actorName: r.actorId ? (names.get(r.actorId) ?? null) : null, targetName: r.targetType === "user" ? (names.get(r.targetId) ?? null) : null }));
}

/** Jurnalul ACP (spec §12.6), cele mai noi primele, cu filtre pe actor, acțiune (prefix), țintă și interval. */
export async function queryAudit(
  db: Pick<PrismaClient, "auditLog" | "user">,
  q: GcsAuditQuery,
): Promise<{ items: GcsAuditItem[]; total: number; page: number; pages: number }> {
  const where = auditWhere(q);
  const page = Math.max(1, Math.floor(q.page) || 1);

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
  ]);
  return {
    items: await withNames(db, rows),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/** Rândurile pentru exportul CSV (aceleași filtre), cele mai noi primele, cel mult `AUDIT_EXPORT_LIMIT`. */
export async function exportAudit(db: Pick<PrismaClient, "auditLog" | "user">, q: Omit<GcsAuditQuery, "page">): Promise<GcsAuditItem[]> {
  const rows = await db.auditLog.findMany({ where: auditWhere(q), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: AUDIT_EXPORT_LIMIT });
  return withNames(db, rows);
}

/** O celulă CSV: ghilimelele dublate; formulele (`= + - @`) neutralizate pentru foile de calcul. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "string" ? value : value instanceof Date ? value.toISOString() : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Jurnalul ca CSV (UTF-8 cu BOM, ca Excel să citească diacriticele): când, cine, ce, pe cine, înainte, după, IP. */
export function auditCsv(items: GcsAuditItem[]): string {
  const header = ["createdAt", "actor", "actorId", "action", "targetType", "targetId", "target", "before", "after", "ip"];
  const lines = items.map((r) => [r.createdAt, r.actorName, r.actorId, r.action, r.targetType, r.targetId, r.targetName, r.before, r.after, r.ip].map(csvCell).join(","));
  return `\uFEFF${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
