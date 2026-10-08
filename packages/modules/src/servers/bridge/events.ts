import { Prisma, type PrismaClient } from "@gcs/db";
import { cleanGameText } from "../text";
import type { GcsBridgeAdmins } from "./admins";
import type { GcsBridgeDemos } from "./demos/service";
import { reportedAdminFlags } from "./flags";
import { cleanIp, resolveIdentity, type GcsPlayerRef } from "./identity";
import type { GcsBridgeMaps } from "./maps";
import { parseMatchState, type GcsBridgeMatches } from "./matches";
import type { GcsBridgePlayers } from "./players";
import type { GcsBridgeSanctions } from "./sanctions";
import { addMapStats, addPlayerStats, addWeaponStats } from "./stats";
import type { GcsBridgeStore } from "./store";
import { cleanMapName, cleanWeapon, identityKey, plainText, type GcsBridgeServer, type GcsPlayerRow } from "./types";

type Tx = Prisma.TransactionClient;

export const MAX_EVENTS = 500;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Timpii evenimentelor se taie la `[acum − 7 zile, acum + 60 s]`. */
const PAST_MS = 7 * 86_400_000;
const FUTURE_MS = 60_000;
const DETAILS_MAX = 2048;
const ADMIN_ACTIONS = new Set(["ban", "unban", "kick", "slay", "slap", "mute", "unmute", "gag", "ungag", "map", "other"]);
const SANCTION_KINDS = { ban: "BAN", mute: "MUTE", gag: "GAG" } as const;
const MAX_ROUND_PLAYERS = 64;

export type GcsBridgeEventResult = { id: string; status: "ok" | "duplicate" | "rejected"; error?: string; note?: string; sanctionId?: number };

/** Un eveniment respins în tranzacția lui (nimic nu se scrie, nici id-ul). */
class Rejected extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const num = (v: unknown, max = 1_000_000) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Contextul unui lot: serverul, identitățile rezolvate (o dată pe lot) și efectele de după commit. */
type BatchCtx = {
  server: GcsBridgeServer;
  players: Map<string, GcsPlayerRow | null>;
  after: (() => Promise<void>)[];
};

/**
 * Evenimentele trimise de plugin (`POST /events`, specul 2026-10-08-servere-bridge §6.4). Fiecare eveniment se aplică
 * într-o tranzacție împreună cu id-ul lui (exact o dată): un id deja aplicat → `duplicate` (tot confirmare), unul
 * invalid → `rejected` (nu se reîncearcă). Identitățile se rezolvă înaintea tranzacției (crearea lor e idempotentă).
 */
export class GcsBridgeEvents {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      players: GcsBridgePlayers;
      admins: GcsBridgeAdmins;
      sanctions: GcsBridgeSanctions;
      matches: GcsBridgeMatches;
      maps: GcsBridgeMaps;
      store: GcsBridgeStore;
      /** Demo-urile (rândul la final) și rcon-ul HLTV (specul servere-hltv §5–6). */
      demos?: GcsBridgeDemos;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Timpul evenimentului (Unix, secunde, în ceasul GCS), tăiat la intervalul permis. */
  private at(raw: unknown): Date {
    const now = this.now();
    if (typeof raw !== "number" || !Number.isFinite(raw)) return new Date(now);
    return new Date(Math.min(now + FUTURE_MS, Math.max(now - PAST_MS, Math.floor(raw) * 1000)));
  }

