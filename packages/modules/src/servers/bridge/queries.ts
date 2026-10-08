import type { GcsActor, GcsAppService, GcsPermissionService } from "@gcs/core";
import { Prisma, type GameMatchStatus, type GamePlayerKind, type PrismaClient } from "@gcs/db";
import { SERVERS_APP } from "../poller";
import { BRIDGE_PERMISSION } from "./config";
import { cleanMapName } from "./mapImages";
import type { GcsLiveMatch } from "./matches";
import type { GcsBridgePlayers } from "./players";
import type { GcsAdminPresence, GcsBridgePresence, GcsOnlineAdmin } from "./presence";
import type { GcsBridgeSanctions, GcsSanctionView } from "./sanctions";
import type { GcsBridgeStore } from "./store";
import type { GcsBridgeTv, GcsTvWatch } from "./tv";

const PAGE = 50;
/** Câte hărți are filtrul listei de meciuri (cele mai jucate). */
const MATCH_MAPS_MAX = 50;
/** Tab-urile listei de meciuri: „live” = încălzire / live / pauză, „terminate” = încheiate / anulate. */
const OPEN_MATCH: GameMatchStatus[] = ["WARMUP", "LIVE", "HALFTIME"];
const CLOSED_MATCH: GameMatchStatus[] = ["ENDED", "ABORTED"];
export type GcsMatchStatusFilter = "live" | "ended";
export type GcsMatchFilter = { serverId?: number; playerId?: number; page?: number; status?: GcsMatchStatusFilter; map?: string; withStats?: boolean };
/** Jucătorii pe echipe (formatul, ex. 5v5) și ELO-ul mediu al unui meci. */
export type GcsMatchStats = { players: { A: number; B: number }; avgElo: number | null };

export type GcsStatTotals = { kills: number; deaths: number; headshots: number; assists: number; kd: number; headshotRate: number | null; accuracy: number | null; damage: number; playtime: number; rounds: number; roundsWon: number };
export type GcsIdentityView = { id: number; kind: GamePlayerKind; trust: string; name: string; value: string; verified: boolean; lastSeenAt: string };

export type GcsPlayerProfile = {
  player: GcsIdentityView;
  user: { id: string; name: string } | null;
  /** Celelalte identități ale aceluiași membru (cu tipul și încrederea). */
  identities: GcsIdentityView[];
  summary: GcsStatTotals & { lastSeenAt: string | null; lastServer: { id: number; name: string } | null; bestRank: number | null };
  /** Pe server vizibil; `server.game` = cheia jocului (imaginile hărților). */
  classic: (GcsStatTotals & { server: { id: number; name: string; game: string }; rank: number | null; lastSeenAt: string })[];
  mix: { elo: number | null; peak: number | null; matches: number; wins: number; losses: number; draws: number; history: { matchId: number; at: string; elo: number }[] };
  matches: GcsMatchSummary[];
  weapons: { weapon: string; kills: number; deaths: number; headshots: number; shots: number; hits: number; damage: number; accuracy: number | null }[];
  maps: { map: string; kills: number; deaths: number; headshots: number; playtime: number; rounds: number; roundsWon: number }[];
  /** `null` = viewer-ul nu vede lista bannurilor. */
  sanctions: GcsSanctionView[] | null;
};

/** Caseta „Statistici pe servere” din profilul membrului: identitatea principală și totalurile (citire ușoară). */
export type GcsUserGameCard = {
  player: { id: number; name: string; kind: GamePlayerKind; trust: string; value: string };
  /** Câte identități de joc are membrul legate. */
  identities: number;
  kills: number;
  deaths: number;
  headshots: number;
  kd: number;
  headshotRate: number | null;
  playtime: number;
  lastSeenAt: string | null;
  bestRank: number | null;
  elo: number | null;
  matches: number;
};

/** Un jucător găsit (formularele reclamației și sancțiunii); fără IP-uri. */
export type GcsPlayerHit = { id: number; name: string; kind: GamePlayerKind; value: string; trust: string; lastSeenAt: string };

