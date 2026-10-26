import type { GcsStatTile, GcsStatsContext } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { normalizePrivacy } from "../profile/privacy";
import { toRef, userRefSelect, type GcsUserRef } from "./queries";

/** Plăcile forumurilor din panoul de statistici: topicuri, postări (vizibile) și membri, fiecare cu culoarea ei. */
export async function forumStatTiles({ db }: GcsStatsContext): Promise<GcsStatTile[]> {
  const [topics, posts, members] = await Promise.all([
    db.topic.count({ where: { visibility: "VISIBLE" } }),
    db.post.count({ where: { visibility: "VISIBLE" } }),
    db.user.count({ where: { isBot: false } }),
  ]);
  return [
    { key: "forums.topics", labelKey: "stats.tiles.topics", value: topics, icon: "fa-solid fa-layer-group", color: "#F97316" },
    { key: "forums.posts", labelKey: "stats.tiles.posts", value: posts, icon: "fa-solid fa-comments", color: "#22C55E" },
    { key: "forums.members", labelKey: "stats.tiles.members", value: members, icon: "fa-solid fa-users", color: "#A855F7", href: "/members" },
  ];
}

const DAY_MS = 86_400_000;
const MAX_SHOWN = 200;

export type GcsWhoWasOnline = { members: GcsUserRef[]; hidden: number; total: number };

/**
 * „Cine a fost online” (ultimele 24 h, din `lastActiveAt`), cei mai recenți primii. Cei cu statusul ascuns
 * (Setări → Confidențialitate) nu apar în listă, dar sunt numărați.
 */
export async function whoWasOnline(db: PrismaClient, now = Date.now()): Promise<GcsWhoWasOnline> {
  const rows = await db.user.findMany({
    where: { lastActiveAt: { gte: new Date(now - DAY_MS) }, isBot: false },
    orderBy: [{ lastActiveAt: "desc" }, { id: "asc" }],
    select: { ...userRefSelect, privacy: true },
    take: 2000,
  });
  const members: GcsUserRef[] = [];
  let hidden = 0;
  for (const r of rows) {
    if (!normalizePrivacy(r.privacy).showOnline) hidden++;
    else if (members.length < MAX_SHOWN) members.push(toRef(r));
  }
  return { members, hidden, total: rows.length };
}

export type GcsLegendGroup = { id: number; key: string; name: string; color: string | null; icon: string | null };

/** Legenda grupurilor: grupurile marcate „în legendă”, în ordinea din ACP. */
export async function groupLegend(db: PrismaClient): Promise<GcsLegendGroup[]> {
  return db.group.findMany({
    where: { inLegend: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, key: true, name: true, color: true, icon: true },
  });
}
