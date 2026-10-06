import "server-only";
import { notificationText, toRef, userRefSelect, type GcsUserRef } from "@gcs/modules";
import { services } from "./services";

/** O notificare gata de afișat (clopoțel, pagina `/notifications`): textul tradus, linkul și primul actor. */
export type GcsNotificationItem = {
  id: number;
  type: string;
  text: string;
  href: string;
  snippet: string | null;
  read: boolean;
  updatedAt: string;
  actor: GcsUserRef | null;
};

export async function notificationItems(
  userId: string,
  locale: string,
  opts: { unreadOnly?: boolean; before?: number; limit?: number } = {},
): Promise<GcsNotificationItem[]> {
  const { notifications, db } = services();
  const rows = await notifications.list(userId, opts);
  const ids = [...new Set(rows.flatMap((r) => r.actorIds))];
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: ids } }, select: userRefSelect })).map((u) => [u.id, toRef(u)] as const),
  );
  return rows.map((r) => {
    const actors = r.actorIds.map((id) => users.get(id)).filter((u): u is GcsUserRef => !!u);
    return {
      id: r.id,
      type: r.type,
      text: notificationText(
        { type: r.type, actors: actors.map((a) => a.name), count: r.count, title: typeof r.data.title === "string" ? r.data.title : "", data: r.data },
        locale,
      ),
      href: typeof r.data.href === "string" ? r.data.href : "/notifications",
      snippet: typeof r.data.snippet === "string" && r.data.snippet ? r.data.snippet : null,
      read: r.read,
      updatedAt: r.updatedAt,
      actor: actors[0] ?? null,
    };
  });
}
