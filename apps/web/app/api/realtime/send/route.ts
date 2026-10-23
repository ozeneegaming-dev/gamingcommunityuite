import { isSameOrigin } from "@/lib/actions";
import { connectionRooms, NO_STORE, parseCid, parseRooms, realtimeCaller } from "@/lib/realtime-fallback";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const RULE = { window: 60, max: 120 };

type Body = { cid?: unknown; event?: unknown; data?: unknown; rooms?: unknown };

/**
 * Mesajele clientului pe transporturile SSE / polling (pe websocket merg prin socket): `typing`, `chat:typing`,
 * `presence:ping` (cu camerele tab-ului) și `leave`. Doar din aceeași origine; accesul se verifică la fiecare mesaj.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => null)) as Body | null;
  const cid = parseCid(body?.cid);
  if (!body || !cid || typeof body.event !== "string") return new Response(null, { status: 400 });
  const { actor, viewer, ip } = await realtimeCaller();
  if (actor.isBanned) return new Response(null, { status: 403 });
  const s = services();
  const limit = await s.rateLimiter.consume(`rt-send:${ip}`, RULE);
  if (!limit.allowed) return new Response(null, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const hub = s.realtimeHub;

  switch (body.event) {
    case "typing": {
      await hub.typing(actor, body.data, cid);
      break;
    }
    case "chat:typing": {
      const key = typeof body.data === "string" ? body.data : "";
      const { all } = await connectionRooms(actor, [`chat:${key}`]);
      await hub.chatTyping(actor, key, cid, { joined: all });
      break;
    }
    case "presence:ping": {
      const rooms = typeof body.rooms === "string" ? parseRooms(body.rooms) : [];
      const { allowed } = await connectionRooms(actor, rooms);
      await hub.ping(viewer, allowed);
      break;
    }
    case "leave": {
      if (typeof body.data === "string") await hub.left(body.data, viewer).catch(() => {});
      break;
    }
    default:
      return new Response(null, { status: 400 });
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
