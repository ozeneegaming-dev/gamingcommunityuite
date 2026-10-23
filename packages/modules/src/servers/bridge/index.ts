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
  type GcsFileStore,
  type GcsJobQueue,
  type GcsPermissionService,
  type GcsRealtime,
  type GcsKv,
  type GcsRateLimiter,
  type GcsRendered,
  type GcsSettingsService,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { BlockList } from "node:net";
import { serversAllowNets } from "../net";
import type { GcsServerQueryFn } from "../poller";
import { queryGameServer } from "../query";
import { SERVERS_ACP_SECTION } from "../service";
import { GcsBridgeAdmins } from "./admins";
import { GcsBridgeApi } from "./api";
import { BRIDGE_GAMES, BRIDGE_SETTING, mapModeSetting, mapTemplateSetting } from "./config";
import type { GcsDemoGuardOptions } from "./demos/guard";
import { DEMO_JOBS, GcsBridgeDemos } from "./demos/service";
import type { GcsDemoConnect } from "./demos/sources";
import { GcsBridgeEnrollments } from "./enroll";
import { closeSession, GcsBridgeEvents } from "./events";
import { GcsBridgeKeys, type GcsBridgeKeyRow } from "./keys";
import { GcsBridgeMaps } from "./maps";
import { GcsBridgeMatches, type GcsLiveMatch } from "./matches";
import { GcsBridgePackages } from "./package";
import { GcsBridgePlayers } from "./players";
import { GcsBridgePresence } from "./presence";
import { GcsBridgeQueries } from "./queries";
import { GcsBridgeSanctions } from "./sanctions";
import { GcsBridgeStatsProvider, recomputeRanks } from "./stats";
import { GcsBridgeStore, type GcsRoster } from "./store";
import { GcsBridgeTickets } from "./tickets";
import { GcsBridgeTv } from "./tv";
import { BRIDGE_SERVER_SELECT, bridgeFeatures, type GcsBridgeFeatures } from "./types";
import { GcsBridgeVip, type GcsVipMappingView } from "./vip";

/** Joburile punții (§16), în `gcs-worker`. */
export const BRIDGE_JOBS = { sweep: "servers.bridge.sweep", ranks: "servers.bridge.ranks", steam: "servers.bridge.steam", maps: "servers.bridge.maps" } as const;
const MIN = 60_000;
/** Id-urile evenimentelor aplicate se păstrează 14 zile. */
const EVENT_IDS_DAYS = 14;
const IDENTITY_MODES = ["steam", "mixed"] as const;

export type GcsBridgeDeps = {
  db: PrismaClient;
  kv: GcsKv;
  bus: GcsEventBus;
  settings: GcsSettingsService;
  permissions: GcsPermissionService;
  acp: GcsAcpRoleService;
  apps: GcsAppService;
  attachments: GcsAttachmentService;
  rateLimiter: GcsRateLimiter;
  realtime: GcsRealtime;
  /** Documentul editorului → JSON validat + HTML sanitizat (ca postările); cu `actor`, și mențiunile de grup. */
  render: (content: unknown, ctx?: { actor?: GcsActor; cooldown?: boolean }) => Promise<GcsRendered>;
  /** Pornește pauza dintre mențiunile de grup după salvare. */
  markGroupMentions?: (actor: GcsActor, rendered: GcsRendered) => Promise<void>;
  canViewServer: (actor: GcsActor, id: number) => Promise<boolean>;
  visibleServers: (actor: GcsActor) => Promise<number[]>;
  now?: () => number;
  /** Doar pentru teste: descărcarea imaginilor hărților. */
  fetchMapImage?: (url: string) => Promise<GcsFetchedFile>;
  /** Interogarea serverelor (verificarea înrolărilor); implicit cea a aplicației. */
  query?: GcsServerQueryFn;
  /** Excepția operatorului pentru interogări (`GCS_SERVERS_ALLOW_NETS`). */
  allow?: () => BlockList | null;
  /** Crearea unui server în aplicația Servere (aprobarea unei înrolări): `GcsServerService.save`. */
  createServer: (actor: GcsActor, input: { game: string; host: string; port: number; name: string }) => Promise<{ id: number }>;
  /** Adresa publică a site-ului (config-ul din pachetele pluginului). */
  siteUrl: () => Promise<string>;
  /** Folderul release-ului pluginurilor (binarele și `manifest.json`). */
  pluginReleaseDir: () => string;
  /** Store-ul platformei: demo-urile meciurilor (private) și bucățile încărcărilor (specul servere-hltv §6). */
  files: GcsFileStore;
  /** Coada de joburi (aducerea demo-urilor la finalul meciului, rcon-ul HLTV); fără ea, doar joburile periodice. */
  jobs?: Pick<GcsJobQueue, "enqueue">;
  /** Doar pentru teste: conectarea la sursele demo-urilor, garda adreselor și folderul temporar. */
  demoConnect?: GcsDemoConnect;
  demoGuard?: () => GcsDemoGuardOptions;
  demoTmpDir?: () => string;
};

