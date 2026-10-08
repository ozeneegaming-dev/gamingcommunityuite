import { headers } from "next/headers";
import { clientIp, currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 60 };

/**
 * Meciul mix live al unui server, pentru rezerva fără realtime (specul 2026-10-08-servere-pagini §7): `?server={id}`.
 * Doar cu `servers.stats_view` și serverul vizibil viewer-ului (altfel `match: null`); limită de cereri pe IP.
 */
export async function GET(req: Request): Promise<Response> {
  const { serverQueries, bridge, rateLimiter } = services();
  if (!(await serverQueries.appEnabled())) return Response.json({ error: "not_found" }, { status: 404 });
  const limit = await rateLimiter.consume(`servers-live:${clientIp(await headers())}`, LIMIT);
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } });
  const raw = new URL(req.url).searchParams.get("server") ?? "";
  if (!/^[1-9]\d{0,9}$/.test(raw)) return Response.json({ match: null });
  const match = await bridge.queries.liveMatch(await currentActor(), Number(raw));
  return Response.json({ match }, { headers: { "Cache-Control": "private, no-store" } });
}
