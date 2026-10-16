import type { GcsRealtime, GcsSettingsService } from "@gcs/core";
import type { GameMatchStatus, Prisma, PrismaClient } from "@gcs/db";
import { cleanGameText } from "../text";
import { eloConfig } from "./config";
import { rateMatch } from "./elo";
import type { GcsPlayerRef } from "./identity";
import type { GcsBridgeStore } from "./store";
import { cleanMapName, type GcsBridgeServer, type GcsPlayerRow } from "./types";

/** Camera live a unui meci și evenimentele (§6.9). */
export const matchRoom = (id: number) => `match:${id}`;
export const MATCH_STATE_EVENT = "match:state";
export const SERVER_MATCH_EVENT = "servers:match";

const STATUSES: Record<string, GameMatchStatus> = { warmup: "WARMUP", live: "LIVE", halftime: "HALFTIME", ended: "ENDED", aborted: "ABORTED" };
const OPEN: GameMatchStatus[] = ["WARMUP", "LIVE", "HALFTIME"];
/** Tranzițiile permise (aceeași stare = o actualizare a meciului deschis). */
const NEXT: Record<GameMatchStatus, GameMatchStatus[]> = {
  WARMUP: ["WARMUP", "LIVE", "ABORTED"],
  LIVE: ["LIVE", "HALFTIME", "ENDED", "ABORTED"],
  HALFTIME: ["HALFTIME", "LIVE", "ABORTED"],
  ENDED: [],
  ABORTED: [],
};
const MAX_PLAYERS = 32;
const MAX_ROUNDS = 100;
const TEAM_NAME_MAX = 32;

export type GcsMatchPlayerInput = { ref: GcsPlayerRef; team: "A" | "B"; kills: number; deaths: number; assists: number; headshots: number; damage: number; mvps: number };

/** Starea unui meci trimisă de plugin, validată. */
export type GcsMatchStateInput = {
  externalId: string;
  status: GameMatchStatus;
  map: string | null;
  round: number;
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  players: GcsMatchPlayerInput[];
};

/** Starea publică (live): fără IP-uri și fără ID-uri brute. */
export type GcsLiveMatch = {
  id: number | null;
  externalId: string;
  serverId: number;
  status: string;
  map: string | null;
  round: number;
  teams: { A: { name: string; score: number }; B: { name: string; score: number } };
  players: { playerId: number | null; name: string; team: "A" | "B"; kills: number; deaths: number; assists: number; headshots: number; damage: number; mvps: number }[];
  updatedAt: string;
};

const count = (v: unknown, max = 100_000) => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, max) : 0);

/** Validează obiectul `match` (§6.9); `null` dacă nu are forma cerută. */
export function parseMatchState(raw: unknown): GcsMatchStateInput | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const externalId = typeof m.id === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(m.id) ? m.id : null;
  const status = typeof m.status === "string" ? STATUSES[m.status.toLowerCase()] : undefined;
  if (!externalId || !status) return null;
  const teams = (m.teams && typeof m.teams === "object" ? m.teams : {}) as Record<string, { name?: unknown } | undefined>;
  const score = (m.score && typeof m.score === "object" ? m.score : {}) as Record<string, unknown>;
  const players = (Array.isArray(m.players) ? m.players : []).slice(0, MAX_PLAYERS).flatMap((p): GcsMatchPlayerInput[] => {
    if (!p || typeof p !== "object") return [];
    const o = p as Record<string, unknown>;
    if (o.team !== "A" && o.team !== "B") return [];
    return [{ ref: (o.player ?? {}) as GcsPlayerRef, team: o.team, kills: count(o.kills), deaths: count(o.deaths), assists: count(o.assists), headshots: count(o.headshots), damage: count(o.damage, 10_000_000), mvps: count(o.mvps) }];
  });
  return {
    externalId,
    status,
    map: cleanMapName(m.map),
    round: count(m.round, MAX_ROUNDS),
    teamA: cleanGameText(teams.A?.name, TEAM_NAME_MAX) || "A",
    teamB: cleanGameText(teams.B?.name, TEAM_NAME_MAX) || "B",
    scoreA: count(score.A, MAX_ROUNDS),
    scoreB: count(score.B, MAX_ROUNDS),
    players,
  };
}

/**
 * Meciurile mix (specul 2026-10-08-servere-bridge §6.9, §10): starea completă trimisă de plugin (creare, actualizare,
 * tranzițiile permise), istoricul rundelor, ELO-ul la final și starea live (Redis + realtime).
 */
export class GcsBridgeMatches {
  constructor(private readonly deps: { db: PrismaClient; settings: GcsSettingsService; store: GcsBridgeStore; realtime: GcsRealtime; now?: () => number }) {}

