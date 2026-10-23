import { guestPresenceId, realtimeSecret, signRealtimeToken } from "@gcs/core";
import { headers } from "next/headers";
import { clientIp, currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const RULE = { window: 60, max: 30 };
/** Intervalul transportului prin polling (ultima rezervă). */
const POLL_MS = 5_000;

/**
 * Tokenul de conectare la `gcs-realtime` (5 minute) și transporturile de încercat, în ordine: websocket (doar ediția
 * VPS, cu `gcs-realtime`), SSE, polling. Membrii: id-ul userului; vizitatorii: un id de prezență derivat din IP
 * (același cu cel notat la request-uri, ca să nu fie numărați de două ori).
 */
export async function GET() {
  const h = await headers();
  const ip = clientIp(h);
  const s = services();
  const limit = await s.rateLimiter.consume(`rt-token:${ip}`, RULE);
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const actor = await currentActor();
  if (actor.isBanned) return Response.json({ error: "forbidden" }, { status: 403 });
  const token = await signRealtimeToken({ userId: actor.userId, guestId: guestPresenceId(ip) }, realtimeSecret());
  const transports = s.edition === "lite" ? ["sse", "poll"] : ["websocket", "sse", "poll"];
  return Response.json({ token, url: process.env.GCS_REALTIME_URL ?? "", transports, pollMs: POLL_MS }, { headers: { "Cache-Control": "no-store" } });
}
