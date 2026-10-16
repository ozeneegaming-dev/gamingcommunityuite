/**
 * Consola Hero Cockpit de sub antet (specul 2026-10-10-hero-cockpit §4–5): tipurile datelor trimise browserului
 * (randarea și actualizările live se fac în client) și regulile pure (pagina pe care apare). Fără dependențe de server.
 */
import type { GcsCockpitPanel } from "@gcs/core/themes";
import type { GcsLevelProgress, GcsServerLive } from "@gcs/modules";
import type { GcsLiveSummary } from "./live-summary";
import type { GcsRankingMetric, GcsRankingResult } from "./ranking";

export type GcsCockpitUser = { id: string; name: string; nameKey: string; image: string | null; frameKey: string | null };

export const FEED_TABS = ["all", "forum", "servers", "mix"] as const;
export type GcsFeedTab = (typeof FEED_TABS)[number];

/** Un rând din „Feed live”: cine, ce (cheia textului `cockpit.feed.<kind>` și parametrii), unde duce, eticheta. */
export type GcsFeedItem = {
  key: string;
  kind: "topic" | "reply" | "status" | "member" | "server" | "mix";
  at: string;
  user: GcsCockpitUser | null;
  /** Numele când nu e un membru (un jucător sau o echipă). */
  name: string;
  href: string;
  params: Record<string, string>;
  tag: "forum" | "server" | "mix" | "new";
};

export type GcsCockpitMatch = {
  id: number | null;
  serverId: number;
  server: string;
  map: string | null;
  round: number;
  status: string;
  teams: { A: { name: string; score: number }; B: { name: string; score: number } };
  /** Primii jucători din fiecare echipă (după kills), cu numele stilizat dacă sunt membri. */
  players: { team: "A" | "B"; name: string; user: GcsCockpitUser | null; kills: number; deaths: number }[];
  watch: { address: string; delay: number | null } | null;
  connectHref: string | null;
  href: string;
};

export type GcsCockpitFeatured = { id: number; title: string; href: string; forum: string | null; excerpt: string; image: string | null; at: string; user: GcsCockpitUser | null };

export type GcsCockpitServer = { id: number; name: string; href: string; connectHref: string | null; address: string; game: string };

export type GcsCockpitData = {
  welcome: {
    user: GcsCockpitUser;
    unread: number;
    friends: { online: number; playing: number; server: string | null } | null;
    level: GcsLevelProgress;
  } | null;
  panels: [GcsCockpitPanel, GcsCockpitPanel, GcsCockpitPanel];
  feed: GcsFeedItem[];
  live: { match: GcsCockpitMatch | null; matches: number; featured: GcsCockpitFeatured[] };
  ranking: GcsRankingResult;
  rankingMetrics: GcsRankingMetric[];
  servers: GcsCockpitServer[];
  statuses: Record<number, GcsServerLive | null>;
  pollSeconds: number;
  summary: GcsLiveSummary;
};

/** Consola apare pe pagina principală (`home`) sau pe toate paginile site-ului (`all`). */
export function cockpitShownOn(pages: "home" | "all", pathname: string): boolean {
  return pages === "all" || pathname === "/";
}

/** Tab-ul feed-ului pentru un rând (Tot le arată pe toate). */
export function feedTabOf(item: Pick<GcsFeedItem, "tag">): Exclude<GcsFeedTab, "all"> {
  return item.tag === "server" ? "servers" : item.tag === "mix" ? "mix" : "forum";
}
