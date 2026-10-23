import { recentBadges, recentBadgesQuery } from "@/lib/recent-badges";

export const dynamic = "force-dynamic";

/**
 * Widget-ul „Ultimele realizări” (actualizarea live): `?limit=5&rare=1&group=<id>` → ultimele badge-uri primite. Lista e
 * publică (ca profilurile); se cere din nou la fiecare badge nou anunțat în camera `feed:badges`.
 */
export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const items = await recentBadges(recentBadgesQuery({ limit: Number(sp.get("limit")) || 5, rare: sp.get("rare") ?? "", group: sp.get("group") ?? "" }));
  return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
