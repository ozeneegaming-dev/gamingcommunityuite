import { connectionRooms, NO_STORE, parseCid, parseRooms, realtimeCaller } from "@/lib/realtime-fallback";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Un tab întreabă la 5–15 s; limita e pe IP (mai mulți membri pot ieși prin aceeași adresă). */
const RULE = { window: 60, max: 600 };

/**
 * Timpul real prin polling (ultima rezervă, când nici SSE nu trece de gazdă): `GET
 * /api/realtime/poll?rooms=a,b&cid=…&since=…[&join=1][&ping=1]`. Fără `since`: doar cursorul curent (de acolo
 * pornește tab-ul). `join=1` = camerele tocmai cerute (lista celor prezenți se trimite), `ping=1` = semnul de prezență.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { actor, viewer, ip } = await realtimeCaller();
  if (actor.isBanned) return Response.json({ error: "forbidden" }, { status: 403 });
  const s = services();
  const limit = await s.rateLimiter.consume(`rt-poll:${ip}`, RULE);
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const { allowed, all } = await connectionRooms(actor, parseRooms(url.searchParams.get("rooms")));
  const cid = parseCid(url.searchParams.get("cid"));
  const since = url.searchParams.get("since");
  const hub = s.realtimeHub;
  if (url.searchParams.get("join") === "1" || !since) {
    for (const room of allowed) await hub.joined(room, viewer).catch(() => {});
  } else if (url.searchParams.get("ping") === "1") {
    await hub.ping(viewer, allowed).catch(() => {});
  }
  if (!since) return Response.json({ cursor: await s.realtime.log.head(), rooms: allowed, events: [], reset: false }, { headers: NO_STORE });

  const read = await s.realtime.log.read(since, all);
  const events = read.events.filter((e) => !cid || e.origin !== cid).map((e) => ({ event: e.event, data: e.data }));
  return Response.json({ cursor: read.cursor, rooms: allowed, events, reset: read.reset }, { headers: NO_STORE });
}
