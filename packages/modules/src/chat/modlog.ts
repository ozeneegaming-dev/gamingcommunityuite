import type { Prisma, PrismaClient } from "@gcs/db";

/** Acțiunile din jurnalul moderării chat-ului (ACP → Chat → Moderare). */
export type GcsChatModAction =
  | "edit"
  | "pin"
  | "hide"
  | "unhide"
  | "delete"
  | "purge"
  | "warn"
  | "mute"
  | "unmute"
  | "kick"
  | "ban"
  | "slow"
  | "lift"
  | "grant"
  | "revoke"
  | "expire";

export type GcsChatModLogEntry = {
  actorId: string | null;
  action: GcsChatModAction;
  targetId?: string | null;
  channelKey?: string | null;
  messageId?: number | null;
  reason?: string;
  data?: Record<string, unknown> | null;
  /** Sancțiunea care se poate anula din jurnal: `mute:<id>` sau `sanction:<id>`. */
  ref?: string | null;
};

/** Un rând în jurnalul moderării chat-ului (în tranzacția apelantului, dacă e dată). */
export async function writeChatModLog(db: Pick<PrismaClient, "chatModLog"> | Prisma.TransactionClient, e: GcsChatModLogEntry): Promise<number> {
  const row = await db.chatModLog.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      targetId: e.targetId ?? null,
      channelKey: e.channelKey ?? null,
      messageId: e.messageId ?? null,
      reason: (e.reason ?? "").slice(0, 200),
      ...(e.data ? { data: e.data as Prisma.InputJsonValue } : {}),
      ref: e.ref ?? null,
    },
    select: { id: true },
  });
  return row.id;
}
