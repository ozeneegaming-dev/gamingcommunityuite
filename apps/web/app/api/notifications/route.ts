import { getLocale } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { notificationItem, notificationItems, notificationTab } from "@/lib/notifications";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * Dropdown-ul clopoțelului (Notificări v2): ultimele 10 notificări ale tabului (`?tab=all|mentions`) și numărul de
 * necitite; `?count=1` = doar numărul; `?id=<n>` = o singură notificare (toast-ul live, și una doar pentru toast).
 */
export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor.userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const unread = await services().notifications.unreadCount(actor.userId);
  if (params.get("count") === "1") return Response.json({ unread, items: [] }, NO_STORE);
  const locale = await getLocale();
  const id = Number(params.get("id"));
  if (params.has("id")) {
    const item = Number.isSafeInteger(id) ? await notificationItem(actor.userId, id, locale) : null;
    return Response.json({ unread, items: item ? [item] : [] }, NO_STORE);
  }
  const { tab } = await notificationTab(params.get("tab") ?? undefined);
  const items = await notificationItems(actor.userId, locale, { limit: 10, ...(tab.types ? { types: tab.types } : {}) });
  return Response.json({ unread, items }, NO_STORE);
}
