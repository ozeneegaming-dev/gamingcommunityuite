import { currentActor } from "@/lib/actor";
import { isRankingMetric, isRankingPeriod, rankingRows } from "@/lib/ranking.server";

export const dynamic = "force-dynamic";

/**
 * Clasamentul compact (panoul „Top” al consolei, widget-ul „Clasament”): `?metric=posts|topics|reputation|online|
 * players|clans&period=day|week|month|year|all&limit=5`. Primii `limit` și locul viewer-ului; fără drept, lista goală.
 */
export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const metric = sp.get("metric");
  const period = sp.get("period");
  if (!isRankingMetric(metric) || !isRankingPeriod(period)) return Response.json({ error: "invalid" }, { status: 400 });
  const data = await rankingRows(await currentActor(), metric, period, Number(sp.get("limit")) || 5);
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
