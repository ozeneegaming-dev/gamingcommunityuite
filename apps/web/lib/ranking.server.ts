import "server-only";
import { GcsError, type GcsActor } from "@gcs/core";
import { GCS_LEADERBOARD_PERIODS, type GcsLeaderboardMetric, type GcsLeaderboardPeriod } from "@gcs/modules";
import { playerHref } from "../app/(site)/_components/servers/types";
import { memberHref } from "./forum-urls";
import { RANKING_METRICS, type GcsRankingMetric, type GcsRankingResult, type GcsRankingRow } from "./ranking";
import { services } from "./services";

export const isRankingMetric = (v: unknown): v is GcsRankingMetric => typeof v === "string" && (RANKING_METRICS as readonly string[]).includes(v);
export const isRankingPeriod = (v: unknown): v is GcsLeaderboardPeriod => typeof v === "string" && (GCS_LEADERBOARD_PERIODS as readonly string[]).includes(v);

/** Măsurile disponibile viewer-ului: cele ale forumului mereu, Jucători / Clanuri doar cu aplicațiile lor. */
export async function rankingMetrics(actor: GcsActor, wanted: readonly GcsRankingMetric[]): Promise<GcsRankingMetric[]> {
  const { bridge, clanQueries, serverQueries } = services();
  const [players, clans] = await Promise.all([
    wanted.includes("players") && (await serverQueries.appEnabled()) ? bridge.queries.canViewStats(actor).catch(() => false) : false,
    wanted.includes("clans") ? clanQueries.canView(actor).catch(() => false) : false,
  ]);
  return wanted.filter((m) => (m === "players" ? players : m === "clans" ? clans : true));
}

/**
 * Clasamentul unei măsuri pentru panoul „Top” și widget-ul „Clasament”: primii `limit`, cu locul viewer-ului.
 * Forumul (postări, topicuri, reputație, timp online) pe perioadă; jucătorii după ELO-ul mix și clanurile după scor
 * (fără perioadă: clasamentele lor au propriul sezon). Fără drept: lista goală.
 */
export async function rankingRows(actor: GcsActor, metric: GcsRankingMetric, period: GcsLeaderboardPeriod, limit = 5): Promise<GcsRankingResult> {
  const n = Math.min(Math.max(Math.trunc(limit) || 5, 1), 10);
  const { leaderboard, bridge, clanQueries, db, profileQueries } = services();
  const empty: GcsRankingResult = { metric, period, rows: [], you: null };
  try {
    if (metric === "players") {
      const board = await bridge.queries.mixLeaderboard(actor, 1);
      if (!board) return empty;
      const items = board.items.slice(0, n);
      const users = await profileQueries.userDisplays(items.flatMap((i) => (i.player.userId ? [i.player.userId] : [])));
      const rows = items.map((i): GcsRankingRow => {
        const u = i.player.userId ? users.get(i.player.userId) : undefined;
        return {
          rank: i.position,
          value: i.elo,
          name: u?.name ?? i.player.name,
          href: playerHref(i.player),
          user: u ? { id: u.id, name: u.name, nameKey: u.nameKey, image: u.image, frameKey: u.frameKey } : null,
          sub: null,
        };
      });
      const mine = actor.userId ? board.items.find((i) => i.player.userId === actor.userId) : undefined;
      return { metric, period: "all", rows, you: mine ? { rank: mine.position, value: mine.elo } : null };
    }
    if (metric === "clans") {
      if (!(await clanQueries.canView(actor))) return empty;
      const clans = await clanQueries.top(n);
      const rows = clans.map((c, i): GcsRankingRow => ({ rank: c.rank ?? i + 1, value: c.score, name: `[${c.tag}] ${c.name}`, href: c.href, user: null, sub: null, color: c.color }));
      const mine = actor.userId ? (await clanQueries.memberClans(actor.userId)).clans[0] : undefined;
      const place = mine ? clans.find((c) => c.id === mine.id) : undefined;
      return { metric, period: "all", rows, you: place ? { rank: place.rank ?? 0, value: place.score } : null };
    }
    const m: GcsLeaderboardMetric = metric;
    const [top, you] = await Promise.all([leaderboard.top(actor, m, period), leaderboard.place(actor, m, period)]);
    const groups = new Map(
      (await db.user.findMany({ where: { id: { in: top.slice(0, n).map((r) => r.user.id) } }, select: { id: true, primaryGroup: { select: { name: true, title: true } } } })).map((u) => [
        u.id,
        u.primaryGroup.title ?? u.primaryGroup.name,
      ]),
    );
    const rows = top.slice(0, n).map((r): GcsRankingRow => ({
      rank: r.rank,
      value: r.value,
      name: r.user.name,
      href: memberHref(r.user),
      user: { id: r.user.id, name: r.user.name, nameKey: r.user.nameKey, image: r.user.image, frameKey: r.user.frameKey },
      sub: groups.get(r.user.id) ?? r.group.name,
    }));
    return { metric, period, rows, you };
  } catch (error) {
    if (error instanceof GcsError && (error.status === 403 || error.status === 404)) return empty;
    throw error;
  }
}
