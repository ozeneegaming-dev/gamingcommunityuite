import type { GcsStatTile, GcsStatsContext } from "@gcs/core";

/** Placa VIP din panoul de statistici: membrii cu un abonament VIP activ (neexpirat). */
export async function vipStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const now = new Date();
  const rows = await db.vipSubscription.findMany({
    where: { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    distinct: ["userId"],
    select: { userId: true },
  });
  return [{ key: "vip.members", labelKey: "stats.tiles.vip", value: rows.length, icon: "fa-solid fa-crown", color: "#F4B740" }];
}