  async applyBatch(server: GcsBridgeServer, raw: unknown[]): Promise<GcsBridgeEventResult[]> {
    const events = raw.slice(0, MAX_EVENTS).map(obj);
    const ids = events.map((e) => (typeof e.id === "string" && EVENT_ID.test(e.id) ? e.id : null));
    const valid = [...new Set(ids.filter((id): id is string => id !== null))];
    const done = new Set(
      valid.length === 0 ? [] : (await this.deps.db.gameBridgeEvent.findMany({ where: { serverId: server.id, eventId: { in: valid } }, select: { eventId: true } })).map((e) => e.eventId),
    );
    const ctx: BatchCtx = { server, players: new Map(), after: [] };
    const results: GcsBridgeEventResult[] = [];
    const seenInBatch = new Set<string>();
    for (const [i, event] of events.entries()) {
      const id = ids[i];
      if (!id) {
        results.push({ id: typeof event.id === "string" ? event.id.slice(0, 64) : "", status: "rejected", error: "invalid_id" });
        continue;
      }
      if (done.has(id) || seenInBatch.has(id)) {
        results.push({ id, status: "duplicate" });
        continue;
      }
      seenInBatch.add(id);
      results.push(await this.applyOne(ctx, id, event));
    }
    for (const fn of ctx.after) await fn().catch((error: unknown) => console.error("[gcs] efectul unui eveniment al punții a eșuat", error));
    return results;
  }

  private async player(ctx: BatchCtx, ref: unknown, at: Date): Promise<GcsPlayerRow | null> {
    const r = obj(ref) as GcsPlayerRef;
    const identity = resolveIdentity(r, ctx.server);
    if (!identity) return null;
    const key = identityKey(identity.kind, identity.value);
    if (!ctx.players.has(key)) ctx.players.set(key, await this.deps.players.upsert(identity, ctx.server.id, at));
    return ctx.players.get(key)!;
  }

