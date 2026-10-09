import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GcsAcpDashboardService,
  GcsAcpRoleService,
  GcsAcpSearch,
  GcsActorResolver,
  GcsAttachmentService,
  GcsBanService,
  GcsCache,
  GcsContentRenderer,
  GcsEventBus,
  GcsFollowService,
  GcsGroupMentionService,
  GcsGroupService,
  GcsJobQueue,
  GcsLocalFileStore,
  GcsMemberDirectory,
  GcsAppService,
  GcsNavService,
  GcsNotificationService,
  GcsTranslationService,
  GcsWidgetService,
  GcsThemeService,
  GcsThemeCssService,
  GcsTemplateService,
  GcsStatsService,
  GcsPresenceService,
  GcsRealtime,
  GcsPermissionService,
  GcsReactionService,
  GcsRedisRateLimiter,
  GcsReportService,
  GcsS3FileStore,
  GcsSettingsService,
  GcsWarningService,
  GcsMemberAppearanceService,
  GcsPluginDatabase,
  GcsPluginMediaService,
  GcsPluginService,
  sendEmail,
  trustedPluginKeys,
  renderTemplate,
  GcsMemberRemovalService,
  accountDataHandler,
  fileDataHandler,
  followDataHandler,
  notificationDataHandler,
  reactionDataHandler,
  type GcsFileStore,
  type GcsMailer,
  type GcsModule,
  type GcsModuleRegistry,
} from "@gcs/core";
import { forumMemberData } from "./forums/memberData";
import { profileMemberData } from "./profile/memberData";
import { messageMemberData } from "./messages/memberData";
import { chatMemberData } from "./chat/memberData";
import { vipMemberData } from "./vip/memberData";
import { clanMemberData } from "./clans/memberData";
import { serverMemberData } from "./servers/bridge/memberData";
import { importerMemberData } from "./importer/memberData";
import { PrismaClient } from "@gcs/db";
import { templateComponents, withEmailLayout } from "./templates/components";
import { isGcsIcon, resolveIcon } from "@gcs/ui/icon-registry";
import Redis from "ioredis";
import { registerForumContent } from "./forums/content";
import { GcsForumModerationService } from "./forums/moderation";
import { GcsForumModeratorService } from "./forums/moderators";
import { GcsForumPosting } from "./forums/posting";
import { GcsPollService } from "./forums/polls";
import { GcsPostService } from "./forums/posts";
import { GcsPrefixService } from "./forums/prefixes";
import { GcsForumQueries } from "./forums/queries";
import { GcsReadMarkerService } from "./forums/readMarkers";
import { GcsForumSearch } from "./forums/search";
import { GcsForumService } from "./forums/forums";
import { GcsTopicService } from "./forums/topics";
import { registerAppJobs } from "./jobs";
import { GcsAchievementService } from "./profile/achievements";
import { GcsAchievementAdmin } from "./profile/achievementsAdmin";
import { GcsCosmeticsService } from "./profile/cosmetics";
import { GcsRankDirectory } from "./profile/display";
import { GcsProfileFieldAdmin } from "./profile/fieldsAdmin";
import { GcsMembership } from "./profile/membership";
import { GcsProfileService } from "./profile/profile";
import { GcsPromotionService } from "./profile/promotions";
import { GcsProfileQueries } from "./profile/queries";
import { GcsSocialService } from "./profile/social";
import { GcsChatService } from "./chat/chat";
import { GcsChatQueries } from "./chat/queries";
import { renderChatText } from "./chat/text";
import { canViewPost } from "./forums/content";
import { GcsNotificationProducers } from "./notifications/producers";
import { registerLiveEvents } from "./realtime/live";
import { GcsRealtimeRooms } from "./realtime/rooms";
import { createRegistry } from "./registry";
import { GcsVipService } from "./vip/vip";
import { GcsConversationService } from "./messages/conversations";
import { GcsConversationQueries } from "./messages/queries";
import { GcsMemberList } from "./profile/members";
import { GcsMentionQueries } from "./profile/mentions";
import { GcsPostbitService } from "./profile/postbit";
import { registerChatNotifications } from "./chat/notify";
import { GcsPluginPublicApi } from "./plugins/api";
import { GcsPluginHost } from "./plugins/host";
import { RENDER_LABELS } from "./forums/labels";
import { GcsImportService } from "./importer/service";
import { GcsPortingService } from "./porting/service";
import { GcsActivityStream } from "./community/activity";
import { GcsLeaderboard } from "./community/leaderboard";
import { GcsVipPublic } from "./vip/public";
import { GcsServerPoller } from "./servers/poller";
import { GcsServerQueries } from "./servers/queries";
import { GcsServerService, SERVER_BANNER } from "./servers/service";
import { GcsServerStatusStore } from "./servers/store";
import { GcsBridge } from "./servers/bridge";
import { MAP_IMAGE, SANCTION_EVIDENCE } from "./servers/bridge/config";
import { registerBridgeNotifications } from "./servers/bridge/notify";
import { GcsClanAdmin } from "./clans/admin";
import type { GcsClanGameStatsSource } from "./clans/gameStats";
import { registerClanNotifications } from "./clans/notify";
import { GcsClanQueries } from "./clans/queries";
import { CLAN_BANNER, CLAN_LOGO, GcsClanService } from "./clans/service";

