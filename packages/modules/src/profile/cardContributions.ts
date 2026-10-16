import type { GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsClanQueries } from "../clans/queries";
import type { GcsBridgeQueries } from "../servers/bridge/queries";
import type { GcsServerQueries } from "../servers/queries";
import { eloTier, type GcsHoverCardLoader } from "./hoverCard";

/**
 * Contribuțiile aplicațiilor la hover card v2 (fiecare cu cheia aplicației: oprită, nu apare):
 * - Clanuri: tagul clanului (doar dacă opțiunile clanurilor îl arată pe hover card);
 * - Servere: nivelul ELO al meciurilor mix și serverul pe care joacă acum membrul (doar serverele vizibile viewer-ului);
 * - VIP: planul VIP activ.
 */
export function registerCardContributions(
  loader: GcsHoverCardLoader,
  deps: { db: PrismaClient; clanQueries: Pick<GcsClanQueries, "tagsFor">; bridgeQueries: Pick<GcsBridgeQueries, "userCard">; serverQueries: Pick<GcsServerQueries, "visibleIds"> },
): void {
  const { db, clanQueries, bridgeQueries, serverQueries } = deps;
  loader.addChip({
    app: "clans",
    load: async (_viewer, userId) => {
      const tag = (await clanQueries.tagsFor([userId], "hovercard")).get(userId);
      return tag ? { kind: "clan", tag: tag.tag, name: tag.name, color: tag.color, href: tag.href } : null;
    },
  });
  loader.addChip({
    app: "servers",
    load: async (viewer: GcsActor, userId) => {
      const card = await bridgeQueries.userCard(viewer, userId);
      return card && card.elo !== null ? { kind: "elo", elo: Math.round(card.elo), tier: eloTier(card.elo), href: null } : null;
    },
  });
  loader.addChip({
    app: "vip",
    load: async (_viewer, userId) => {
      const sub = await db.vipSubscription.findFirst({ where: { userId, status: "ACTIVE" }, select: { group: { select: { name: true, title: true, color: true } } } });
      return sub ? { kind: "vip", name: sub.group.title ?? sub.group.name, color: sub.group.color } : null;
    },
  });
  loader.addPlaying({
    app: "servers",
    load: async (viewer, userId) => {
      const visible = await serverQueries.visibleIds(viewer);
      if (visible.length === 0) return null;
      const session = await db.gameSession.findFirst({
        where: { disconnectedAt: null, serverId: { in: visible }, player: { userId } },
        orderBy: { connectedAt: "desc" },
        select: { server: { select: { id: true, name: true, slug: true } } },
      });
      return session ? { serverId: session.server.id, server: session.server.name, href: `/servers/${session.server.id}-${session.server.slug}` } : null;
    },
  });
}
