import { sql } from "@gcs/db";
import "server-only";
import { services } from "./services";

/** O zi din graficul de activitate (postări + topicuri + mesaje de chat). */
export type GcsActivityDay = { day: string; posts: number; chat: number };

/**
 * Datele fișei ACP a membrului ca dashboard (Membri v2): activitatea pe zile, rangul și punctele, cotele (valorile
 * grupurilor lui și cât a folosit) și jurnalul contului.
 */
export async function memberActivity(userId: string, days = 30, now = new Date()): Promise<GcsActivityDay[]> {
  const { db } = services();
  const since = new Date(now.getTime() - (days - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const [posts, chat] = await Promise.all([
    db.$queryRaw<{ day: Date; n: bigint }[]>(sql`SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n FROM posts WHERE "authorId" = ${userId} AND "createdAt" >= ${since} GROUP BY 1`),
    db.$queryRaw<{ day: Date; n: bigint }[]>(sql`SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n FROM chat_messages WHERE "authorId" = ${userId} AND "createdAt" >= ${since} GROUP BY 1`),
  ]);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const postsBy = new Map(posts.map((r) => [key(new Date(r.day)), Number(r.n)]));
  const chatBy = new Map(chat.map((r) => [key(new Date(r.day)), Number(r.n)]));
  return Array.from({ length: days }, (_, i) => {
    const d = key(new Date(since.getTime() + i * 86_400_000));
    return { day: d, posts: postsBy.get(d) ?? 0, chat: chatBy.get(d) ?? 0 };
  });
}

export type GcsQuota = { key: string; used: number | null; limit: number; unit: "count" | "mb" | "chars" };

/** Cotele membrului: limitele grupurilor lui (−1 = nelimitat) și, unde se poate, cât a folosit. */
export async function memberQuotas(userId: string): Promise<GcsQuota[]> {
  const { db, actors, permissions } = services();
  const actor = await actors.forUser(userId, "0.0.0.0");
  const [conversations, storage, maxConversations, maxUpload, maxSignature] = await Promise.all([
    db.conversationParticipant.count({ where: { userId } }),
    db.attachment.aggregate({ where: { ownerId: userId }, _sum: { size: true } }),
    permissions.groupValue<number | boolean>(actor, "pm.max_conversations"),
    permissions.groupValue<number | boolean>(actor, "upload.max_mb"),
    permissions.groupValue<number | boolean>(actor, "signature.max_chars"),
  ]);
  const num = (v: number | boolean) => (typeof v === "number" ? v : v ? -1 : 0);
  return [
    { key: "conversations", used: conversations, limit: num(maxConversations), unit: "count" },
    { key: "storage", used: Math.round(((storage._sum.size ?? 0) / 1024 / 1024) * 10) / 10, limit: -1, unit: "mb" },
    { key: "upload", used: null, limit: num(maxUpload), unit: "mb" },
    { key: "signature", used: null, limit: num(maxSignature), unit: "chars" },
  ];
}

export type GcsAccountLogRow = { id: string; action: string; actorId: string | null; actorName: string | null; targetId: string | null; ip: string | null; createdAt: Date; self: boolean };

/** Jurnalul contului: ce a făcut membrul și ce i s-a făcut (cele mai noi întâi). */
export async function memberAccountLog(userId: string, take = 50): Promise<GcsAccountLogRow[]> {
  const { db } = services();
  const rows = await db.auditLog.findMany({
    where: { OR: [{ targetType: "user", targetId: userId }, { actorId: userId }] },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, actorId: true, targetId: true, ip: true, createdAt: true },
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
  const names = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, id: String(r.id), actorName: r.actorId ? (names.get(r.actorId) ?? null) : null, self: r.actorId === userId }));
}