export type GcsServices = {
  db: PrismaClient;
  redis: Redis;
  cache: GcsCache;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  jobs: GcsJobQueue;
  settings: GcsSettingsService;
  permissions: GcsPermissionService;
  acp: GcsAcpRoleService;
  acpDashboard: GcsAcpDashboardService;
  acpSearch: GcsAcpSearch;
  groups: GcsGroupService;
  /** Mențiunile de grup (Mențiuni v2): setările grupurilor, cine poate menționa ce grup, pauza dintre mențiuni. */
  groupMentions: GcsGroupMentionService;
  members: GcsMemberDirectory;
  notifications: GcsNotificationService;
  realtime: GcsRealtime;
  presence: GcsPresenceService;
  realtimeRooms: GcsRealtimeRooms;
  notificationProducers: GcsNotificationProducers;
  chat: GcsChatService;
  apps: GcsAppService;
  translation: GcsTranslationService;
  widgets: GcsWidgetService;
  nav: GcsNavService;
  themes: GcsThemeService;
  /** Fișierele CSS ale temelor (ACP → Aspect → CSS). */
  themeCss: GcsThemeCssService;
  /** Șabloanele editabile (ACP → Aspect → Șabloane). */
  templates: GcsTemplateService;
  stats: GcsStatsService;
  postbit: GcsPostbitService;
  memberList: GcsMemberList;
  /** Sugestiile @mențiunilor (membri și grupuri) și cardul unui grup menționat (Mențiuni v2). */
  mentionQueries: GcsMentionQueries;
  chatQueries: GcsChatQueries;
  bans: GcsBanService;
  warnings: GcsWarningService;
  actors: GcsActorResolver;
  rateLimiter: GcsRedisRateLimiter;
  files: GcsFileStore;
  attachments: GcsAttachmentService;
  forums: GcsForumService;
  topics: GcsTopicService;
  posts: GcsPostService;
  forumQueries: GcsForumQueries;
  readMarkers: GcsReadMarkerService;
  follows: GcsFollowService;
  reactions: GcsReactionService;
  polls: GcsPollService;
  prefixes: GcsPrefixService;
  reports: GcsReportService;
  moderation: GcsForumModerationService;
  search: GcsForumSearch;
  posting: GcsForumPosting;
  forumModerators: GcsForumModeratorService;
  mailer: GcsMailer;
  profiles: GcsProfileService;
  profileFields: GcsProfileFieldAdmin;
  social: GcsSocialService;
  achievements: GcsAchievementService;
  achievementAdmin: GcsAchievementAdmin;
  membership: GcsMembership;
  promotions: GcsPromotionService;
  cosmetics: GcsCosmeticsService;
  vip: GcsVipService;
  ranks: GcsRankDirectory;
  profileQueries: GcsProfileQueries;
  conversations: GcsConversationService;
  conversationQueries: GcsConversationQueries;
  /** Pluginurile încărcate în acest proces (hook-uri, widget-uri, pagini…), etapa 6. */
  plugins: GcsPluginHost;
  /** Ciclul de viață al pluginurilor (ACP → Sistem → Aplicații și pluginuri). */
  pluginAdmin: GcsPluginService;
  /** Aspectul membrilor publicat de pluginuri (numele, rama, banner-ul, profilul), Studio VIP. */
  appearance: GcsMemberAppearanceService;
  /** Fișierele media ale pluginurilor (capabilitatea media). */
  pluginMedia: GcsPluginMediaService;
  /** Importul din altă platformă (ACP → Sistem → Conversii) și redirecturile 301. */
  importer: GcsImportService;
  /** Asistentul de portare a pluginurilor (ACP → Sistem → Conversii → Portare plugin). */
  porting: GcsPortingService;
  /** Fluxul de activitate (`/activity`). */
  activity: GcsActivityStream;
  /** Clasamentul (`/leaderboard`). */
  leaderboard: GcsLeaderboard;
  /** Pagina publică a planurilor VIP (`/vip`). */
  vipPublic: GcsVipPublic;
  /** Serverele de joc din ACP (Gaming → Servere): adăugare, editare, ordine, „Testează”. */
  servers: GcsServerService;
  /** Citirile publice ale serverelor (`/servers`, widget-ul, statusurile live). */
  serverQueries: GcsServerQueries;
  /** Interogarea periodică a serverelor (rulează în `gcs-worker`). */
  serverPoller: GcsServerPoller;
  /**
   * Puntea cu serverele de joc (specul 2026-10-08-servere-bridge): protocolul pluginurilor, cheile, identitățile,
   * adminii, sancțiunile, statisticile, meciurile mix, contestațiile, hărțile și joburile lor.
   */
  bridge: GcsBridge;
  /** Clanurile (etapa Gaming): crearea, intrarea, rolurile, forumul privat, moderarea staff-ului, joburile. */
  clans: GcsClanService;
  /** Citirile publice ale clanurilor (`/clans`, pagina clanului, tagurile, widget-ul). */
  clanQueries: GcsClanQueries;
  /** ACP → Gaming → Clanuri: lista, fișa și opțiunile. */
  clanAdmin: GcsClanAdmin;
  /**
   * Ștergerea și unirea conturilor (specul 2026-10-09-stergere-unire-membri): ACP → Membri, cererea membrului din Setări →
   * Cont, jobul și pașii aplicațiilor (fiecare își tratează datele în `memberData.ts`).
   */
  memberRemoval: GcsMemberRemovalService;
};

