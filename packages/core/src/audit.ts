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