export type GcsMatchSummary = {
  id: number;
  /** Serverul (`slug` pentru link, `game` pentru imaginea hărții). */
  server: { id: number; name: string; slug: string; game: string };
  map: string;
  status: string;
  teams: { A: { name: string; score: number }; B: { name: string; score: number } };
  winner: string | null;
  /** Runda curentă (la final, ultima). */
  round: number;
  startedAt: string;
  /** Începutul jocului propriu-zis (după încălzire): durata se măsoară de aici. */
  liveAt: string | null;
  endedAt: string | null;
  /** Pentru un jucător: echipa lui și schimbarea de ELO. */
  player?: { team: string; eloBefore: number | null; eloAfter: number | null; kills: number; deaths: number };
  /** Doar cu `withStats`: formatul și ELO-ul mediu (lista meciurilor). */
  stats?: GcsMatchStats;
};

export type GcsMatchDetails = GcsMatchSummary & {
  rated: boolean;
  players: { playerId: number; name: string; team: string; kills: number; deaths: number; assists: number; headshots: number; damage: number; mvps: number; eloBefore: number | null; eloAfter: number | null }[];
  rounds: { number: number; winner: string; scoreA: number; scoreB: number; reason: string; endedAt: string }[];
};

const totals = (r: { kills: number; deaths: number; headshots: number; assists?: number; shots?: number; hits?: number; damage?: number; playtime?: number; rounds?: number; roundsWon?: number }): GcsStatTotals => ({
  kills: r.kills,
  deaths: r.deaths,
  headshots: r.headshots,
  assists: r.assists ?? 0,
  kd: r.kills / Math.max(1, r.deaths),
  headshotRate: r.kills > 0 ? r.headshots / r.kills : null,
  accuracy: r.shots && r.shots > 0 ? Math.min(1, (r.hits ?? 0) / r.shots) : null,
  damage: r.damage ?? 0,
  playtime: r.playtime ?? 0,
  rounds: r.rounds ?? 0,
  roundsWon: r.roundsWon ?? 0,
});

/**
 * Citirile punții pentru paginile publice (partea B, specul 2026-10-08-servere-bridge §17): profilul jucătorului
 * (rezumat, clasic pe servere, mix cu istoricul ELO, meciuri, arme, hărți, sancțiuni), clasamentele, meciurile, meciul
 * live și adminii unui server. Doar citire; fiecare verifică aplicația, `servers.stats_view` și vizibilitatea serverelor.
 */