/** Golește cache-ul Redis al paginilor (cheile și seturile de tag-uri `gcs:k:*`, `gcs:tag:*`), fără cozi și limite. */
async function clearPageCache(redis: Redis): Promise<void> {
  for (const pattern of ["gcs:k:*", "gcs:tag:*"]) {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  }
}

export type GcsServicesOptions = {
  /** Folderul de configurare (`GCS_CONFIG_DIR`): `.env.runtime`, fișierele locale. */
  configDir: string;
  /** În Next.js: `revalidateTag`. În worker: nimic (paginile citesc prin cache-ul Redis, invalidat de bus). */
  revalidate?: (tag: string) => void;
  /** Module în plus (ex. modulul de test al E2E). */
  extraModules?: GcsModule[];
};

/**
 * Variabilele scrise de installer în `.env.runtime` (ex. `DATABASE_URL` pentru o bază externă aleasă în wizard)
 * au prioritate față de mediul procesului.
 */
export function loadRuntimeEnv(configDir: string): void {
  let content: string;
  try {
    content = readFileSync(path.join(configDir, ".env.runtime"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = /^(DATABASE_URL|GCS_SECRET)=(.*)$/.exec(line);
    if (m) process.env[m[1]!] = m[2]!.startsWith('"') ? (JSON.parse(m[2]!) as string) : m[2]!;
  }
}

/** O iconiță Font Awesome ca SVG inline (pentru `<gcs-icon>` din HTML-ul pluginurilor), ca `GcsIconSvg`. */
function iconSvg(name: string): string | null {
  const def = resolveIcon(name);
  if (!def) return null;
  const [width, height, , , path] = def.icon;
  const paths = (Array.isArray(path) ? path : [path]).map((d) => `<path d="${d}"/>`).join("");
  return `<svg class="gcs-icon" viewBox="0 0 ${width} ${height}" width="1em" height="1em" fill="currentColor" focusable="false" aria-hidden="true" data-icon="${def.prefix}-${def.iconName}">${paths}</svg>`;
}

/** Host-ul public: din setarea `site.url`, altfel din `GCS_BASE_URL` (embed-urile Twitch îl cer). */
function siteHost(siteUrl: string): string {
  const url = siteUrl || process.env.GCS_BASE_URL || "http://localhost";
  return URL.canParse(url) ? new URL(url).host : "localhost";
}

/** Lista Redis în care ajung emailurile când rulează E2E (`GCS_TEST_ROUTES=1`), în loc de SMTP. */
export const TEST_OUTBOX_KEY = "gcs:test:outbox";
/** Cheia internă (în `settings`) a recordului de utilizatori online. */
export const PRESENCE_RECORD_SETTING = "presence.record";

/** Adresa publică a site-ului: setarea `site.url`, altfel `GCS_BASE_URL`. */
function baseUrl(siteUrl: string): string {
  return siteUrl || process.env.GCS_BASE_URL || "http://localhost:3000";
}

/** MinIO (S3) dacă e configurat (`docker compose`); altfel un folder local, în folderul de configurare (dev, E2E). */
function createFileStore(configDir: string): GcsFileStore {
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) {
    return new GcsS3FileStore({
      endpoint,
      accessKey: process.env.S3_ACCESS_KEY ?? "",
      secretKey: process.env.S3_SECRET_KEY ?? "",
      bucket: process.env.S3_BUCKET ?? "redline",
    });
  }
  return new GcsLocalFileStore(path.join(configDir, "files"));
}

/**
 * Toate serviciile aplicației, legate între ele. Aceeași fabrică pentru `web` și pentru `gcs-worker`,
 * ca joburile să ruleze exact aceeași logică (și aceleași evenimente) ca Server Actions.
 */
export function createGcsServices(opts: GcsServicesOptions): GcsServices {
  loadRuntimeEnv(opts.configDir);
  const databaseUrl = process.env.DATABASE_URL;
  const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : new PrismaClient();
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  // Erorile de conexiune sunt raportate de /api/health; nu trebuie să oprească procesul.
  redis.on("error", () => {});

  const registry = createRegistry(opts.extraModules);
  const cache = new GcsCache(redis);
  const bus = new GcsEventBus({ cache, ...(opts.revalidate ? { revalidate: opts.revalidate } : {}) });
  for (const m of registry.all()) {
    for (const listener of m.eventListeners) bus.on(listener.event, listener.handler);
  }
  const jobs = new GcsJobQueue({ redisUrl });

  const settings = new GcsSettingsService({ db, cache, bus, registry });
  const permissions = new GcsPermissionService({ db, cache, bus, registry });
  const acp = new GcsAcpRoleService({ db, registry });
  const acpSearch = new GcsAcpSearch({ db, registry, acp });
  const groups = new GcsGroupService({ db, bus, permissions, acp });
  const groupMentions = new GcsGroupMentionService({ db, cache, redis });
  const apps = new GcsAppService({ db, cache, bus, registry, acp, permissions, settings });
  const members = new GcsMemberDirectory({ db });
  const notifications = new GcsNotificationService({ db, bus, cache, registry });
  const bans = new GcsBanService({ db, cache, bus, acp });
  const warnings = new GcsWarningService({ db, bus, acp, bans });
  const realtime = new GcsRealtime(redis);
  // Recordul de prezență se păstrează și în baza de date (cheie internă, nu apare în ACP), ca să supraviețuiască Redis-ului.
  const presence = new GcsPresenceService({
    redis,
    // Scrierile concurente nu pot coborî recordul: se actualizează doar dacă numărul e mai mare.
    persistRecord: async (r) => {
      const value = JSON.stringify({ count: r.count, at: r.at.toISOString() });
      await db.$executeRaw`
        INSERT INTO settings (key, value, "updatedAt") VALUES (${PRESENCE_RECORD_SETTING}, ${value}::jsonb, ${r.at.toISOString()}::timestamp)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt"
        WHERE COALESCE((settings.value->>'count')::int, 0) < (EXCLUDED.value->>'count')::int`;
    },
    loadRecord: async () => {
      const row = await db.setting.findUnique({ where: { key: PRESENCE_RECORD_SETTING } });
      const v = row?.value as { count?: number; at?: string } | undefined;
      return v?.count && v.at ? { count: v.count, at: new Date(v.at) } : null;
    },
  });
  const actors = new GcsActorResolver({ db, cache, presence });
  const acpDashboard = new GcsAcpDashboardService({ db, acp, presence, cache });
  const rateLimiter = new GcsRedisRateLimiter(redis);
  const files = createFileStore(opts.configDir);
  const attachments = new GcsAttachmentService({ db, store: files, permissions, rateLimiter });
  // Logo-ul și favicon-ul temelor sunt publice (etapa 5).
  attachments.registerAccess("theme.logo", async () => true);
  attachments.registerAccess("theme.favicon", async () => true);
  const forums = new GcsForumService({ db, bus, permissions, acp, registry });
  const readMarkers = new GcsReadMarkerService({ db, settings });
  const follows = new GcsFollowService({ db });
  // Gazda pluginurilor se creează după serviciile pe care le folosește; filtrele de conținut o apelează la rulare.
  const pluginRef: { host?: GcsPluginHost } = {};
  const posting = new GcsForumPosting({
    db,
    bus,
    permissions,
    settings,
    rateLimiter,
    renderer: new GcsContentRenderer(),
    attachments,
    siteHost: async () => siteHost(await settings.get<string>("site.url")),
    contentFilter: (data, actor) => pluginRef.host!.filterPost(data, actor),
    groupMentions,
  });
  const polls = new GcsPollService(posting);
  const prefixes = new GcsPrefixService({ db, bus, acp });
  const reactions = new GcsReactionService({ db, bus, cache, acp });
  const reports = new GcsReportService({ db, bus, rateLimiter });
  const posts = new GcsPostService(posting);
  const ranks = new GcsRankDirectory({ db, cache });
  registerForumContent(posting, { reactions, attachments, reports, posts });
  const templates = new GcsTemplateService({ db, cache, bus, acp });
  // Emailurile trec prin șablonul `email.layout` al temei implicite, dacă a fost modificat.
  const rawMailer: GcsMailer =
    process.env.GCS_TEST_ROUTES === "1"
      ? async (mail) => {
          await redis.lpush(TEST_OUTBOX_KEY, JSON.stringify(mail));
          await redis.ltrim(TEST_OUTBOX_KEY, 0, 49);
        }
      : (mail) => sendEmail(mail, settings);
  const mailer = withEmailLayout(rawMailer, { db, templates, settings });
  const profiles = new GcsProfileService({
    db,
    bus,
    permissions,
    settings,
    attachments,
    rateLimiter,
    mailer,
    baseUrl: async () => baseUrl(await settings.get<string>("site.url")),
  });
  const social = new GcsSocialService({ db, bus, cache, permissions, settings, rateLimiter, profiles, render: (content) => posting.render(content) });
  social.registerContent({ reactions, reports });
  const achievements = new GcsAchievementService({ db, bus, acp, jobs });
  achievements.listen(bus);
  const membership = new GcsMembership({ bus, permissions });
  const promotions = new GcsPromotionService({ db, bus, acp, membership });
  achievements.onEvaluated(async (userId) => void (await promotions.evaluateUser(userId)));
  achievements.onDaily((now) => promotions.dailySweep(now));
  const cosmetics = new GcsCosmeticsService({ db, bus, cache, permissions, acp, attachments, redis });
  cosmetics.listen(bus);
  const conversations = new GcsConversationService({
    db,
    bus,
    cache,
    permissions,
    settings,
    rateLimiter,
    attachments,
    profiles,
    social,
    render: (content, ctx) => posting.render(content, ctx),
    markGroupMentions: (actor, rendered) => posting.markGroupMentions(actor, rendered),
  });
  conversations.registerContent({ reports });
  const vip = new GcsVipService({ db, bus, permissions, settings, membership });

  const profileQueries = new GcsProfileQueries({ db, cache, permissions, profiles, social, ranks });
  const forumQueries = new GcsForumQueries({ db, cache, permissions, settings, readMarkers, follows, reactions, polls, ranks });
  const notificationProducers = new GcsNotificationProducers({
    db,
    redis,
    notifications,
    actors,
    posting,
    forumQueries,
    conversations,
    settings,
    mailer,
    realtime,
    jobs,
    baseUrl: async () => baseUrl(await settings.get<string>("site.url")),
    groupMentions,
  });
  notificationProducers.registerTargets();
  notificationProducers.listen(bus);
  const chat = new GcsChatService({ db, bus, permissions, settings, rateLimiter, realtime, acp, attachments });
  const chatQueries = new GcsChatQueries({ db, permissions });
  const realtimeRooms = new GcsRealtimeRooms({ permissions, forumQueries });
  realtimeRooms.register("chat", (actor, key) => chatQueries.canRead(actor, key));
  // Aplicația Servere (etapa Gaming): statusul din Redis, citirile publice, ACP-ul și interogarea din worker.
  const serverStore = new GcsServerStatusStore(redis);
  const serverQueries = new GcsServerQueries({ db, cache, permissions, settings, apps, store: serverStore });
  realtimeRooms.register("servers", (actor, id) => serverQueries.canJoin(actor, id));
  // Bannerul unui server se vede doar de cine vede serverul.
  attachments.registerAccess(SERVER_BANNER, (actor, id) => serverQueries.canView(actor, Number(id)));
  // Aplicația Clanuri: serviciul, citirile publice, imaginile (le vede cine vede clanul) și notificările.
  const servers = new GcsServerService({ db, bus, acp, attachments, rateLimiter, store: serverStore });
  // Puntea cu serverele de joc: furnizorul statisticilor (citit de clanuri), imaginile hărților (publice), dovezile
  // sancțiunilor (le vede cine vede sancțiunea), camera live a unui meci mix și notificările tichetelor.
  const bridge = new GcsBridge({
    db,
    redis,
    bus,
    settings,
    permissions,
    acp,
    apps,
    attachments,
    rateLimiter,
    realtime,
    render: (content) => posting.render(content),
    canViewServer: (actor, id) => serverQueries.canView(actor, id),
    visibleServers: (actor) => serverQueries.visibleIds(actor),
    // Aprobarea unei înrolări automate creează serverul prin aplicația Servere (validarea, jurnalul `servers.create`).
    createServer: (actor, input) => servers.save(actor, null, { ...input, queryPort: null, description: "", forumId: null, groups: [], adminIds: [], enabled: true }),
    siteUrl: async () => baseUrl(await settings.get<string>("site.url")),
    // Binarele pluginurilor (pasul de release): în depozit, lângă aplicație (Next.js le include în build-ul standalone).
    pluginReleaseDir: () => process.env.GCS_PLUGIN_RELEASE_DIR ?? path.resolve(process.cwd(), "../../servers-plugins/release"),
    // Demo-urile meciurilor mix: private în store-ul platformei; joburile le aduc și le curăță (specul servere-hltv).
    files,
    jobs,
  });
  bridge.listen(bus);
  servers.playerStats.use(bridge.stats);
  attachments.registerAccess(MAP_IMAGE, async () => true);
  attachments.registerAccess(SANCTION_EVIDENCE, (actor, id) => bridge.sanctions.canView(actor, Number(id)));
  realtimeRooms.register("match", (actor, id) => bridge.queries.canJoinMatch(actor, id));
  // Statisticile de joc ale aplicației Servere, citite de clanuri doar cu aplicația Servere activă (specul clanurilor §15).
  const clanGameStats: GcsClanGameStatsSource = {
    enabled: () => apps.enabled("servers"),
    forUsers: (ids, opts) => servers.playerStats.forUsers(ids, opts),
    linkedUsers: (ids) => servers.playerStats.linkedUsers(ids),
  };
  const clans = new GcsClanService({ db, cache, bus, settings, permissions, acp, apps, actors, attachments, rateLimiter, gameStats: clanGameStats });
  const clanQueries = new GcsClanQueries({ db, cache, permissions, settings, apps, clans, gameStats: clanGameStats });
  attachments.registerAccess(CLAN_LOGO, (actor, id) => clanQueries.canSeeClan(actor, Number(id)));
  attachments.registerAccess(CLAN_BANNER, (actor, id) => clanQueries.canSeeClan(actor, Number(id)));
  registerClanNotifications({ db, bus, notifications, clanQueries, actors });
  registerChatNotifications({ db, bus, notifications, chatQueries, actors });
  registerBridgeNotifications({ db, bus, notifications, tickets: bridge.tickets, actors });
  registerLiveEvents(bus, { db, realtime });

  // Butonul „Traduce” (etapa 5): conținutul membrilor, cu verificarea accesului fiecărui tip.
  const translation = new GcsTranslationService({ db, cache, settings, permissions, rateLimiter });
  translation.registerContent("forums.post", {
    canView: (actor, id) => canViewPost(posting, actor, Number(id)),
    html: async (id) => (await db.post.findUnique({ where: { id: Number(id) }, select: { contentHtml: true } }))?.contentHtml ?? null,
  });
  translation.registerContent("pm.message", {
    canView: (actor, id) => conversations.canViewMessage(actor, Number(id)),
    html: async (id) => (await db.conversationMessage.findUnique({ where: { id: Number(id) }, select: { contentHtml: true } }))?.contentHtml ?? null,
  });
  translation.registerContent("profile.status", {
    canView: (actor, id) => social.canViewStatus(actor, Number(id)),
    html: async (id) => (await db.statusUpdate.findUnique({ where: { id: Number(id) }, select: { contentHtml: true } }))?.contentHtml ?? null,
  });
  translation.registerContent("chat.message", {
    canView: async (actor, id) => {
      const m = await db.chatMessage.findUnique({ where: { id: Number(id) }, select: { deletedAt: true, channel: { select: { key: true } } } });
      return m !== null && m.deletedAt === null && (await chatQueries.canRead(actor, m.channel.key));
    },
    html: async (id) => {
      const m = await db.chatMessage.findUnique({ where: { id: Number(id) }, select: { body: true } });
      return m ? renderChatText(m.body) : null;
    },
  });
  // Pluginurile (etapa 6): ciclul de viață și gazda din acest proces. Gazda pornește doar unde e chemat `start()`
  // (web și `gcs-worker`); în rest doar ascultă evenimentele, fără pluginuri încărcate.
  const pluginDatabase = new GcsPluginDatabase({ databaseUrl });
  const appearance = new GcsMemberAppearanceService({ db, cache, redis, bus });
  const pluginMedia = new GcsPluginMediaService({ db, store: files, rateLimiter });
  const pluginAdmin = new GcsPluginService({
    db,
    acp,
    database: pluginDatabase,
    jobs,
    notify: () => pluginRef.host!.notify(),
    bus,
    permissions,
    trustedKeys: () => trustedPluginKeys().keys,
    unsignedPolicy: () => (process.env.GCS_PLUGINS_UNSIGNED === "deny" ? "deny" : "allow"),
    // Dezinstalarea fără păstrarea datelor: fișierele media (din store) și aspectul publicat de plugin.
    removeData: async (key) => {
      await pluginMedia.deleteAll(key);
      await appearance.clear(key);
    },
  });
  const plugins = new GcsPluginHost({
    db,
    redis,
    bus,
    registry,
    permissions,
    jobs,
    plugins: pluginAdmin,
    database: pluginDatabase,
    api: new GcsPluginPublicApi({ db, forumQueries, posting }),
    appearance,
    media: pluginMedia,
    dataDir: process.env.GCS_PLUGINS_DIR ?? path.join(opts.configDir, "plugins"),
    iconSvg,
    siteLocale: () => settings.get<string>("site.locale"),
    safeMode: process.env.GCS_PLUGINS_SAFE_MODE === "1",
    ...(Number(process.env.GCS_PLUGINS_MAX_FAILURES) > 0 ? { maxFailures: Number(process.env.GCS_PLUGINS_MAX_FAILURES) } : {}),
    subscriber: () => redis.duplicate(),
  });
  pluginRef.host = plugins;
  // `{ template, data }` întors de un plugin: motorul de șabloane (sandbox, limite de timp și iterații); rezultatul trece
  // apoi prin sanitizer-ul pluginurilor.
  plugins.setTemplateRenderer(async (_plugin, template, data) =>
    template.length > 64 * 1024 ? "" : renderTemplate(template, data, { locale: await settings.get<string>("site.locale"), components: templateComponents() }),
  );

  const services: GcsServices = {
    db,
    redis,
    cache,
    bus,
    registry,
    jobs,
    settings,
    permissions,
    acp,
    acpDashboard,
    acpSearch,
    groups,
    groupMentions,
    members,
    notifications,
    realtime,
    presence,
    realtimeRooms,
    notificationProducers,
    chat,
    chatQueries,
    apps,
    translation,
    widgets: new GcsWidgetService({ db, cache, bus, registry, acp, apps }),
    nav: new GcsNavService({ db, cache, bus, registry, acp, apps, isIcon: isGcsIcon }),
    themes: new GcsThemeService({ db, cache, bus, acp }),
    themeCss: new GcsThemeCssService({ db, bus, acp }),
    templates,
    stats: new GcsStatsService({ db, cache, registry, apps }),
    postbit: new GcsPostbitService({ db, cache, permissions, settings }),
    memberList: new GcsMemberList({ db, permissions, ranks }),
    mentionQueries: new GcsMentionQueries({ db, cache, permissions, groupMentions }),
    activity: new GcsActivityStream({ db, cache, permissions, social }),
    leaderboard: new GcsLeaderboard({ db, cache, permissions }),
    // Fără magazin încă: planurile au butonul „Contactează staff-ul” (`checkout` vine odată cu plățile).
    vipPublic: new GcsVipPublic({ db, registry, permissions, settings, vip, checkout: null }),
    bans,
    warnings,
    actors,
    rateLimiter,
    files,
    attachments,
    forums,
    topics: new GcsTopicService(posting, { polls, prefixes }),
    posts,
    forumQueries,
    readMarkers,
    follows,
    reactions,
    polls,
    prefixes,
    reports,
    moderation: new GcsForumModerationService(posting, { posts, reports, acp }),
    search: new GcsForumSearch({ db, permissions, settings, rateLimiter }),
    posting,
    forumModerators: new GcsForumModeratorService({ db, permissions, acp }),
    mailer,
    profiles,
    profileFields: new GcsProfileFieldAdmin({ db, bus, acp }),
    social,
    achievements,
    achievementAdmin: new GcsAchievementAdmin({ db, bus, acp, achievements, jobs, attachments }),
    membership,
    promotions,
    cosmetics,
    vip,
    ranks,
    profileQueries,
    conversations,
    conversationQueries: new GcsConversationQueries({ db, settings, profileQueries }),
    plugins,
    pluginAdmin,
    appearance,
    pluginMedia,
    importer: new GcsImportService({
      db,
      bus,
      registry,
      attachments,
      groups,
      permissions,
      actors,
      cache,
      jobs,
      acp,
      settings,
      renderOptions: async () => {
        const [embeds, locale, url] = await Promise.all([settings.get<string[]>("forums.embeds"), settings.get<string>("site.locale"), settings.get<string>("site.url")]);
        return { embeds, siteHost: siteHost(url), labels: RENDER_LABELS[locale] ?? RENDER_LABELS.ro! };
      },
      clearCache: () => clearPageCache(redis),
    }),
    porting: new GcsPortingService({ db, acp, plugins: pluginAdmin }),
    servers,
    serverQueries,
    serverPoller: new GcsServerPoller({ db, store: serverStore, realtime, cache, settings, apps }),
    bridge,
    clans,
    clanQueries,
    clanAdmin: new GcsClanAdmin({ db, acp, settings, permissions, bus, registry, clans }),
    memberRemoval: createMemberRemoval({ db, bus, acp, settings, jobs, reactions, attachments, posting, achievements, vip, clans, bridge }),
  };
  registerAppJobs(services);
  return services;
}

/**
 * Ștergerea și unirea conturilor, cu pașii în ordine: reacțiile (înaintea mutării conținutului, ca să recunoască reacțiile
 * la propriul conținut), urmăririle, aplicațiile, apoi notificările, datele de cont și fișierele (după conținutul lor).
 */
function createMemberRemoval(d: {
  db: PrismaClient;
  bus: GcsEventBus;
  acp: GcsAcpRoleService;
  settings: GcsSettingsService;
  jobs: GcsJobQueue;
  reactions: GcsReactionService;
  attachments: GcsAttachmentService;
  posting: GcsForumPosting;
  achievements: GcsAchievementService;
  vip: GcsVipService;
  clans: GcsClanService;
  bridge: GcsBridge;
}): GcsMemberRemovalService {
  const removal = new GcsMemberRemovalService({ db: d.db, bus: d.bus, acp: d.acp, settings: d.settings, jobs: d.jobs });
  removal.register(reactionDataHandler({ db: d.db, reactions: d.reactions }));
  removal.register(followDataHandler({ db: d.db }));
  removal.register(forumMemberData(d.posting));
  removal.register(profileMemberData({ db: d.db, evaluate: (userId) => d.achievements.evaluate(userId) }));
  removal.register(messageMemberData({ db: d.db, attachments: d.attachments }));
  removal.register(chatMemberData({ db: d.db, attachments: d.attachments }));
  removal.register(vipMemberData({ db: d.db, vip: d.vip }));
  removal.register(clanMemberData({ db: d.db, clans: d.clans }));
  removal.register(serverMemberData({ db: d.db, store: d.bridge.store, players: d.bridge.players }));
  removal.register(importerMemberData({ db: d.db }));
  removal.register(notificationDataHandler({ db: d.db }));
  removal.register(accountDataHandler({ db: d.db }));
  removal.register(fileDataHandler({ db: d.db, attachments: d.attachments }));
  return removal;
}

/** Închide conexiunile (oprirea worker-ului, resetarea după instalare). */
export async function closeGcsServices(s: GcsServices): Promise<void> {
  await s.plugins.stop().catch(() => {});
  await s.jobs.close().catch(() => {});
  await s.db.$disconnect().catch(() => {});
  s.redis.disconnect();
}
