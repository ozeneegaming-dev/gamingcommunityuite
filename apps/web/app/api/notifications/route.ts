import { getLocale } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { notificationItems } from "@/lib/notifications";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Dropdown-ul clopoțelului: ultimele 10 notificări și numărul de necitite (`?count=1`: doar numărul). */
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor.userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const unread = await services().notifications.unreadCount(actor.userId);
  const onlyCount = new URL(request.url).searchParams.get("count") === "1";
  const items = onlyCount ? [] : await notificationItems(actor.userId, await getLocale(), { limit: 10 });
  return Response.json({ unread, items }, { headers: { "Cache-Control": "no-store" } });
}