  /**
   * Evenimentul `match`, în tranzacția lui. `players` = identitățile rezolvate, în ordinea din stare (`null` = neurmărit).
   * O tranziție invalidă (eveniment vechi sosit târziu) → `invalid_state`.
   */
  async applyState(
    tx: Prisma.TransactionClient,
    server: GcsBridgeServer,
    state: GcsMatchStateInput,
    players: (GcsPlayerRow | null)[],
    at: Date,
  ): Promise<{ matchId: number; ended: boolean; status: GameMatchStatus; previous: GameMatchStatus | null } | { error: string }> {
    const existing = await tx.$queryRaw<{ id: number; status: GameMatchStatus }[]>`
      SELECT id, status FROM game_matches WHERE "serverId" = ${server.id} AND "externalId" = ${state.externalId} FOR UPDATE`;
    const current = existing[0];
    if (current && !NEXT[current.status].includes(state.status)) return { error: "invalid_state" };
    const final = state.status === "ENDED" || state.status === "ABORTED";
    const winner = state.status === "ENDED" ? (state.scoreA > state.scoreB ? "A" : state.scoreB > state.scoreA ? "B" : "DRAW") : null;
    const fields = {
      map: state.map ?? "",
      status: state.status,
      teamAName: state.teamA,
      teamBName: state.teamB,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      round: state.round,
      winner,
      ...(final ? { endedAt: at } : {}),
    };
    const match = current
      ? await tx.gameMatch.update({ where: { id: current.id }, data: fields })
      : await tx.gameMatch.create({ data: { serverId: server.id, externalId: state.externalId, startedAt: at, ...fields, ...(state.status !== "WARMUP" ? { liveAt: at } : {}) } });
    if (state.status === "LIVE" && !match.liveAt) await tx.gameMatch.update({ where: { id: match.id }, data: { liveAt: at } });

    // Statisticile din ultima stare sunt totalurile (o identitate apare o singură dată; ultima intrare câștigă).
    const seen = new Map<number, GcsMatchPlayerInput & { name: string }>();
    state.players.forEach((p, i) => {
      const row = players[i];
      if (row) seen.set(row.id, { ...p, name: cleanGameText(p.ref.name, 32) || row.name });
    });
    for (const [playerId, p] of seen) {
      const data = { team: p.team, name: p.name, kills: p.kills, deaths: p.deaths, assists: p.assists, headshots: p.headshots, damage: p.damage, mvps: p.mvps };
      await tx.gameMatchPlayer.upsert({ where: { matchId_playerId: { matchId: match.id, playerId } }, create: { matchId: match.id, playerId, ...data }, update: data });
    }
    if (state.status === "ENDED") await this.rate(tx, match.id);
    // Starea de dinainte: demo-urile și rcon-ul HLTV reacționează doar la o schimbare (specul servere-hltv §6).
    return { matchId: match.id, ended: final, status: state.status, previous: current?.status ?? null };
  }

  /**
   * ELO-ul unui meci încheiat (o singură dată, `rated`): doar cu cel puțin `servers.mix_min_rounds` runde jucate și cel
   * puțin un jucător în fiecare echipă. Meciurile anulate nu schimbă nimic.
   */
  private async rate(tx: Prisma.TransactionClient, matchId: number): Promise<void> {
    const match = await tx.gameMatch.findUniqueOrThrow({ where: { id: matchId }, include: { players: true } });
    if (match.rated || match.status !== "ENDED" || !match.winner) return;
    const cfg = await eloConfig(this.deps.settings);
    const rounds = Math.max(match.round, match.scoreA + match.scoreB);
    const teams = { A: match.players.filter((p) => p.team === "A"), B: match.players.filter((p) => p.team === "B") };
    if (rounds < cfg.minRounds || teams.A.length === 0 || teams.B.length === 0) return;
    const ratings = new Map((await tx.gameRating.findMany({ where: { playerId: { in: match.players.map((p) => p.playerId) } } })).map((r) => [r.playerId, r]));
    const changes = rateMatch(
      match.players.map((p) => ({ id: p.playerId, team: p.team as "A" | "B", elo: ratings.get(p.playerId)?.elo ?? cfg.start, matches: ratings.get(p.playerId)?.matches ?? 0, damage: p.damage })),
      match.winner as "A" | "B" | "DRAW",
      cfg,
    );
    for (const p of match.players) {
      const change = changes.get(p.playerId)!;
      const won = match.winner === p.team;
      const draw = match.winner === "DRAW";
      await tx.gameMatchPlayer.update({ where: { matchId_playerId: { matchId, playerId: p.playerId } }, data: { eloBefore: change.before, eloAfter: change.after } });
      const r = ratings.get(p.playerId);
      await tx.gameRating.upsert({
        where: { playerId: p.playerId },
        create: { playerId: p.playerId, elo: change.after, matches: 1, wins: won ? 1 : 0, losses: !won && !draw ? 1 : 0, draws: draw ? 1 : 0, peak: Math.max(cfg.start, change.after) },
        update: { elo: change.after, matches: { increment: 1 }, wins: { increment: won ? 1 : 0 }, losses: { increment: !won && !draw ? 1 : 0 }, draws: { increment: draw ? 1 : 0 }, peak: Math.max(r?.peak ?? cfg.start, change.after) },
      });
    }
    await tx.gameMatch.update({ where: { id: matchId }, data: { rated: true } });
  }

