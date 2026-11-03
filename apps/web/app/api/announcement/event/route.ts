import { ANNOUNCEMENT_EVENTS, type GcsAnnouncementEvent } from "@gcs/modules";
import { isSameOrigin } from "@/lib/actions";
import { currentActor } from "@/lib/actor";
import { announcementConfig, recordAnnouncementEvent } from "@/lib/announcement";
import { clientIp } from "@/lib/client-ip";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Evenimentele unui IP: destule pentru câteva bare pe multe pagini, prea puține pentru a umfla cifrele. */
const LIMIT = { window: 600, max: 120 };

/**
 * Statisticile barei de anunț (ACP → Aspect → Bară de anunț): `{ bar, event }`, cu `event` = `view` / `click` /
 * `dismiss`. Doar din aceeași origine, cu limită pe IP, doar pentru o bară pornită și doar cu numărătoarea pornită în
 * setările generale. Afișarea se numără o dată pe zi per membru / IP (și browserul o trimite o dată pe zi).
 */
export async function POST(request: Request): Promise<Response> {
  const none = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (!isSameOrigin(request.headers)) return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => null)) as { bar?: unknown; event?: unknown } | null;
  if (!body || typeof body.bar !== "string" || !/^[a-z0-9]{1,16}$/.test(body.bar) || !(ANNOUNCEMENT_EVENTS as readonly unknown[]).includes(body.event)) {
    return new Response(null, { status: 400 });
  }
  const ip = clientIp(request.headers);
  const limit = await services()
    .rateLimiter.consume(`ann-event:${ip}`, LIMIT)
    .catch(() => ({ allowed: true }));
  if (!limit.allowed) return new Response(null, { status: 429 });
  const config = await announcementConfig();
  const bar = config.bars.find((b) => b.id === body.bar);
  if (!config.stats || !bar?.enabled) return none;
  const actor = await currentActor();
  await recordAnnouncementEvent(bar.id, body.event as GcsAnnouncementEvent, actor.userId ?? `ip:${ip}`).catch(() => false);
  return none;
}