  private async applyOne(ctx: BatchCtx, id: string, e: Record<string, unknown>): Promise<GcsBridgeEventResult> {
    const type = typeof e.type === "string" ? e.type : "";
    const at = this.at(e.at);
    let prepared: ((tx: Tx) => Promise<Partial<GcsBridgeEventResult> | void>) | null;
    try {
      prepared = await this.prepare(ctx, type, e, at);
    } catch (error) {
      if (error instanceof Rejected) return { id, status: "rejected", error: error.code };
      throw error;
    }
    if (!prepared) return { id, status: "rejected", error: "unknown_type" };
    try {
      const extra = await this.deps.db.$transaction(async (tx) => {
        const inserted = await tx.$executeRaw`
          INSERT INTO game_bridge_events ("serverId", "eventId", "createdAt") VALUES (${ctx.server.id}, ${id}, ${new Date(this.now()).toISOString()}::timestamp)
          ON CONFLICT DO NOTHING`;
        if (inserted === 0) return "duplicate" as const;
        return (await prepared(tx)) ?? {};
      });
      if (extra === "duplicate") return { id, status: "duplicate" };
      return { id, status: "ok", ...extra };
    } catch (error) {
      if (error instanceof Rejected) return { id, status: "rejected", error: error.code };
      // O eroare a datelor (ex. o constrângere a bazei) ar bloca pentru totdeauna coada pluginului: evenimentul se
      // confirmă ca respins și se notează. Erorile de conexiune urcă mai departe (lotul se reîncearcă).
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        console.error(`[gcs] evenimentul ${id} (${type}) al serverului ${ctx.server.id} nu s-a putut aplica`, error.code);
        return { id, status: "rejected", error: "internal_error" };
      }
      throw error;
    }
  }

  /**
   * Validează evenimentul și rezolvă identitățile (în afara tranzacției); întoarce funcția care îl aplică în tranzacție,
   * sau `null` pentru un tip necunoscut.
   */
  private async prepare(ctx: BatchCtx, type: string, e: Record<string, unknown>, at: Date): Promise<((tx: Tx) => Promise<Partial<GcsBridgeEventResult> | void>) | null> {
    const { server } = ctx;
    const { store, maps, admins, sanctions, matches } = this.deps;
    const currentMap = async () => cleanMapName(e.map) ?? (await store.currentMap(server.id));

    switch (type) {
      case "connect": {
        const p = await this.player(ctx, e.player, at);
        const ref = obj(e.player);
        const adminId = p ? await admins.adminFor(server.id, p.id) : null;
        return async (tx) => {
          if (!p) return { note: "untracked" };
          await openSession(tx, server.id, p, { name: cleanGameText(ref.name, 32), ip: cleanIp(ref.ip), adminId, at, adminFlags: reportedAdminFlags(ref) });
        };
      }
      case "disconnect": {
        const p = await this.player(ctx, e.player, at);
        const map = await currentMap();
        const hint = typeof e.playtime === "number" ? num(e.playtime, 7 * 86_400) : null;
        return async (tx) => {
          if (!p) return { note: "untracked" };
          await closeSession(tx, server.id, p.id, at, map, hint);
        };
      }
      case "map": {
        const map = cleanMapName(e.map);
        if (!map) throw new Rejected("invalid_map");
        ctx.after.push(async () => {
          await store.setMap(server.id, map);
          await maps.seen(server.game, map);
        });
        return async () => {};
      }
      case "kill": {
        const victim = await this.player(ctx, e.victim, at);
        const killer = e.killer ? await this.player(ctx, e.killer, at) : null;
        const assister = e.assister ? await this.player(ctx, e.assister, at) : null;
        const weapon = cleanWeapon(e.weapon) ?? "unknown";
        const map = await currentMap();
        const headshot = e.headshot === true;
        const suicide = !e.killer || (killer !== null && victim !== null && killer.id === victim.id);
        const teamkill = !suicide && e.teamkill === true;
        return async (tx) => {
          if (victim) {
            await addPlayerStats(tx, victim.id, server.id, suicide ? { deaths: 1, suicides: 1 } : { deaths: 1 }, at);
            if (!suicide) await addWeaponStats(tx, victim.id, server.id, weapon, { deaths: 1 });
            if (map) await addMapStats(tx, victim.id, server.id, map, { deaths: 1 });
          }
          if (killer && !suicide) {
            const delta = teamkill ? { teamkills: 1 } : { kills: 1, headshots: headshot ? 1 : 0 };
            await addPlayerStats(tx, killer.id, server.id, delta, at);
            if (!teamkill) {
              await addWeaponStats(tx, killer.id, server.id, weapon, { kills: 1, headshots: headshot ? 1 : 0 });
              if (map) await addMapStats(tx, killer.id, server.id, map, { kills: 1, headshots: headshot ? 1 : 0 });
            }
          }
          if (assister && !suicide && assister.id !== killer?.id && assister.id !== victim?.id) await addPlayerStats(tx, assister.id, server.id, { assists: 1 }, at);
        };
      }
      case "weapon_stats": {
        const p = await this.player(ctx, e.player, at);
        const weapon = cleanWeapon(e.weapon);
        if (!weapon) throw new Rejected("invalid_weapon");
        const shots = num(e.shots, 100_000);
        const hits = Math.min(num(e.hits, 100_000), shots || 100_000);
        const damage = num(e.damage, 10_000_000);
        return async (tx) => {
          if (!p) return { note: "untracked" };
          await addPlayerStats(tx, p.id, server.id, { shots, hits, damage }, at);
          await addWeaponStats(tx, p.id, server.id, weapon, { shots, hits, damage });
        };
      }
      case "round_end": {
        const winner = typeof e.winner === "string" ? e.winner.toUpperCase() : "";
        if (!["CT", "T", "DRAW"].includes(winner)) throw new Rejected("invalid_winner");
        const map = await currentMap();
        const list: { p: GcsPlayerRow; won: boolean }[] = [];
        for (const item of (Array.isArray(e.players) ? e.players : []).slice(0, MAX_ROUND_PLAYERS)) {
          const o = obj(item);
          const team = typeof o.team === "string" ? o.team.toUpperCase() : "";
          if (team !== "CT" && team !== "T") continue;
          const p = await this.player(ctx, o.player, at);
          if (p && !list.some((x) => x.p.id === p.id)) list.push({ p, won: team === winner });
        }
        return async (tx) => {
          for (const { p, won } of list) {
            await addPlayerStats(tx, p.id, server.id, { rounds: 1, roundsWon: won ? 1 : 0 }, at);
            if (map) await addMapStats(tx, p.id, server.id, map, { rounds: 1, roundsWon: won ? 1 : 0 });
          }
        };
      }
      case "admin_action": {
        const admin = await this.player(ctx, e.admin, at);
        const target = e.target ? await this.player(ctx, e.target, at) : null;
        const action = typeof e.action === "string" && ADMIN_ACTIONS.has(e.action.toLowerCase()) ? e.action.toLowerCase() : "other";
        const details = e.details && typeof e.details === "object" ? e.details : null;
        const detailsJson = details && JSON.stringify(details).length <= DETAILS_MAX ? (details as Prisma.InputJsonValue) : Prisma.DbNull;
        const adminName = cleanGameText(obj(e.admin).name, 32) || admin?.name || "Console";
        const adminId = admin ? await admins.adminFor(server.id, admin.id) : null;
        return async (tx) => {
          await tx.gameAdminAction.create({
            data: {
              serverId: server.id,
              adminPlayerId: admin?.id ?? null,
              adminUserId: admin?.userId ?? null,
              adminId: adminId ?? (admin ? await sessionAdmin(tx, server.id, admin.id) : null),
              adminName,
              action,
              targetPlayerId: target?.id ?? null,
              targetName: cleanGameText(obj(e.target).name, 32) || target?.name || "",
              reason: plainText(e.reason, 200),
              details: detailsJson,
              at,
            },
          });
        };
      }
      case "admin_login": {
        const p = await this.player(ctx, e.player, at);
        const adminId = Number.isInteger(e.adminId) ? (e.adminId as number) : null;
        if (!p || adminId === null || !(await admins.nameAdminOn(server.id, adminId))) throw new Rejected("invalid_admin");
        const ref = obj(e.player);
        return async (tx) => {
          const updated = await tx.gameSession.updateMany({ where: { serverId: server.id, playerId: p.id, disconnectedAt: null }, data: { adminId } });
          if (updated.count === 0) await openSession(tx, server.id, p, { name: cleanGameText(ref.name, 32), ip: cleanIp(ref.ip), adminId, at });
        };
      }
      case "sanction": {
        const kind = typeof e.kind === "string" ? SANCTION_KINDS[e.kind.toLowerCase() as keyof typeof SANCTION_KINDS] : undefined;
        if (!kind) throw new Rejected("invalid_kind");
        const targetRef = obj(e.target);
        const target = await this.player(ctx, targetRef, at);
        if (!target && !cleanIp(targetRef.ip) && !cleanGameText(targetRef.name, 32)) throw new Rejected("no_target");
        const admin = e.admin ? await this.player(ctx, e.admin, at) : null;
        const adminName = cleanGameText(obj(e.admin).name, 32) || admin?.name || "Console";
        const adminId = admin ? await admins.adminFor(server.id, admin.id) : null;
        const minutes = num(e.minutes, 5_256_000);
        const scope = e.scope === "global" ? "GLOBAL" : "SERVER";
        return async (tx) => {
          return sanctions.fromGame(tx, server, { type: kind, scope, minutes, reason: typeof e.reason === "string" ? e.reason : "", at, targetRef }, { target, admin, adminName, adminId });
        };
      }
      case "unsanction": {
        const kind = typeof e.kind === "string" ? SANCTION_KINDS[e.kind.toLowerCase() as keyof typeof SANCTION_KINDS] : undefined;
        if (!kind) throw new Rejected("invalid_kind");
        const targetRef = e.target ? obj(e.target) : null;
        const target = targetRef ? await this.player(ctx, targetRef, at) : null;
        const admin = e.admin ? await this.player(ctx, e.admin, at) : null;
        const adminName = cleanGameText(obj(e.admin).name, 32) || admin?.name || "Console";
        const adminId = admin ? await admins.adminFor(server.id, admin.id) : null;
        const sanctionId = Number.isInteger(e.sanctionId) && (e.sanctionId as number) > 0 ? (e.sanctionId as number) : null;
        return async (tx) => {
          const out = await sanctions.liftFromGame(tx, server, { type: kind, sanctionId, reason: typeof e.reason === "string" ? e.reason : "", at, targetRef }, { target, admin, adminName, adminId });
          if ("error" in out) throw new Rejected(out.error);
          return { sanctionId: out.sanctionId };
        };
      }
      case "match": {
        const state = parseMatchState(e.match);
        if (!state) throw new Rejected("invalid_match");
        const players: (GcsPlayerRow | null)[] = [];
        for (const p of state.players) players.push(await this.player(ctx, p.ref, at));
        return async (tx) => {
          const out = await matches.applyState(tx, server, state, players, at);
          if ("error" in out) throw new Rejected(out.error);
          const effects = (await this.deps.demos?.onMatchState(tx, server, out)) ?? [];
          ctx.after.push(async () => {
            if (state.map) await maps.seen(server.game, state.map);
            const live = await matches.liveFromDb(out.matchId);
            if (live) await matches.publish(live);
            for (const effect of effects) await effect();
          });
        };
      }
      case "match_round": {
        const externalId = typeof e.matchId === "string" && EVENT_ID.test(e.matchId) ? e.matchId : null;
        const winner = e.winner === "A" || e.winner === "B" ? e.winner : null;
        const round = num(e.round, 100);
        if (!externalId || !winner || round < 1) throw new Rejected("invalid_round");
        return async (tx) => {
          const out = await matches.applyRound(tx, server, { externalId, round, winner, scoreA: num(e.scoreA, 100), scoreB: num(e.scoreB, 100), reason: plainText(e.reason, 32) }, at);
          if ("error" in out) throw new Rejected(out.error);
          ctx.after.push(async () => {
            const live = await matches.liveFromDb(out.matchId);
            if (live) await matches.publish(live);
          });
        };
      }
      default:
        return null;
    }
  }
}

