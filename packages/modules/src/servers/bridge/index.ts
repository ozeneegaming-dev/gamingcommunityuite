import {
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAppService,
  type GcsAttachmentService,
  type GcsEventBus,
  type GcsFetchedFile,
  type GcsJobQueue,
  type GcsPermissionService,
  type GcsRealtime,
  type GcsRedisRateLimiter,
  type GcsRendered,
  type GcsSettingsService,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type Redis from "ioredis";
import { SERVERS_ACP_SECTION } from "../service";
import { GcsBridgeAdmins } from "./admins";
import { GcsBridgeApi } from "./api";
import { BRIDGE_SETTING } from "./config";
import { closeSession, GcsBridgeEvents } from "./events";
import { GcsBridgeKeys, type GcsBridgeKeyRow } from "./keys";
import { GcsBridgeMaps } from "./maps";
import { GcsBridgeMatches, type GcsLiveMatch } from "./matches";
import { GcsBridgePlayers } from "./players";
import { GcsBridgePresence } from "./presence";
import { GcsBridgeQueries } from "./queries";
import { GcsBridgeSanctions } from "./sanctions";
import { GcsBridgeStatsProvider, recomputeRanks } from "./stats";
import { GcsBridgeStore, type GcsRoster } from "./store";
import { GcsBridgeTickets } from "./tickets";
import { GcsBridgeVip, type GcsVipMappingView } from "./vip";

/** Joburile punții (§16), în `gcs-worker`. */
export const BRIDGE_JOBS = { sweep: "servers.bridge.sweep", ranks: "servers.bridge.ranks", steam: "servers.bridge.steam", maps: "servers.bridge.maps" } as const;
const MIN = 60_000;
/** Id-urile evenimentelor aplicate se păstrează 14 zile. */
const EVENT_IDS_DAYS = 14;
const IDENTITY_MODES = ["steam", "mixed"] as const;

export type GcsBridgeDeps = {
  db: PrismaClient;
  redis: Redis;
  bus: GcsEventBus;
  settings: GcsSettingsService;
  permissions: GcsPermissionService;
  acp: GcsAcpRoleService;
  apps: GcsAppService;
  attachments: GcsAttachmentService;
  rateLimiter: GcsRedisRateLimiter;
  realtime: GcsRealtime;
  /** Documentul editorului → JSON validat + HTML sanitizat (ca postările). */
  render: (content: unknown) => Promise<GcsRendered>;
  canViewServer: (actor: GcsActor, id: number) => Promise<boolean>;
  visibleServers: (actor: GcsActor) => Promise<number[]>;
  now?: () => number;
  /** Doar pentru teste: descărcarea imaginilor hărților. */
  fetchMapImage?: (url: string) => Promise<GcsFetchedFile>;
};

/** Starea punții unui server în ACP (Gaming → Servere → un server → Plugin și chei API). */
export type GcsBridgeStatus = {
  server: { id: number; name: string; game: string; identityMode: string; nameIds: boolean; isMix: boolean; bridgeSeenAt: string | null; bridgePlugin: string | null };
  connected: boolean;
  roster: GcsRoster | null;
  match: GcsLiveMatch | null;
  keys: GcsBridgeKeyRow[];
  vip: GcsVipMappingView[];
  counts: { sessionsOpen: number; players: number; activeSanctions: number; matches: number };
};

/**
 * Puntea cu serverele de joc („GCS Server Bridge”, specul 2026-10-08-servere-bridge, partea A): serviciile aplicației
 * Servere folosite de protocol, de ACP și de paginile publice (partea B). Tot ce ține de servere stă aici; alte aplicații
 * (Clanuri) citesc doar prin `GcsPlayerStatsProvider` (`stats`).
 */
export class GcsBridge {
  readonly store: GcsBridgeStore;
  readonly keys: GcsBridgeKeys;
  readonly players: GcsBridgePlayers;
  readonly admins: GcsBridgeAdmins;
  readonly vip: GcsBridgeVip;
  readonly sanctions: GcsBridgeSanctions;
  readonly matches: GcsBridgeMatches;
  readonly maps: GcsBridgeMaps;
  readonly events: GcsBridgeEvents;
  readonly api: GcsBridgeApi;
  readonly presence: GcsBridgePresence;
  readonly tickets: GcsBridgeTickets;
  readonly queries: GcsBridgeQueries;
  /** Furnizorul statisticilor de joc ale membrilor (înregistrat în `GcsServerService.playerStats`). */
  readonly stats: GcsBridgeStatsProvider;

  constructor(private readonly deps: GcsBridgeDeps) {
    const { db, redis, bus, settings, permissions, acp, apps, attachments, rateLimiter, realtime, now } = deps;
    this.store = new GcsBridgeStore(redis);
    const store = this.store;
    this.keys = new GcsBridgeKeys({ db, acp, now });
    this.players = new GcsBridgePlayers({ db, bus, permissions, store, now });
    this.admins = new GcsBridgeAdmins({ db, acp, store, now });
    this.vip = new GcsBridgeVip({ db, acp, store, now });
    this.sanctions = new GcsBridgeSanctions({ db, bus, permissions, settings, attachments, admins: this.admins, now });
    this.matches = new GcsBridgeMatches({ db, settings, store, realtime, now });
    this.maps = new GcsBridgeMaps({ db, acp, attachments, settings, now, ...(deps.fetchMapImage ? { fetch: deps.fetchMapImage } : {}) });
    this.events = new GcsBridgeEvents({ db, players: this.players, admins: this.admins, sanctions: this.sanctions, matches: this.matches, maps: this.maps, store, now });
    this.api = new GcsBridgeApi({ db, apps, settings, rateLimiter, store, keys: this.keys, players: this.players, admins: this.admins, vip: this.vip, sanctions: this.sanctions, events: this.events, matches: this.matches, maps: this.maps, now });
    this.presence = new GcsBridgePresence({ db, permissions, settings, apps, store, now });
    this.tickets = new GcsBridgeTickets({ db, bus, permissions, admins: this.admins, sanctions: this.sanctions, render: deps.render, now });
    this.queries = new GcsBridgeQueries({ db, apps, permissions, store, players: this.players, sanctions: this.sanctions, presence: this.presence, canViewServer: deps.canViewServer, visibleServers: deps.visibleServers });
    this.stats = new GcsBridgeStatsProvider({ db });
  }

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  /** Ascultătorii: VIP-ul schimbă listele; un șablon de hărți schimbat reîncearcă hărțile fără imagine. */
  listen(bus: GcsEventBus): void {
    this.vip.listen(bus);
    bus.on("settings.updated", async (e) => {
      if (e.payload.key === BRIDGE_SETTING.mapTemplateCs16) await this.maps.resetFetches("cs16");
      if (e.payload.key === BRIDGE_SETTING.mapTemplateCs2) await this.maps.resetFetches("cs2");
    });
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: BRIDGE_JOBS.sweep, everyMs: 5 * MIN, handler: async () => void (await this.sweep()) });
    jobs.register({ name: BRIDGE_JOBS.ranks, everyMs: 10 * MIN, handler: async () => void (await this.ranks()) });
    jobs.register({ name: BRIDGE_JOBS.steam, everyMs: 10 * MIN, handler: async () => void (await this.players.reconcileSteam()) });
    jobs.register({ name: BRIDGE_JOBS.maps, everyMs: 10 * MIN, handler: async () => void (await this.maps.fetchDue()) });
  }

  /** Locurile pe server (jobul `servers.bridge.ranks`). */
  async ranks(): Promise<number> {
    return recomputeRanks(this.deps.db, await this.deps.settings.get<number>(BRIDGE_SETTING.rankMinMinutes));
  }

  /**
   * Jobul `servers.bridge.sweep` (la 5 minute): închide sesiunile serverelor tăcute, expiră adminii (jurnal + versiune),
   * șterge codurile de legare expirate, id-urile evenimentelor mai vechi de 14 zile și sesiunile / jurnalul din joc mai
   * vechi decât retenția.
   */
  async sweep(): Promise<{ sessions: number; admins: number; codes: number; events: number; old: number }> {
    const { db, settings } = this.deps;
    const store = this.store;
    const now = this.now();
    const sessions = await this.presence.closeSilent(async (serverId, playerId, at) => closeSession(db, serverId, playerId, at, await store.currentMap(serverId)));
    const admins = await this.admins.expireSweep();
    const codes = (await db.gameLinkCode.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 86_400_000) } }, { usedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }] } })).count;
    const events = (await db.gameBridgeEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - EVENT_IDS_DAYS * 86_400_000) } } })).count;
    const retention = new Date(now.getTime() - (await settings.get<number>(BRIDGE_SETTING.retentionDays)) * 86_400_000);
    const oldSessions = (await db.gameSession.deleteMany({ where: { disconnectedAt: { lt: retention } } })).count;
    const oldActions = (await db.gameAdminAction.deleteMany({ where: { at: { lt: retention } } })).count;
    return { sessions, admins, codes, events, old: oldSessions + oldActions };
  }

  /** Starea punții unui server (ACP). */
  async status(actor: GcsActor, serverId: number): Promise<GcsBridgeStatus | null> {
    const { db, acp, settings } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const server = await db.gameServer.findUnique({ where: { id: serverId }, select: { id: true, name: true, game: true, identityMode: true, nameIds: true, isMix: true, bridgeSeenAt: true, bridgePlugin: true } });
    if (!server) return null;
    const now = this.now();
    const heartbeat = await settings.get<number>(BRIDGE_SETTING.heartbeat);
    const [roster, match, keys, vip, sessionsOpen, players, activeSanctions, matches] = await Promise.all([
      this.store.roster(serverId),
      this.store.match<GcsLiveMatch>(serverId),
      this.keys.list(actor, serverId),
      this.vip.mappings(actor, serverId),
      db.gameSession.count({ where: { serverId, disconnectedAt: null } }),
      db.gamePlayerStat.count({ where: { serverId } }),
      db.gameSanction.count({ where: { unbannedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ scope: "GLOBAL" }, { serverId }] }] } }),
      db.gameMatch.count({ where: { serverId } }),
    ]);
    return {
      server: { ...server, bridgeSeenAt: server.bridgeSeenAt?.toISOString() ?? null },
      connected: server.bridgeSeenAt !== null && now.getTime() - server.bridgeSeenAt.getTime() <= 2 * heartbeat * 1000 + 15_000,
      roster,
      match,
      keys,
      vip,
      counts: { sessionsOpen, players, activeSanctions, matches },
    };
  }

  /** Modul identităților (`steam` / `mixed`), identitățile pe nume și serverul de meciuri mix (§15.3). */
  async saveConfig(actor: GcsActor, serverId: number, input: { identityMode: string; nameIds: boolean; isMix: boolean }): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    if (!(IDENTITY_MODES as readonly string[]).includes(input.identityMode)) throw new GcsValidationError({ identityMode: "invalid" });
    const before = await db.gameServer.findUnique({ where: { id: serverId }, select: { identityMode: true, nameIds: true, isMix: true } });
    if (!before) throw new GcsNotFound();
    const after = { identityMode: input.identityMode, nameIds: input.nameIds === true, isMix: input.isMix === true };
    await db.$transaction(async (tx) => {
      await tx.gameServer.update({ where: { id: serverId }, data: after });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.bridge.update", targetType: "game_server", targetId: String(serverId), before, after, ip: actor.ip });
    });
  }
}

