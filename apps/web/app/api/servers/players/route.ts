import { headers } from "next/headers";
import { clientIp, currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = { window: 60, max: 40 };

/**
 * Căutarea jucătorilor (formularele reclamației și sancțiunii, specul 2026-10-08-servere-pagini §1): `?q=` (min 2
 * caractere) după nume sau ID. Doar cu `servers.stats_view`; fără IP-uri; limită de cereri pe IP.
 */
export async function GET(req: Request): Promise<Response> {
  const { serverQueries, bridge, rateLimiter } = services();
  if (!(await serverQueries.appEnabled())) return Response.json({ error: "not_found" }, { status: 404 });
  const limit = await rateLimiter.consume(`servers-players:${clientIp(await headers())}`, LIMIT);
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 64);
  const players = q.trim().length < 2 ? [] : await bridge.queries.searchPlayers(await currentActor(), q);
  return Response.json({ players }, { headers: { "Cache-Control": "private, no-store" } });
}