/** Coloanele modulelor opționale din `game_servers` (specul plugin-v2 §1.2). */
const FEATURE_COLUMNS = ["manageAdmins", "enforceSanctions", "manageVip", "mixReady", "adminCommands"] as const;

/** Configurarea punții unui server din ACP; modulele lipsă rămân neschimbate. */
export type GcsBridgeConfigInput = {
  identityMode: string;
  nameIds: boolean;
  isMix: boolean;
  manageAdmins?: boolean;
  enforceSanctions?: boolean;
  manageVip?: boolean;
  mixReady?: boolean;
  adminCommands?: boolean;
};

/** Starea punții unui server în ACP (Gaming → Servere → un server → Plugin și chei API). */
export type GcsBridgeStatus = {
  server: {
    id: number;
    name: string;
    game: string;
    identityMode: string;
    nameIds: boolean;
    isMix: boolean;
    bridgeSeenAt: string | null;
    bridgePlugin: string | null;
    host: string;
    port: number;
  };
  /** Modulele opționale pornite pe site (specul plugin-v2 §1.2); implicit toate oprite (colectorul). */
  features: GcsBridgeFeatures;
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
  /** Înrolările automate ale serverelor necunoscute (specul plugin-v2 §5). */
  readonly enrollments: GcsBridgeEnrollments;
  /** Pachetele pluginului descărcate din ACP (pe server, cu o cheie nouă, și general). */
  readonly packages: GcsBridgePackages;
  readonly presence: GcsBridgePresence;
  readonly tickets: GcsBridgeTickets;
  readonly queries: GcsBridgeQueries;
  /** Furnizorul statisticilor de joc ale membrilor (înregistrat în `GcsServerService.playerStats`). */
  readonly stats: GcsBridgeStatsProvider;
  /** HLTV / GOTV pe server: setările, testul, rcon-ul, adresa „Urmărește live” (specul servere-hltv). */
  readonly tv: GcsBridgeTv;
  /** Demo-urile meciurilor mix: aducerea, încărcarea pluginului, stocarea, descărcarea, curățenia. */
  readonly demos: GcsBridgeDemos;

  constructor(private readonly deps: GcsBridgeDeps) {
    const { db, kv, bus, settings, permissions, acp, apps, attachments, rateLimiter, realtime, now } = deps;
    this.store = new GcsBridgeStore(kv);
    const store = this.store;
    this.keys = new GcsBridgeKeys({ db, acp, now });
    this.players = new GcsBridgePlayers({ db, bus, permissions, store, now });
    this.admins = new GcsBridgeAdmins({ db, acp, store, now });
    this.vip = new GcsBridgeVip({ db, acp, store, now });
    this.sanctions = new GcsBridgeSanctions({ db, bus, permissions, settings, attachments, admins: this.admins, now });
    this.matches = new GcsBridgeMatches({ db, settings, store, realtime, now });
    this.maps = new GcsBridgeMaps({ db, acp, attachments, settings, now, ...(deps.fetchMapImage ? { fetch: deps.fetchMapImage } : {}) });
    this.tv = new GcsBridgeTv({
      db,
      acp,
      rateLimiter,
      store,
      ...(deps.demoConnect ? { connect: deps.demoConnect } : {}),
      ...(deps.demoGuard ? { guard: deps.demoGuard } : {}),
      now,
    });
    this.demos = new GcsBridgeDemos({
      db,
      settings,
      permissions,
      acp,
      apps,
      rateLimiter,
      files: deps.files,
      tv: this.tv,
      canViewServer: deps.canViewServer,
      ...(deps.jobs ? { jobs: deps.jobs } : {}),
      ...(deps.demoTmpDir ? { tmpDir: deps.demoTmpDir } : {}),
      now,
    });
    this.events = new GcsBridgeEvents({ db, players: this.players, admins: this.admins, sanctions: this.sanctions, matches: this.matches, maps: this.maps, store, demos: this.demos, now });
    this.enrollments = new GcsBridgeEnrollments({
      db,
      apps,
      settings,
      acp,
      rateLimiter,
      store,
      keys: this.keys,
      query: deps.query ?? queryGameServer,
      allow: deps.allow ?? serversAllowNets,
      createServer: deps.createServer,
      now,
    });
    this.packages = new GcsBridgePackages({ db, acp, rateLimiter, keys: this.keys, releaseDir: deps.pluginReleaseDir, siteUrl: deps.siteUrl, now });
    this.api = new GcsBridgeApi({
      db,
      apps,
      settings,
      rateLimiter,
      store,
      keys: this.keys,
      players: this.players,
      admins: this.admins,
      vip: this.vip,
      sanctions: this.sanctions,
      events: this.events,
      matches: this.matches,
      maps: this.maps,
      enrollments: this.enrollments,
      demos: this.demos,
      now,
    });
    this.presence = new GcsBridgePresence({ db, permissions, settings, apps, store, now });
    this.tickets = new GcsBridgeTickets({
      db,
      bus,
      permissions,
      admins: this.admins,
      sanctions: this.sanctions,
      render: deps.render,
      ...(deps.markGroupMentions ? { markGroupMentions: deps.markGroupMentions } : {}),
      now,
    });
    this.queries = new GcsBridgeQueries({ db, apps, permissions, store, players: this.players, sanctions: this.sanctions, presence: this.presence, canViewServer: deps.canViewServer, visibleServers: deps.visibleServers, tv: this.tv });
    this.stats = new GcsBridgeStatsProvider({ db });
  }

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  /** Ascultătorii: VIP-ul schimbă listele; un șablon (sau mod) de hărți schimbat reîncearcă hărțile fără imagine. */
  listen(bus: GcsEventBus): void {
    this.vip.listen(bus);
    bus.on("settings.updated", async (e) => {
      for (const game of BRIDGE_GAMES) {
        if (e.payload.key === mapTemplateSetting(game) || e.payload.key === mapModeSetting(game)) await this.maps.resetFetches(game);
      }
    });
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: BRIDGE_JOBS.sweep, everyMs: 5 * MIN, handler: async () => void (await this.sweep()) });
    jobs.register({ name: BRIDGE_JOBS.ranks, everyMs: 10 * MIN, handler: async () => void (await this.ranks()) });
    jobs.register({ name: BRIDGE_JOBS.steam, everyMs: 10 * MIN, handler: async () => void (await this.players.reconcileSteam()) });
    jobs.register({ name: BRIDGE_JOBS.maps, everyMs: 10 * MIN, handler: async () => void (await this.maps.fetchDue()) });
    // Demo-urile meciurilor mix (specul servere-hltv §6): la 2 minute + programat la finalul meciului.
    jobs.register({ name: DEMO_JOBS.fetch, everyMs: 2 * MIN, handler: async (data) => void (await this.demos.fetchDue(typeof data.matchId === "number" ? { matchId: data.matchId } : {})) });
    jobs.register({ name: DEMO_JOBS.ingest, handler: async (data) => void (typeof data.demoId === "number" ? await this.demos.ingest(data.demoId) : undefined) });
    jobs.register({ name: DEMO_JOBS.cleanup, everyMs: 60 * MIN, handler: async () => void (await this.demos.cleanup()) });
    jobs.register({
      name: DEMO_JOBS.rcon,
      handler: async (data) => {
        if (typeof data.serverId !== "number" || typeof data.matchId !== "number" || (data.action !== "record" && data.action !== "stop")) return;
        await this.tv.rcon(data.serverId, data.action, data.matchId);
      },
    });
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
  async sweep(): Promise<{ sessions: number; admins: number; codes: number; events: number; old: number; enrollments: number }> {
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
    const enrollments = await this.enrollments.sweep();
    return { sessions, admins, codes, events, old: oldSessions + oldActions, enrollments };
  }

  /** Starea punții unui server (ACP). */
  async status(actor: GcsActor, serverId: number): Promise<GcsBridgeStatus | null> {
    const { db, acp, settings } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const row = await db.gameServer.findUnique({
      where: { id: serverId },
      select: { ...BRIDGE_SERVER_SELECT, bridgeSeenAt: true, bridgePlugin: true, host: true, port: true },
    });
    if (!row) return null;
    const { manageAdmins, enforceSanctions, manageVip, mixReady, adminCommands, enabled: _enabled, ...server } = row;
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
      features: bridgeFeatures({ manageAdmins, enforceSanctions, manageVip, mixReady, adminCommands }),
      connected: server.bridgeSeenAt !== null && now.getTime() - server.bridgeSeenAt.getTime() <= 2 * heartbeat * 1000 + 15_000,
      roster,
      match,
      keys,
      vip,
      counts: { sessionsOpen, players, activeSanctions, matches },
    };
  }

  /** Doar modulele opționale ale pluginului (specul plugin-v2 §1.2); restul configurației rămâne cum e. */
  async saveFeatures(actor: GcsActor, serverId: number, input: Pick<GcsBridgeConfigInput, "manageAdmins" | "enforceSanctions" | "manageVip" | "mixReady" | "adminCommands">): Promise<void> {
    await this.deps.acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const current = await this.deps.db.gameServer.findUnique({ where: { id: serverId }, select: { identityMode: true, nameIds: true, isMix: true } });
    if (!current) throw new GcsNotFound();
    await this.saveConfig(actor, serverId, { ...current, ...input });
  }

  /**
   * Modul identităților (`steam` / `mixed`), identitățile pe nume, serverul de meciuri mix (§15.3) și modulele opționale
   * ale pluginului (specul plugin-v2 §1.2; lipsă = neschimbat). Pluginul le primește la următorul heartbeat.
   */
  async saveConfig(actor: GcsActor, serverId: number, input: GcsBridgeConfigInput): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    if (!(IDENTITY_MODES as readonly string[]).includes(input.identityMode)) throw new GcsValidationError({ identityMode: "invalid" });
    const before = await db.gameServer.findUnique({
      where: { id: serverId },
      select: { identityMode: true, nameIds: true, isMix: true, manageAdmins: true, enforceSanctions: true, manageVip: true, mixReady: true, adminCommands: true },
    });
    if (!before) throw new GcsNotFound();
    const flag = (key: (typeof FEATURE_COLUMNS)[number]) => (typeof input[key] === "boolean" ? input[key] : before[key]);
    const after = {
      identityMode: input.identityMode,
      nameIds: input.nameIds === true,
      isMix: input.isMix === true,
      ...Object.fromEntries(FEATURE_COLUMNS.map((k) => [k, flag(k)])),
    };
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
export { GCS_ADMIN_FLAGS, FLAG_CSS, normalizeFlags, cssPermissions, isPowerAdmin, POWER_FLAGS, reportedAdminFlags } from "./flags";
export { generateAdminPassword, ADMIN_PASSWORD_MIN, type GcsServerAdminInput, type GcsServerAdminRow, type GcsAdminPresetView } from "./admins";
export type { GcsMapRow, GcsMapImage, GcsMapImageKind, GcsMapImageConfig } from "./maps";
export { DEFAULT_MAP_IMAGE_MODE, MAP_IMAGE_MODES, MAP_TEMPLATE_MAX, isMapImageMode, mapImageOrigins, mapImageRoute, mapTemplateError, mapTemplateOrigin, mapTemplateUrl, type GcsMapImageMode } from "./mapImages";
export { BRIDGE_GAMES, mapModeSetting, mapTemplateSetting } from "./config";
export { MAP_UPLOAD_MAX_FILES, MAP_IMAGE_MAX_BYTES, mapArtUrl } from "./maps";
export type { GcsAdminPresence, GcsOnlineAdmin } from "./presence";
export type { GcsSanctionInput, GcsSanctionUpdate, GcsSanctionView } from "./sanctions";
export type { GcsTicketInput, GcsTicketView, GcsTicketSummary, GcsTicketMessageView } from "./tickets";
export { TICKET_TITLE_MAX, TICKET_TITLE_MIN } from "./tickets";
export type { GcsPlayerProfile, GcsMatchDetails, GcsMatchSummary, GcsMatchFilter, GcsMatchStats, GcsMatchStatusFilter, GcsUserGameCard, GcsUserServerStat, GcsPlayerHit, GcsStatTotals, GcsIdentityView } from "./queries";
export type { GcsPlayerView } from "./players";
export { LINK_CODE_TTL_MS } from "./players";
export { matchRoom, MATCH_STATE_EVENT, SERVER_MATCH_EVENT } from "./matches";
export { ticketHref } from "./notify";
export { SANCTION_EVIDENCE_MAX_BYTES, SANCTION_REASON_MAX } from "./sanctions";
export type { GcsLiveMatch } from "./matches";
export type { GcsRoster } from "./store";
export type { GcsBridgeKeyRow } from "./keys";
export type { GcsEnrollmentView, GcsEnrollCheck, GcsEnrollCheckResult } from "./enroll";
export { ENROLL_TTL_DAYS, MAX_PENDING, MAX_PENDING_PER_IP } from "./enroll";
export type { GcsBridgeFeatures } from "./types";
export type { GcsPluginDownload, GcsPluginGame, GcsReleaseManifest, GcsPackageVariant } from "./package";
export { buildPluginPackage, readPluginRelease, installNote, RELEASE_FILES } from "./package";
export type { GcsVipMappingView } from "./vip";
export type { GcsServerTvView, GcsServerTvInput, GcsTvWatch, GcsTvTestResult } from "./tv";
export type { GcsDemoFile, GcsDemoStaffRow, GcsMatchDemos, GcsOpenedDemo } from "./demos/service";
export { DEMO_JOBS, DEMO_CHUNK_SIZE, DEMO_CHUNK_MAX, DEMO_UPLOAD_RATE } from "./demos/service";
export { DEMO_SOURCES, TV_DELAY_MAX, steamConnectUrl, type GcsDemoSource } from "./demos/settings";
export { bridgeBodyLimit } from "./api";