export { BRIDGE_PERMISSION, BRIDGE_SETTING, BRIDGE_SETTING_DEFS, BRIDGE_SETTINGS_SECTION, MAP_IMAGE, SANCTION_EVIDENCE, SERVER_ADMINS_ACP_SECTION, SERVER_MAPS_ACP_SECTION } from "./config";
export { mapArtSvg } from "./mapArt";
export { BRIDGE_BASE_PATH, signBridgeRequest } from "./signing";
export type { GcsBridgeHttpRequest, GcsBridgeHttpResponse } from "./api";
export { BRIDGE_MAX_BODY, LINK_COMMAND } from "./api";
export { GCS_ADMIN_FLAGS, FLAG_CSS, normalizeFlags, cssPermissions } from "./flags";
export { generateAdminPassword, ADMIN_PASSWORD_MIN, type GcsServerAdminInput, type GcsServerAdminRow, type GcsAdminPresetView } from "./admins";
export type { GcsMapRow } from "./maps";
export { MAP_UPLOAD_MAX_FILES, MAP_IMAGE_MAX_BYTES, mapArtUrl } from "./maps";
export type { GcsAdminPresence, GcsOnlineAdmin } from "./presence";
export type { GcsSanctionInput, GcsSanctionUpdate, GcsSanctionView } from "./sanctions";
export type { GcsTicketInput, GcsTicketView, GcsTicketSummary, GcsTicketMessageView } from "./tickets";
export { TICKET_TITLE_MAX, TICKET_TITLE_MIN } from "./tickets";
export type { GcsPlayerProfile, GcsMatchDetails, GcsMatchSummary, GcsUserGameCard, GcsPlayerHit, GcsStatTotals, GcsIdentityView } from "./queries";
export type { GcsPlayerView } from "./players";
export { LINK_CODE_TTL_MS } from "./players";
export { matchRoom, MATCH_STATE_EVENT, SERVER_MATCH_EVENT } from "./matches";
export { ticketHref } from "./notify";
export { SANCTION_REASON_MAX } from "./sanctions";
export type { GcsLiveMatch } from "./matches";
export type { GcsRoster } from "./store";
export type { GcsBridgeKeyRow } from "./keys";
export type { GcsVipMappingView } from "./vip";