export class GcsBridgeQueries {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      apps: GcsAppService;
      permissions: GcsPermissionService;
      store: GcsBridgeStore;
      players: GcsBridgePlayers;
      sanctions: GcsBridgeSanctions;
      presence: GcsBridgePresence;
      /** Vede viewer-ul serverul (grupurile serverului)? */
      canViewServer: (actor: GcsActor, id: number) => Promise<boolean>;
      /** Serverele vizibile viewer-ului. */
      visibleServers: (actor: GcsActor) => Promise<number[]>;
      /** Adresele „Urmărește live” (HLTV / GOTV, specul servere-hltv §3). */
      tv?: GcsBridgeTv;
    },
  ) {}

  async canViewStats(actor: GcsActor): Promise<boolean> {
    return !actor.isBanned && (await this.deps.apps.enabled(SERVERS_APP)) && (await this.deps.permissions.can(actor, BRIDGE_PERMISSION.statsView));
  }

  private identity(p: { id: number; kind: GamePlayerKind; trust: string; name: string; value: string; lastSeenAt: Date }): GcsIdentityView {
    return { id: p.id, kind: p.kind, trust: p.trust, name: p.name, value: p.value, verified: p.kind !== "NAME", lastSeenAt: p.lastSeenAt.toISOString() };
  }

  async playerProfile(actor: GcsActor, playerId: number): Promise<GcsPlayerProfile | null> {
    const { db, sanctions, permissions } = this.deps;
    if (!(await this.canViewStats(actor))) return null;
    const player = await db.gamePlayer.findUnique({ where: { id: playerId }, include: { user: { select: { id: true, name: true } }, rating: true } });
    if (!player) return null;
    const visible = new Set(await this.deps.visibleServers(actor));
    const others = player.userId ? await db.gamePlayer.findMany({ where: { userId: player.userId, NOT: { id: player.id } }, orderBy: [{ kind: "asc" }, { lastSeenAt: "desc" }] }) : [];

    const stats = (await db.gamePlayerStat.findMany({ where: { playerId }, include: { server: { select: { id: true, name: true, game: true } } }, orderBy: { playtime: "desc" } })).filter((s) => visible.has(s.serverId));
    const sum = stats.reduce(
      (a, s) => ({ kills: a.kills + s.kills, deaths: a.deaths + s.deaths, headshots: a.headshots + s.headshots, assists: a.assists + s.assists, shots: a.shots + s.shots, hits: a.hits + s.hits, damage: a.damage + s.damage, playtime: a.playtime + s.playtime, rounds: a.rounds + s.rounds, roundsWon: a.roundsWon + s.roundsWon }),
      { kills: 0, deaths: 0, headshots: 0, assists: 0, shots: 0, hits: 0, damage: 0, playtime: 0, rounds: 0, roundsWon: 0 },
    );
    const latest = [...stats].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0];
    const ranks = stats.flatMap((s) => (s.rank === null ? [] : [s.rank]));
    const serverIds = [...visible];

    const [weapons, maps, history, matches, list] = await Promise.all([
      db.gameWeaponStat.groupBy({ by: ["weapon"], where: { playerId, serverId: { in: serverIds } }, _sum: { kills: true, deaths: true, headshots: true, shots: true, hits: true, damage: true }, orderBy: { _sum: { kills: "desc" } }, take: 30 }),
      db.gameMapStat.groupBy({ by: ["map"], where: { playerId, serverId: { in: serverIds } }, _sum: { kills: true, deaths: true, headshots: true, playtime: true, rounds: true, roundsWon: true }, orderBy: { _sum: { playtime: "desc" } }, take: 30 }),
      // Ultimele 200 de meciuri evaluate (graficul ELO), apoi în ordine cronologică.
      db.gameMatchPlayer
        .findMany({ where: { playerId, eloAfter: { not: null }, match: { serverId: { in: serverIds } } }, include: { match: { select: { id: true, endedAt: true, startedAt: true } } }, orderBy: { match: { endedAt: "desc" } }, take: 200 })
        .then((rows) => rows.reverse()),
      this.matches(actor, { playerId }),
      (await permissions.can(actor, BRIDGE_PERMISSION.bansView)) ? sanctions.list(actor, { playerId }).then((r) => r.items) : Promise.resolve(null),
    ]);
    const r = player.rating;
    return {
      player: this.identity(player),
      user: player.user,
      identities: others.map((o) => this.identity(o)),
      summary: { ...totals(sum), lastSeenAt: latest?.lastSeenAt.toISOString() ?? null, lastServer: latest ? { id: latest.server.id, name: latest.server.name } : null, bestRank: ranks.length > 0 ? Math.min(...ranks) : null },
      classic: stats.map((s) => ({ ...totals(s), server: s.server, rank: s.rank, lastSeenAt: s.lastSeenAt.toISOString() })),
      mix: {
        elo: r?.elo ?? null,
        peak: r?.peak ?? null,
        matches: r?.matches ?? 0,
        wins: r?.wins ?? 0,
        losses: r?.losses ?? 0,
        draws: r?.draws ?? 0,
        history: history.map((h) => ({ matchId: h.matchId, at: (h.match.endedAt ?? h.match.startedAt).toISOString(), elo: h.eloAfter! })),
      },
      matches: matches.items,
      weapons: weapons.map((w) => {
        const s = w._sum;
        return { weapon: w.weapon, kills: s.kills ?? 0, deaths: s.deaths ?? 0, headshots: s.headshots ?? 0, shots: s.shots ?? 0, hits: s.hits ?? 0, damage: s.damage ?? 0, accuracy: s.shots ? Math.min(1, (s.hits ?? 0) / s.shots) : null };
      }),
      maps: maps.map((m) => ({ map: m.map, kills: m._sum.kills ?? 0, deaths: m._sum.deaths ?? 0, headshots: m._sum.headshots ?? 0, playtime: m._sum.playtime ?? 0, rounds: m._sum.rounds ?? 0, roundsWon: m._sum.roundsWon ?? 0 })),
      sanctions: list,
    };
  }

  /** Profilul de joc al unui membru: identitatea principală (Steam cu cel mai mult timp de joc, altfel cea mai recentă). */
  async userProfile(actor: GcsActor, userId: string): Promise<GcsPlayerProfile | null> {
    if (!(await this.canViewStats(actor))) return null;
    const rows = await this.deps.db.$queryRaw<{ id: number }[]>`
      SELECT p.id FROM game_players p LEFT JOIN game_player_stats s ON s."playerId" = p.id
      WHERE p."userId" = ${userId}
      GROUP BY p.id, p.kind, p."lastSeenAt"
      ORDER BY (p.kind = 'STEAM') DESC, COALESCE(SUM(s.playtime), 0) DESC, p."lastSeenAt" DESC
      LIMIT 1`;
    return rows[0] ? this.playerProfile(actor, rows[0].id) : null;
  }

  /**
   * Caseta din profilul membrului: identitatea principală (ca `userProfile`) și totalurile ei pe serverele vizibile,
   * ELO-ul și locul cel mai bun. `null` = membrul nu are identități (sau viewer-ul nu vede statisticile).
   */
  async userCard(actor: GcsActor, userId: string): Promise<GcsUserGameCard | null> {
    if (!(await this.canViewStats(actor))) return null;
    const { db } = this.deps;
    const identities = await db.gamePlayer.findMany({ where: { userId }, select: { id: true } });
    if (identities.length === 0) return null;
    const [main] = await db.$queryRaw<{ id: number }[]>`
      SELECT p.id FROM game_players p LEFT JOIN game_player_stats s ON s."playerId" = p.id
      WHERE p."userId" = ${userId}
      GROUP BY p.id, p.kind, p."lastSeenAt"
      ORDER BY (p.kind = 'STEAM') DESC, COALESCE(SUM(s.playtime), 0) DESC, p."lastSeenAt" DESC
      LIMIT 1`;
    const visible = await this.deps.visibleServers(actor);
    const [player, sum, rating] = await Promise.all([
      db.gamePlayer.findUniqueOrThrow({ where: { id: main!.id }, select: { id: true, name: true, kind: true, trust: true, value: true } }),
      db.gamePlayerStat.aggregate({ where: { playerId: main!.id, serverId: { in: visible } }, _sum: { kills: true, deaths: true, headshots: true, playtime: true }, _max: { lastSeenAt: true }, _min: { rank: true } }),
      db.gameRating.findUnique({ where: { playerId: main!.id }, select: { elo: true, matches: true } }),
    ]);
    const kills = sum._sum.kills ?? 0;
    const deaths = sum._sum.deaths ?? 0;
    const headshots = sum._sum.headshots ?? 0;
    return {
      player,
      identities: identities.length,
      kills,
      deaths,
      headshots,
      kd: kills / Math.max(1, deaths),
      headshotRate: kills > 0 ? headshots / kills : null,
      playtime: sum._sum.playtime ?? 0,
      lastSeenAt: sum._max.lastSeenAt?.toISOString() ?? null,
      bestRank: sum._min.rank ?? null,
      elo: rating && rating.matches > 0 ? rating.elo : null,
      matches: rating?.matches ?? 0,
    };
  }

  /** Căutarea jucătorilor după nume sau ID (formularele reclamației și sancțiunii); fără IP-uri. */
  async searchPlayers(actor: GcsActor, q: string): Promise<GcsPlayerHit[]> {
    if (!(await this.canViewStats(actor))) return [];
    return (await this.deps.players.search(q, 10)).map((p) => ({ id: p.id, name: p.name, kind: p.kind, value: p.value, trust: p.trust, lastSeenAt: p.lastSeenAt }));
  }

  /** Prezența adminilor pe pagina publică: doar serverele vizibile viewer-ului (§6 partea B). */
  async adminPresence(actor: GcsActor, opts: { serverId?: number } = {}): Promise<GcsAdminPresence[] | null> {
    if (!(await this.canViewStats(actor))) return null;
    const visible = await this.deps.visibleServers(actor);
    if (typeof opts.serverId === "number" && !visible.includes(opts.serverId)) return null;
    return this.deps.presence.list(actor, { ...opts, visibleServers: visible });
  }

  /** Adminii online acum pe serverele vizibile (widget-ul „Admini online”). */
  async onlineAdmins(actor: GcsActor, limit = 50): Promise<GcsOnlineAdmin[] | null> {
    if (!(await this.canViewStats(actor))) return null;
    return this.deps.presence.online(await this.deps.visibleServers(actor), limit);
  }

  /** Câți admini sunt acum pe fiecare server dat și vizibil (indicatorul „Admin online” de pe carduri). */
  async adminsOnlineCounts(actor: GcsActor, serverIds: number[]): Promise<Map<number, number>> {
    if (serverIds.length === 0 || !(await this.canViewStats(actor))) return new Map();
    const visible = new Set(await this.deps.visibleServers(actor));
    return this.deps.presence.onlineCounts(serverIds.filter((id) => visible.has(id)));
  }

  /** Clasamentul unui server (după loc; doar jucătorii cu loc). */
  async leaderboard(actor: GcsActor, serverId: number, page = 1): Promise<{ items: (GcsStatTotals & { rank: number; player: { id: number; name: string; kind: GamePlayerKind; userId: string | null } })[]; total: number; page: number; pages: number } | null> {
    if (!(await this.canViewStats(actor)) || !(await this.deps.canViewServer(actor, serverId))) return null;
    const { db } = this.deps;
    const where = { serverId, rank: { not: null } };
    const p = Math.max(1, Math.floor(page));
    const [total, rows] = await Promise.all([
      db.gamePlayerStat.count({ where }),
      db.gamePlayerStat.findMany({ where, include: { player: { select: { id: true, name: true, kind: true, userId: true } } }, orderBy: { rank: "asc" }, skip: (p - 1) * PAGE, take: PAGE }),
    ]);
    return { items: rows.map((r) => ({ ...totals(r), rank: r.rank!, player: r.player })), total, page: p, pages: Math.max(1, Math.ceil(total / PAGE)) };
  }

  /** Clasamentul ELO (meciurile mix). */
  async mixLeaderboard(actor: GcsActor, page = 1): Promise<{ items: { position: number; elo: number; peak: number; matches: number; wins: number; losses: number; draws: number; player: { id: number; name: string; kind: GamePlayerKind; userId: string | null } }[]; total: number; page: number; pages: number } | null> {
    if (!(await this.canViewStats(actor))) return null;
    const { db } = this.deps;
    const where = { matches: { gt: 0 } };
    const p = Math.max(1, Math.floor(page));
    const [total, rows] = await Promise.all([
      db.gameRating.count({ where }),
      db.gameRating.findMany({ where, include: { player: { select: { id: true, name: true, kind: true, userId: true } } }, orderBy: [{ elo: "desc" }, { matches: "desc" }, { playerId: "asc" }], skip: (p - 1) * PAGE, take: PAGE }),
    ]);
    return { items: rows.map((r, i) => ({ position: (p - 1) * PAGE + i + 1, elo: r.elo, peak: r.peak, matches: r.matches, wins: r.wins, losses: r.losses, draws: r.draws, player: r.player })), total, page: p, pages: Math.max(1, Math.ceil(total / PAGE)) };
  }

  /** Serverele vizibile ale unei liste de meciuri (filtrul pe server, dacă e dat). */
  private async matchServers(actor: GcsActor, serverId?: number): Promise<number[]> {
    const visible = await this.deps.visibleServers(actor);
    return typeof serverId === "number" ? visible.filter((id) => id === serverId) : visible;
  }

  /** Condiția listei de meciuri: serverele, jucătorul, starea (tab-ul) și harta (un nume invalid nu filtrează). */
  private matchWhere(serverIds: number[], filter: Pick<GcsMatchFilter, "playerId" | "status" | "map">): Prisma.GameMatchWhereInput {
    const map = filter.map === undefined ? null : cleanMapName(filter.map);
    return {
      serverId: { in: serverIds },
      ...(typeof filter.playerId === "number" ? { players: { some: { playerId: filter.playerId } } } : {}),
      ...(filter.status === "live" ? { status: { in: OPEN_MATCH } } : filter.status === "ended" ? { status: { in: CLOSED_MATCH } } : {}),
      ...(map ? { map } : {}),
    };
  }

  /**
   * Meciurile (încheiate sau în curs), pe server, jucător, stare și hartă, cele mai noi primele. Cu `withStats`, fiecare
   * are formatul (jucătorii pe echipe) și ELO-ul mediu (o singură citire în plus pentru toată pagina).
   */
  async matches(actor: GcsActor, filter: GcsMatchFilter): Promise<{ items: GcsMatchSummary[]; total: number; page: number; pages: number }> {
    const empty = { items: [], total: 0, page: 1, pages: 1 };
    if (!(await this.canViewStats(actor))) return empty;
    const serverIds = await this.matchServers(actor, filter.serverId);
    if (serverIds.length === 0) return empty;
    const where = this.matchWhere(serverIds, filter);
    const p = Math.max(1, Math.floor(filter.page ?? 1));
    const [total, rows] = await Promise.all([
      this.deps.db.gameMatch.count({ where }),
      this.deps.db.gameMatch.findMany({
        where,
        include: { server: { select: { id: true, name: true, slug: true, game: true } }, ...(typeof filter.playerId === "number" ? { players: { where: { playerId: filter.playerId } } } : {}) },
        // Meciurile începute în aceeași secundă (timpii vin în secunde): cel creat mai târziu primul.
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        skip: (p - 1) * PAGE,
        take: PAGE,
      }),
    ]);
    const stats = filter.withStats ? await this.matchStats(rows.map((m) => m.id)) : null;
    return {
      items: rows.map((m) => {
        const mine = (m as { players?: { team: string; eloBefore: number | null; eloAfter: number | null; kills: number; deaths: number }[] }).players?.[0];
        return {
          id: m.id,
          server: m.server,
          map: m.map,
          status: m.status.toLowerCase(),
          teams: { A: { name: m.teamAName, score: m.scoreA }, B: { name: m.teamBName, score: m.scoreB } },
          winner: m.winner,
          round: m.round,
          startedAt: m.startedAt.toISOString(),
          liveAt: m.liveAt?.toISOString() ?? null,
          endedAt: m.endedAt?.toISOString() ?? null,
          ...(mine ? { player: { team: mine.team, eloBefore: mine.eloBefore, eloAfter: mine.eloAfter, kills: mine.kills, deaths: mine.deaths } } : {}),
          ...(stats ? { stats: stats.get(m.id) ?? { players: { A: 0, B: 0 }, avgElo: null } } : {}),
        };
      }),
      total,
      page: p,
      pages: Math.max(1, Math.ceil(total / PAGE)),
    };
  }

  /**
   * Formatul și ELO-ul mediu al meciurilor (o citire agregată): ELO-ul de dinainte de meci (meciurile evaluate), altfel
   * ratingul curent al jucătorului; jucătorii fără rating nu intră în medie; niciunul = necunoscut (`null`).
   */
  private async matchStats(ids: number[]): Promise<Map<number, GcsMatchStats>> {
    if (ids.length === 0) return new Map();
    const rows = await this.deps.db.$queryRaw<{ id: number; a: number; b: number; elo: number | null }[]>`
      SELECT mp."matchId" AS id,
             (COUNT(*) FILTER (WHERE mp.team = 'A'))::int AS a,
             (COUNT(*) FILTER (WHERE mp.team = 'B'))::int AS b,
             ROUND(AVG(COALESCE(mp."eloBefore", r.elo)))::int AS elo
      FROM game_match_players mp
      LEFT JOIN game_ratings r ON r."playerId" = mp."playerId"
      WHERE mp."matchId" IN (${Prisma.join(ids)})
      GROUP BY mp."matchId"`;
    return new Map(rows.map((r) => [r.id, { players: { A: r.a, B: r.b }, avgElo: r.elo }]));
  }

  /** Numărătorile tab-urilor listei (cu filtrele pe server și hartă): toate, live (încălzire / live / pauză), terminate. */
  async matchCounts(actor: GcsActor, filter: { serverId?: number; map?: string } = {}): Promise<{ all: number; live: number; ended: number }> {
    const zero = { all: 0, live: 0, ended: 0 };
    if (!(await this.canViewStats(actor))) return zero;
    const serverIds = await this.matchServers(actor, filter.serverId);
    if (serverIds.length === 0) return zero;
    const groups = await this.deps.db.gameMatch.groupBy({ by: ["status"], where: this.matchWhere(serverIds, filter), _count: { _all: true } });
    const count = (statuses: GameMatchStatus[]) => groups.reduce((n, g) => n + (statuses.includes(g.status) ? g._count._all : 0), 0);
    const live = count(OPEN_MATCH);
    const ended = count(CLOSED_MATCH);
    return { all: live + ended, live, ended };
  }

  /** Hărțile filtrului listei (cele mai jucate 50, apoi alfabetic), cu numărul de meciuri. */
  async matchMaps(actor: GcsActor, filter: { serverId?: number } = {}): Promise<{ map: string; count: number }[]> {
    if (!(await this.canViewStats(actor))) return [];
    const serverIds = await this.matchServers(actor, filter.serverId);
    if (serverIds.length === 0) return [];
    const groups = await this.deps.db.gameMatch.groupBy({
      by: ["map"],
      where: { serverId: { in: serverIds }, map: { not: "" } },
      _count: { _all: true },
      orderBy: [{ _count: { map: "desc" } }, { map: "asc" }],
      take: MATCH_MAPS_MAX,
    });
    return groups.map((g) => ({ map: g.map, count: g._count._all })).sort((a, b) => a.map.localeCompare(b.map));
  }

  async match(actor: GcsActor, id: number): Promise<GcsMatchDetails | null> {
    if (!(await this.canViewStats(actor))) return null;
    const m = await this.deps.db.gameMatch.findUnique({
      where: { id },
      include: { server: { select: { id: true, name: true, slug: true, game: true } }, players: { orderBy: [{ team: "asc" }, { kills: "desc" }] }, rounds: { orderBy: { number: "asc" } } },
    });
    if (!m || !(await this.deps.canViewServer(actor, m.serverId))) return null;
    return {
      id: m.id,
      server: m.server,
      map: m.map,
      status: m.status.toLowerCase(),
      teams: { A: { name: m.teamAName, score: m.scoreA }, B: { name: m.teamBName, score: m.scoreB } },
      winner: m.winner,
      startedAt: m.startedAt.toISOString(),
      liveAt: m.liveAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      round: m.round,
      rated: m.rated,
      players: m.players.map((p) => ({ playerId: p.playerId, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, assists: p.assists, headshots: p.headshots, damage: p.damage, mvps: p.mvps, eloBefore: p.eloBefore, eloAfter: p.eloAfter })),
      rounds: m.rounds.map((r) => ({ number: r.number, winner: r.winner, scoreA: r.scoreA, scoreB: r.scoreB, reason: r.reason, endedAt: r.endedAt.toISOString() })),
    };
  }

  /** Meciul mix în desfășurare pe server (starea live din Redis). */
  async liveMatch(actor: GcsActor, serverId: number): Promise<GcsLiveMatch | null> {
    if (!(await this.canViewStats(actor)) || !(await this.deps.canViewServer(actor, serverId))) return null;
    return this.deps.store.match<GcsLiveMatch>(serverId);
  }

  /**
   * „Urmărește live” (specul servere-hltv §3): adresa HLTV / GOTV și întârzierea serverelor date, doar pentru cine vede
   * statisticile și doar pentru serverele vizibile; serverele fără adresă lipsesc.
   */
  async watch(actor: GcsActor, serverIds: number[]): Promise<Map<number, GcsTvWatch>> {
    if (!this.deps.tv || serverIds.length === 0 || !(await this.canViewStats(actor))) return new Map();
    const visible = new Set(await this.deps.visibleServers(actor));
    return this.deps.tv.watch([...new Set(serverIds)].filter((id) => visible.has(id)));
  }

  /** Accesul la camera live `match:{id}`. */
  async canJoinMatch(actor: GcsActor, id: string): Promise<boolean> {
    if (!/^[1-9]\d{0,9}$/.test(id) || !(await this.canViewStats(actor))) return false;
    const m = await this.deps.db.gameMatch.findUnique({ where: { id: Number(id) }, select: { serverId: true } });
    return m !== null && (await this.deps.canViewServer(actor, m.serverId));
  }

  /** Adminii unui server, cu prezența. */
  async serverAdmins(actor: GcsActor, serverId: number): Promise<GcsAdminPresence[] | null> {
    if (!(await this.canViewStats(actor)) || !(await this.deps.canViewServer(actor, serverId))) return null;
    // Sesiunile și acțiunile doar de pe serverele vizibile (un admin „toate serverele” poate juca pe unul ascuns).
    return this.deps.presence.list(actor, { serverId, visibleServers: await this.deps.visibleServers(actor) });
  }
}

