import { guestPresenceId, realtimeSecret, signRealtimeToken } from "@gcs/core";
import { headers } from "next/headers";
import { clientIp, currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const RULE = { window: 60, max: 30 };

/**
 * Tokenul de conectare la `gcs-realtime` (5 minute) și transporturile de încercat, în ordine: websocket (doar ediția
 * VPS, cu `gcs-realtime`), SSE, polling. Membrii: id-ul userului; vizitatorii: un id de prezență derivat din IP
 * (același cu cel notat la request-uri, ca să nu fie numărați de două ori). Intervalul polling-ului și „doar polling”
 * (pentru gazdele care taie conexiunile lungi) vin din ACP › Setări › Avansat.
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
  const [pollSec, mode] = await Promise.all([s.settings.get<number>("realtime.poll_interval"), s.settings.get<string>("realtime.transport")]);
  const transports = mode === "poll" ? ["poll"] : s.edition === "lite" ? ["sse", "poll"] : ["websocket", "sse", "poll"];
  return Response.json({ token, url: process.env.GCS_REALTIME_URL ?? "", transports, pollMs: pollSec * 1000 }, { headers: { "Cache-Control": "no-store" } });
}
