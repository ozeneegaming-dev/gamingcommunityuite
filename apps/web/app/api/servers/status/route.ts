import { headers } from "next/headers";
import { clientIp, currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const MAX_IDS = 50;
const LIMIT = { window: 60, max: 120 };

/**
 * Statusurile serverelor pentru actualizarea fără realtime (specul 2026-10-07-servere §5.3): `?ids=1,2,3` (max 50).
 * Doar serverele pe care viewer-ul le poate vedea; lista jucătorilor doar pentru un singur id, cu dreptul de a o
 * vedea. Aplicația dezactivată → 404; limită de cereri pe IP.
 */
export async function GET(req: Request): Promise<Response> {
  const { serverQueries, rateLimiter } = services();
  if (!(await serverQueries.appEnabled())) return Response.json({ error: "not_found" }, { status: 404 });
  const limit = await rateLimiter.consume(`servers-status:${clientIp(await headers())}`, LIMIT);
  if (!limit.allowed) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } });
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").filter((s) => /^[1-9]\d{0,9}$/.test(s)).map(Number))].slice(0, MAX_IDS);
  if (ids.length === 0) return Response.json({ servers: [], players: null });
  const data = await serverQueries.live(await currentActor(), ids);
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