/** Sesiunea deschisă a jucătorului pe server (o singură sesiune deschisă: indexul unic parțial). */
export async function openSession(
  tx: Tx | PrismaClient,
  serverId: number,
  p: GcsPlayerRow,
  s: { name: string; ip: string | null; adminId: number | null; at: Date; adminFlags?: string | null },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO game_sessions ("serverId", "playerId", "adminId", name, ip, "connectedAt", "adminFlags")
    VALUES (${serverId}, ${p.id}, ${s.adminId}, ${s.name || p.name}, ${s.ip}, ${s.at.toISOString()}::timestamp, ${s.adminFlags ?? null})
    ON CONFLICT ("serverId", "playerId") WHERE "disconnectedAt" IS NULL DO NOTHING`;
}

/**
 * Închide sesiunea deschisă și adaugă timpul de joc pe server și pe hartă. `hint` = timpul raportat de plugin (plafonat
 * la durata sesiunii + 2 minute); fără el, durata sesiunii.
 */
export async function closeSession(tx: Tx | PrismaClient, serverId: number, playerId: number, at: Date, map: string | null, hint: number | null = null): Promise<number> {
  const session = await tx.gameSession.findFirst({ where: { serverId, playerId, disconnectedAt: null } });
  if (!session) return 0;
  const end = at < session.connectedAt ? session.connectedAt : at;
  const duration = Math.floor((end.getTime() - session.connectedAt.getTime()) / 1000);
  const seconds = Math.max(0, hint !== null ? Math.min(hint, duration + 120) : duration);
  const closed = await tx.gameSession.updateMany({ where: { id: session.id, disconnectedAt: null }, data: { disconnectedAt: end, seconds } });
  if (closed.count === 0) return 0;
  if (seconds > 0) {
    await addPlayerStats(tx, playerId, serverId, { playtime: seconds }, end);
    if (map) await addMapStats(tx, playerId, serverId, map, { playtime: seconds });
  }
  return seconds;
}

/** Adminul sesiunii deschise (adminii pe nume, după `admin_login`). */
async function sessionAdmin(tx: Tx, serverId: number, playerId: number): Promise<number | null> {
  const s = await tx.gameSession.findFirst({ where: { serverId, playerId, disconnectedAt: null }, select: { adminId: true } });
  return s?.adminId ?? null;
}
