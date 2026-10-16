import "server-only";
import type { GcsUserRef } from "@gcs/modules";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { memberHref } from "./forum-urls";
import { services } from "./services";

/** Un rând din widget-ul „Ultimele realizări” (serializabil, pentru componenta client și pentru API). */
export type GcsRecentBadge = {
  id: number;
  at: string;
  times: number;
  user: GcsUserRef;
  href: string;
  badge: { name: string; description: string; art: string; image: string | null };
};

export type GcsRecentBadgesQuery = { limit: number; rareOnly: boolean; groupId: number | null };

export function recentBadgesQuery(config: Record<string, unknown>): GcsRecentBadgesQuery {
  const limit = typeof config.limit === "number" ? config.limit : Number(config.limit) || 5;
  const group = Number(config.group);
  return { limit: Math.max(1, Math.min(20, limit)), rareOnly: config.rare === "1" || config.rare === true, groupId: Number.isInteger(group) && group > 0 ? group : null };
}

export async function recentBadges(q: GcsRecentBadgesQuery): Promise<GcsRecentBadge[]> {
  const rows = await services().achievementRules.recent({ limit: q.limit, rareOnly: q.rareOnly, groupId: q.groupId });
  return rows.map((r) => ({
    id: r.id,
    at: r.lastAwardedAt.toISOString(),
    times: r.timesAwarded,
    user: r.user,
    href: memberHref(r.user),
    badge: { name: r.badge.name, description: r.badge.description, art: badgeArtSrc(r.badge), image: r.badge.imageAttachmentId ? `/files/${r.badge.imageAttachmentId}` : null },
  }));
}
