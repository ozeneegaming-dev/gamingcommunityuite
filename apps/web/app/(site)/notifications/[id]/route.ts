import { NOTIFY_STAT_CHANNELS, type GcsNotifyStatChannel } from "@gcs/core";
import { currentActor } from "@/lib/actor";
import { localRedirect } from "@/lib/redirect";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Deschide o notificare (din listă, din toast, din email sau din web push): o marchează citită, numără deschiderea pe
 * canalul de unde vine (`?via=site|toast|email|push`, implicit site) și duce la conținut (merge și fără JavaScript).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) return localRedirect("/login");
  const id = Number((await params).id);
  const { db, notifications } = services();
  const row = Number.isSafeInteger(id) ? await db.notification.findFirst({ where: { id, userId: actor.userId }, select: { data: true } }) : null;
  if (!row) return localRedirect("/notifications");
  const via = new URL(req.url).searchParams.get("via");
  const channel: GcsNotifyStatChannel = (NOTIFY_STAT_CHANNELS as readonly string[]).includes(via ?? "") ? (via as GcsNotifyStatChannel) : "site";
  await notifications.markRead(actor.userId, [id]);
  await notifications.recordClick(actor.userId, id, channel);
  const href = (row.data as { href?: unknown }).href;
  // Doar linkuri interne: datele vin din descrierea țintei, dar nu urmăm niciodată un URL absolut.
  return localRedirect(typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : "/notifications");
}