  /** Evenimentul `match_round`: istoricul rundelor (meciul trebuie să fie deschis). */
  async applyRound(tx: Prisma.TransactionClient, server: GcsBridgeServer, ev: { externalId: string; round: number; winner: "A" | "B"; scoreA: number; scoreB: number; reason: string }, at: Date): Promise<{ matchId: number } | { error: string }> {
    const [match] = await tx.$queryRaw<{ id: number; status: GameMatchStatus; round: number }[]>`
      SELECT id, status, round FROM game_matches WHERE "serverId" = ${server.id} AND "externalId" = ${ev.externalId} FOR UPDATE`;
    if (!match) return { error: "unknown_match" };
    if (!OPEN.includes(match.status)) return { error: "invalid_state" };
    const data = { winner: ev.winner, scoreA: ev.scoreA, scoreB: ev.scoreB, reason: ev.reason, endedAt: at };
    await tx.gameMatchRound.upsert({ where: { matchId_number: { matchId: match.id, number: ev.round } }, create: { matchId: match.id, number: ev.round, ...data }, update: data });
    // Rundele pot sosi în altă ordine: scorul meciului îl dă cea mai recentă.
    if (ev.round >= match.round) await tx.gameMatch.update({ where: { id: match.id }, data: { scoreA: ev.scoreA, scoreB: ev.scoreB, round: ev.round } });
    return { matchId: match.id };
  }

  /** Starea publică a meciului din baza de date (după `match` / `match_round`). */
  async liveFromDb(matchId: number): Promise<GcsLiveMatch | null> {
    const m = await this.deps.db.gameMatch.findUnique({ where: { id: matchId }, include: { players: { orderBy: [{ team: "asc" }, { kills: "desc" }] } } });
    if (!m) return null;
    return {
      id: m.id,
      externalId: m.externalId,
      serverId: m.serverId,
      status: m.status.toLowerCase(),
      map: m.map || null,
      round: m.round,
      teams: { A: { name: m.teamAName, score: m.scoreA }, B: { name: m.teamBName, score: m.scoreB } },
      players: m.players.map((p) => ({ playerId: p.playerId, name: p.name, team: p.team as "A" | "B", kills: p.kills, deaths: p.deaths, assists: p.assists, headshots: p.headshots, damage: p.damage, mvps: p.mvps })),
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  /** Starea live dintr-un heartbeat (fără scriere în baza de date): id-ul meciului, dacă există deja. */
  async liveFromState(server: GcsBridgeServer, state: GcsMatchStateInput, players: (GcsPlayerRow | null)[], at: Date): Promise<GcsLiveMatch> {
    const existing = await this.deps.db.gameMatch.findUnique({ where: { serverId_externalId: { serverId: server.id, externalId: state.externalId } }, select: { id: true } });
    return {
      id: existing?.id ?? null,
      externalId: state.externalId,
      serverId: server.id,
      status: state.status.toLowerCase(),
      map: state.map,
      round: state.round,
      teams: { A: { name: state.teamA, score: state.scoreA }, B: { name: state.teamB, score: state.scoreB } },
      players: state.players.map((p, i) => ({ playerId: players[i]?.id ?? null, name: cleanGameText(p.ref.name, 32) || players[i]?.name || "", team: p.team, kills: p.kills, deaths: p.deaths, assists: p.assists, headshots: p.headshots, damage: p.damage, mvps: p.mvps })),
      updatedAt: at.toISOString(),
    };
  }

  /** Publică starea live: Redis (`gcs:bridge:match:{server}`), camera serverului și camera meciului. Un meci încheiat iese din Redis. */
  async publish(live: GcsLiveMatch): Promise<void> {
    const { store, realtime } = this.deps;
    const open = live.status !== "ended" && live.status !== "aborted";
    await store.saveMatch(live.serverId, open ? live : null);
    await realtime.publish(`servers:${live.serverId}`, SERVER_MATCH_EVENT, live);
    if (live.id !== null) await realtime.publish(matchRoom(live.id), MATCH_STATE_EVENT, live);
    // Un meci încheiat apare în „Feed live” (tab-ul Mix) al consolei: semnalul fără date, pentru toți.
    if (live.status === "ended") await realtime.publish("presence", "activity:new", { kind: "mix" });
  }
}
