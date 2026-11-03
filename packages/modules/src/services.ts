import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyContentPolicy,
  remoteImageShown,
  GcsInstallState,
  GcsLicenseOnline,
  GcsAcpDashboardService,
  GcsContentRatingService,
  GcsAcpRoleService,
  GcsAcpSearch,
  GcsActorResolver,
  DECOR_CONTENT_TYPE,
  HEADER_VIDEO_CONTENT_TYPE,
  GcsAttachmentService,
  GcsBanService,
  GcsCache,
  GcsContentRenderer,
  GcsEventBus,
  GcsFollowService,
  GcsGroupDisplayService,
  GcsGroupMentionService,
  GcsGroupService,
  createGcsInfra,
  type GcsEdition,
  type GcsInfra,
  type GcsJobQueue,
  type GcsKv,
  type GcsLock,
  GcsLocalFileStore,
  GcsMemberDirectory,
  GcsAppService,
  GcsNavService,
  GcsNotificationService,
  GcsPushService,
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
  GcsRateLimiter,
  GcsLoginLockout,
  GcsPasswordResetService,
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
  GcsMemberAdmin,
  GcsOptInGroups,
  type GcsFileStore,
  type GcsMailer,
  type GcsModule,
  type GcsModuleRegistry,
  warningAckRequired,
} from "@gcs/core";
import { forumMemberData } from "./forums/memberData";
import { profileMemberData } from "./profile/memberData";
import { messageMemberData } from "./messages/memberData";
import { chatMemberData } from "./chat/memberData";
import { vipMemberData } from "./vip/memberData";
import { clanMemberData } from "./clans/memberData";
import { serverMemberData } from "./servers/bridge/memberData";
import { importerMemberData } from "./importer/memberData";
import { createPrismaClient, PrismaClient, isMysql, retryOnUnique, sql } from "@gcs/db";
import { templateComponents, withEmailLayout } from "./templates/components";
import { isGcsIcon, resolveIcon } from "@gcs/ui/icon-registry";
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
import { GcsForumSlotService } from "./forums/slots";
import { registerTopicRatings } from "./forums/ratings";
import { GcsTopicToolsService } from "./forums/topicTools";
import { GcsArchiveService } from "./forums/archive";
import { GcsTopicService } from "./forums/topics";
import { registerAppJobs } from "./jobs";
import { GcsAchievementService } from "./profile/achievements";
import { GcsAchievementAdmin } from "./profile/achievementsAdmin";
import { GcsCosmeticsService } from "./profile/cosmetics";
import { GcsRankDirectory } from "./profile/display";
import { GcsProfileFieldAdmin } from "./profile/fieldsAdmin";
import { GcsMembership } from "./profile/membership";
import { GcsAchievementRules, systemActor } from "./profile/achievementRules";
import { GcsProfileService } from "./profile/profile";
import { GcsPromotionService } from "./profile/promotions";
import { GcsProfileQueries } from "./profile/queries";
import { GcsSocialService } from "./profile/social";
import { registerCardContributions } from "./profile/cardContributions";
import { GcsDeviceService } from "./profile/devices";
import { GcsExternalProfiles } from "./profile/external";
import { GcsProfileExtras } from "./profile/extras";
import { registerDonationNotifications } from "./vip/donationNotify";
import { GcsDonationService } from "./vip/donations";
import { BOT_WELCOME_JOB, GcsCommunityBot } from "./bot/service";
import { GcsHoverCardLoader } from "./profile/hoverCard";
import { GcsMemberPrefsService } from "./profile/memberPrefs";
import { GcsChatService } from "./chat/chat";
import { GcsChatExtensions } from "./chat/extensions";
import { GcsChatProService } from "./chat-pro/service";
import { chatProMemberData } from "./chat-pro/memberData";
import { GcsChatQueries } from "./chat/queries";
import { GcsChatModeration } from "./chat/moderation";
import { GcsChatRights } from "./chat/rights";
import { renderChatText } from "./chat/text";
import { canViewPost } from "./forums/content";
import { GcsNotificationProducers } from "./notifications/producers";
import { registerLiveEvents } from "./realtime/live";
import { GcsRealtimeHub } from "./realtime/hub";
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
import { GcsOnlineTime, onlineTimeMemberData } from "./community/onlineTime";
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
import { GcsGroupDirectory } from "./profile/groupDirectory";
import { GcsGroupsProService } from "./groups-pro/service";
import { GcsTextMentions } from "./profile/textMentions";
import { chatMentionNames } from "./chat/mentionNames";
import { GcsStaffPage } from "./profile/staffPage";
import { GcsWhereabouts } from "./community/whereabouts";
import { GcsMemberPanelData } from "./profile/memberPanels";
import { GcsAntispamService } from "./antispam/service";
import { GcsIpToolsService, IP_TOOLS_ACP_SECTION } from "./antispam/ipTools";
import { GcsRetentionService } from "./security/retention";
import { loadContentPolicy } from "./seo/meta";
import { GcsIndexNowService } from "./seo/indexnow";
import { GcsSitemapService } from "./seo/sitemap";
import { GcsOrphanFilesService } from "./uploads/orphans";
import { GcsFileAdminService } from "./uploads/admin";
import { GcsCacheAdminService } from "./system/cache";
import { GcsSystemStatusService, STATUS_ALERT_TYPE } from "./system/status";
import { CONTACT_ACP_SECTION, CONTACT_NOTIFICATION, GcsContactService } from "./community/contact";
import { GcsBulkMailService } from "./notifications/bulkMail";
import { GcsReferralService, REFERRAL_NOTIFICATION } from "./profile/referrals";
import { GcsStatsReportService } from "./stats/reports";
import { GcsTagsAdmin } from "./forums/tagsAdmin";
import { loadUploadPolicy } from "./uploads/settings";

export type GcsServices = {
  db: PrismaClient;
  /** Ediția: `vps` (Redis, BullMQ, websocket) sau `lite` (totul în baza de date, joburile prin cron). */
  edition: GcsEdition;
  /** Driverele de infrastructură ale ediției (în VPS și conexiunea Redis, pentru abonări). */
  infra: GcsInfra;
  /** Cheile scurte (contoare, prezență, lacăte): Redis în VPS, baza de date în Lite. */
  kv: GcsKv;
  lock: GcsLock;
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
  /** Grupul afișat al membrilor (stilul numelui): prioritatea grupurilor, alegerea membrului, setările de afișare. */
  groupDisplay: GcsGroupDisplayService;
  /** Grupurile pentru pastile, legendă și paginile de membri: lista, numărătorile din cache, grupurile membrilor. */
  groupDirectory: GcsGroupDirectory;
  /** Grupuri Pro (aplicația premium): categoriile legendei, locul grupurilor în ea și pagina grupurilor. */
  groupsPro: GcsGroupsProService;
  members: GcsMemberDirectory;
  notifications: GcsNotificationService;
  realtime: GcsRealtime;
  presence: GcsPresenceService;
  realtimeRooms: GcsRealtimeRooms;
  /** Logica live comună transporturilor: websocket (`gcs-realtime`), SSE și polling (web). */
  realtimeHub: GcsRealtimeHub;
  notificationProducers: GcsNotificationProducers;
  /** Web push (Notificări v2): cheile VAPID, dispozitivele membrilor și trimiterea. */
  push: GcsPushService;
  chat: GcsChatService;
  /** Moderarea chat-ului (staff și accesul de moderator în chat): sancțiuni, jurnal, `/acces`, liniile de sistem. */
  chatModeration: GcsChatModeration;
  /**
   * Chat Pro (aplicația premium, specul 2026-10-10-chat-pro): profilul de chat, clasamentul, bara de anunțuri,
   * emoticoanele, GIF-urile, comenzile botului și istoricul, legate de chat prin punctele de extensie.
   */
  chatPro: GcsChatProService;
  apps: GcsAppService;
  translation: GcsTranslationService;
  /** Botul comunității (bot-stiri): publică în numele contului-bot pentru nucleu și pluginuri. */
  communityBot: GcsCommunityBot;
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
  antispam: GcsAntispamService;
  ipTools: GcsIpToolsService;
  actors: GcsActorResolver;
  rateLimiter: GcsRateLimiter;
  /** Blocarea după parole greșite (ACP → Setări → Securitate), pe cont și pe IP. */
  loginLockout: GcsLoginLockout;
  /** „Am uitat parola”: linkul de resetare pe email (ACP → Setări → Securitate). */
  passwordReset: GcsPasswordResetService;
  /** Perioadele de păstrare a datelor (jobul zilnic `system.retention`). */
  retention: GcsRetentionService;
  /** Sitemap-ul (ACP → Promovare → SEO): indexul și fișierele pe tip de conținut, doar ce vede un vizitator. */
  sitemap: GcsSitemapService;
  /** IndexNow (ACP → Promovare → SEO): cheia și jobul care anunță topicurile publice noi. */
  indexNow: GcsIndexNowService;
  /** Curățarea fișierelor încărcate și nelegate de nimic (jobul zilnic `uploads.orphans`). */
  orphanFiles: GcsOrphanFilesService;
  /** ACP › Sistem › Fișiere: toate fișierele încărcate, cu filtre, unde sunt folosite și ștergerea. */
  fileAdmin: GcsFileAdminService;
  /** ACP › Sistem › Stare sistem: serviciile, joburile programate și alertele trimise administratorilor. */
  systemStatus: GcsSystemStatusService;
  /** ACP › Sistem › Cache: zonele cache-ului și golirea lor. */
  cacheAdmin: GcsCacheAdminService;
  /** Formularul de contact (`/contact`) și mesajele lui din ACP › Setări › Contact. */
  contact: GcsContactService;
  /** Email în masă (ACP › Membri › Comunicare) și dezabonarea membrilor de la emailurile adminilor. */
  bulkMail: GcsBulkMailService;
  /** Recomandările (linkul de invitație, calificarea și recompensa). */
  referrals: GcsReferralService;
  /** ACP › Statistici: rapoartele pe perioade (înregistrări, membri, conținut, online, clanuri, servere, VIP). */
  statsReports: GcsStatsReportService;
  /** ACP › Descoperire › Etichete: lista, redenumirea, unirea, ștergerea și setările etichetelor. */
  tagsAdmin: GcsTagsAdmin;
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
  /** Forum v2: sloturile de extensie ale forumului (listă, pagina forumului, bara topicului, taburile din ACP). */
  forumSlots: GcsForumSlotService;
  /** Forum v2: nota cu stele (`contentRating`), uneltele topicului (mesaj de moderator, recomandat, istoric) și arhivarea. */
  ratings: GcsContentRatingService;
  topicTools: GcsTopicToolsService;
  archive: GcsArchiveService;
  mailer: GcsMailer;
  profiles: GcsProfileService;
  profileFields: GcsProfileFieldAdmin;
  social: GcsSocialService;
  achievements: GcsAchievementService;
  achievementRules: GcsAchievementRules;
  achievementAdmin: GcsAchievementAdmin;
  membership: GcsMembership;
  promotions: GcsPromotionService;
  cosmetics: GcsCosmeticsService;
  vip: GcsVipService;
  ranks: GcsRankDirectory;
  profileQueries: GcsProfileQueries;
  /** Profil gaming v2: hover card v2 (cipurile și statusul aplicațiilor), coloana profilului, Steam / FACEIT, dispozitivele, preferințele. */
  hoverCards: GcsHoverCardLoader;
  profileExtras: GcsProfileExtras;
  /** VIP clasic › Donații: donațiile (ACP, „Am donat”), obiectivele, topul și insigna „Sponsor”. */
  donations: GcsDonationService;
  externalProfiles: GcsExternalProfiles;
  devices: GcsDeviceService;
  memberPrefs: GcsMemberPrefsService;
  conversations: GcsConversationService;
  conversationQueries: GcsConversationQueries;
  /** Pluginurile încărcate în acest proces (hook-uri, widget-uri, pagini…), etapa 6. */
  plugins: GcsPluginHost;
  /** Ciclul de viață al pluginurilor (ACP → Aplicații → Aplicații și pluginuri). */
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
  /** Clasamentul (`/leaderboard`, widget-ul „Clasament”, panoul „Top” al consolei). */
  leaderboard: GcsLeaderboard;
  /** Timpul online al membrilor pe zile (clasamentul „Timp online”). */
  onlineTime: GcsOnlineTime;
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
  /** Membri v2: acțiunile pe cont din ACP (crearea, CSV, validarea, spammerii, deblocarea, parola, 2FA). */
  memberAdmin: GcsMemberAdmin;
  /** Membri v2: grupurile publice (opt-in) din Setări → Grupuri. */
  optInGroups: GcsOptInGroups;
  /** Membri v2: pagina Staff (/staff) și editorul ei din ACP. */
  staffPage: GcsStaffPage;
  /** Membri v2: unde e fiecare vizitator pe site (/online). */
  whereabouts: GcsWhereabouts;
  /** Membri v2: datele panourilor de membru aduse de aplicații (conturi legate, identități de joc, ELO, sancțiuni, clan). */
  memberPanels: GcsMemberPanelData;
  /** Verificarea zilnică a licenței la platforma-mamă (Data Center) și perioada de grație. */
  licenseOnline: GcsLicenseOnline;
};

export type GcsServicesOptions = {
  /** Folderul de configurare (`GCS_CONFIG_DIR`): `.env.runtime`, fișierele locale. */
  configDir: string;
  /** În Next.js: `revalidateTag`. În worker: nimic (paginile citesc prin `GcsCache`, invalidat de bus). */
  revalidate?: (tag: string) => void;
  /** Module în plus (ex. modulul de test al E2E). */
  extraModules?: GcsModule[];
  /** Versiunea aplicației (trimisă platformei-mamă la verificarea licenței). */
  appVersion?: string;
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
    const m = /^(DATABASE_URL|GCS_SECRET|GCS_BASE_URL)=(.*)$/.exec(line);
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

/** Lista (`GcsKv`) în care ajung emailurile când rulează E2E (`GCS_TEST_ROUTES=1`), în loc de SMTP. */
export const TEST_OUTBOX_KEY = "gcs:test:outbox";
/** Cheia internă (în `settings`) a recordului de utilizatori online. */
export const PRESENCE_RECORD_SETTING = "presence.record";

/** Adresa publică a site-ului: setarea `site.url`, altfel `GCS_BASE_URL`. */
function baseUrl(siteUrl: string): string {
  return siteUrl || process.env.GCS_BASE_URL || "http://localhost:3000";
}

/**
 * MinIO (S3) dacă e configurat (`docker compose`); altfel un folder local: `GCS_UPLOADS_DIR` (ediția Lite: `uploads/`
 * lângă `config/`, setat de `app.js`), implicit `<config>/files` (dev, E2E).
 */
function createFileStore(configDir: string): GcsFileStore {
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) {
    return new GcsS3FileStore({
      endpoint,
      accessKey: process.env.S3_ACCESS_KEY ?? "",
      secretKey: process.env.S3_SECRET_KEY ?? "",
      bucket: process.env.S3_BUCKET ?? "gcs",
    });
  }
  return new GcsLocalFileStore(process.env.GCS_UPLOADS_DIR || path.join(configDir, "files"));
}

/**
 * Toate serviciile aplicației, legate între ele. Aceeași fabrică pentru `web` și pentru `gcs-worker`,
 * ca joburile să ruleze exact aceeași logică (și aceleași evenimente) ca Server Actions.
 */
export function createGcsServices(opts: GcsServicesOptions): GcsServices {
  loadRuntimeEnv(opts.configDir);
  const databaseUrl = process.env.DATABASE_URL;
  const db = createPrismaClient(databaseUrl);
  const infra = createGcsInfra({ db });
  const { kv, jobs, lock } = infra;

  const registry = createRegistry(opts.extraModules);
  const cache = new GcsCache(kv);
  const bus = new GcsEventBus({ cache, ...(opts.revalidate ? { revalidate: opts.revalidate } : {}) });
  for (const m of registry.all()) {
    for (const listener of m.eventListeners) bus.on(listener.event, listener.handler);
  }

  const settings = new GcsSettingsService({ db, cache, bus, registry });
  const permissions = new GcsPermissionService({ db, cache, bus, registry });
  const acp = new GcsAcpRoleService({ db, registry });
  const acpSearch = new GcsAcpSearch({ db, registry, acp });
  const groups = new GcsGroupService({ db, bus, permissions, acp });
  const groupMentions = new GcsGroupMentionService({ db, cache, kv });
  const groupDisplay = new GcsGroupDisplayService({ db, cache, bus });
  groupDisplay.listen();
  const groupDirectory = new GcsGroupDirectory({ db, cache, display: groupDisplay });
  const groupsPro = new GcsGroupsProService({ db, cache, bus, settings, groups: groupDirectory });
  // Licența: verificarea online (jobul zilnic) și oprirea aplicațiilor premium după perioada de grație. Starea se
  // citește din folderul de configurare cel mult o dată pe minut.
  const appVersion = opts.appVersion ?? process.env.GCS_VERSION;
  const licenseOnline = new GcsLicenseOnline({
    configDir: opts.configDir,
    state: new GcsInstallState(opts.configDir),
    edition: infra.edition,
    ...(appVersion ? { version: appVersion } : {}),
  });
  let premiumBlockedMemo: { at: number; value: Promise<boolean> } | null = null;
  const premiumBlocked = () => {
    if (!premiumBlockedMemo || Date.now() - premiumBlockedMemo.at > 60_000) premiumBlockedMemo = { at: Date.now(), value: licenseOnline.premiumBlocked().catch(() => false) };
    return premiumBlockedMemo.value;
  };
  const apps = new GcsAppService({ db, cache, bus, registry, acp, permissions, settings, premiumBlocked });
  const members = new GcsMemberDirectory({ db });
  const notifications = new GcsNotificationService({ db, bus, cache, registry, apps, settings });
  const push = new GcsPushService({ db });
  const bans = new GcsBanService({ db, cache, bus, acp });
  const warnings = new GcsWarningService({ db, bus, acp, bans, ackRequired: () => warningAckRequired(settings) });
  const realtime = new GcsRealtime(infra.realtimeLog);
  // Timpul online pe zile: fiecare semn de prezență al unui membru adaugă pauza scurtă de la semnul precedent.
  const onlineTime = new GcsOnlineTime({ db, kv, settings });
  // Recordul de prezență se păstrează și în baza de date (cheie internă, nu apare în ACP), ca să supraviețuiască unei goliri a stocării cheilor.
  const presence = new GcsPresenceService({
    kv,
    onUserTouch: (userId, now) => onlineTime.heartbeat(userId, now),
    // Scrierile concurente nu pot coborî recordul: se actualizează doar dacă numărul e mai mare.
    persistRecord: async (r) => {
      const value = JSON.stringify({ count: r.count, at: r.at.toISOString() });
      if (isMysql()) {
        // MySQL: citire și scriere (ediția Lite, un singur proces; recordul doar urcă).
        const row = await db.setting.findUnique({ where: { key: PRESENCE_RECORD_SETTING } });
        if (Number((row?.value as { count?: number } | undefined)?.count ?? 0) >= r.count) return;
        const data = { value: { count: r.count, at: r.at.toISOString() }, updatedAt: r.at };
        await retryOnUnique(() => db.setting.upsert({ where: { key: PRESENCE_RECORD_SETTING }, create: { key: PRESENCE_RECORD_SETTING, ...data }, update: data }));
        return;
      }
      await db.$executeRaw(sql`
        INSERT INTO settings (key, value, "updatedAt") VALUES (${PRESENCE_RECORD_SETTING}, ${value}::jsonb, ${r.at.toISOString()}::timestamp)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt"
        WHERE COALESCE((settings.value->>'count')::int, 0) < (EXCLUDED.value->>'count')::int`);
    },
    loadRecord: async () => {
      const row = await db.setting.findUnique({ where: { key: PRESENCE_RECORD_SETTING } });
      const v = row?.value as { count?: number; at?: string } | undefined;
      return v?.count && v.at ? { count: v.count, at: new Date(v.at) } : null;
    },
  });
  const actors = new GcsActorResolver({ db, cache, presence });
  const acpDashboard = new GcsAcpDashboardService({ db, acp, presence, cache });
  const rateLimiter = new GcsRateLimiter(kv);
  // Anti-spam: captcha-ul propriu, întrebarea de la înregistrare, membrii noi, phishing-ul și „Marchează ca spammer”.
  const antispam = new GcsAntispamService({
    db,
    settings,
    cache,
    rateLimiter,
    bans,
    acp,
    bus,
    secret: () => process.env.GCS_SECRET ?? "gcs-dev-secret-not-for-production-use",
  });
  const files = createFileStore(opts.configDir);
  // Extensiile permise și imaginile (latura, calitatea, WebP, metadatele, miniaturile): ACP → Setări → Încărcări și imagini.
  const attachments = new GcsAttachmentService({ db, store: files, permissions, rateLimiter, policy: () => loadUploadPolicy(settings) });
  // Logo-ul și favicon-ul temelor sunt publice (etapa 5).
  attachments.registerAccess("theme.logo", async () => true);
  attachments.registerAccess("theme.favicon", async () => true);
  attachments.registerAccess("theme.header", async () => true);
  attachments.registerAccess(HEADER_VIDEO_CONTENT_TYPE, async () => true);
  // Aspect forumuri: iconițele și fundalurile forumurilor și ale widget-urilor sunt publice.
  attachments.registerAccess(DECOR_CONTENT_TYPE, async () => true);
  // Forum v2: paginile („Pagină / Anunț”) și regulile forumurilor se scriu cu editorul postărilor, cu blocurile staff-ului.
  const forums = new GcsForumService({ db, bus, permissions, acp, registry, render: (content, actor) => posting.render(content, { actor, blocks: true }) });
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
    // Forum v2: iconițele blocurilor din postări (SVG-ul registrului Font Awesome).
    icon: iconSvg,
    antispam,
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
          await kv.listPush(TEST_OUTBOX_KEY, JSON.stringify(mail), 50);
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
    antispam,
  });
  const social = new GcsSocialService({
    db,
    bus,
    cache,
    permissions,
    settings,
    rateLimiter,
    profiles,
    render: (content, ctx) => posting.render(content, ctx),
    markGroupMentions: (actor, rendered) => posting.markGroupMentions(actor, rendered),
    antispam,
  });
  social.registerContent({ reactions, reports });
  const achievements = new GcsAchievementService({ db, bus, acp, jobs });
  achievements.listen(bus);
  const membership = new GcsMembership({ bus, permissions });
  const promotions = new GcsPromotionService({ db, bus, acp, membership });
  achievements.onEvaluated(async (userId) => void (await promotions.evaluateUser(userId)));
  achievements.onDaily((now) => promotions.dailySweep(now));
  const cosmetics = new GcsCosmeticsService({ db, bus, cache, permissions, acp, attachments, kv });
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
    antispam,
  });
  conversations.registerContent({ reports });
  const vip = new GcsVipService({ db, bus, permissions, settings, membership });
  // Realizări v2: regulile pe evenimentele aplicațiilor (constructorul din ACP), rangurile moderne și widget-ul live.
  const achievementRules = new GcsAchievementRules({
    db,
    bus,
    registry,
    enabledFilter: () => apps.enabledFilter(),
    setting: (key) => settings.get(key),
    membership,
    realtime,
    jobs,
    schedule: (userId) => achievements.schedule(userId),
    grantVip: async (userId, groupId, days) => void (await vip.grant(await systemActor(db), { userId, groupId, days, asPrimary: false, note: "achievements" })),
  });
  achievementRules.listen(bus);
  achievements.configureRanks({ registry, enabledFilter: () => apps.enabledFilter(), membership, realtime });
  achievements.onEvaluated(async (userId) => void (await achievementRules.evaluateValues(userId)));
  achievements.onDaily((now) => achievementRules.dailySweep(now));

  const profileQueries = new GcsProfileQueries({ db, cache, permissions, profiles, social, ranks });
  const forumQueries = new GcsForumQueries({ db, cache, permissions, settings, readMarkers, follows, reactions, polls, ranks });
  // Forum v2: nota cu stele (serviciul generic, cu topicurile ca prim tip de conținut) și uneltele topicului.
  const ratings = new GcsContentRatingService({ db, bus });
  registerTopicRatings(ratings, { db, permissions, settings, posting, queries: forumQueries });
  const topicTools = new GcsTopicToolsService(posting, { settings });
  const archive = new GcsArchiveService({ db, bus, acp, settings, posting });
  // Unelte IP: căutarea, multi-conturile (alerta staff-ului la înregistrare) și ștergerea IP-urilor vechi (GDPR).
  const ipTools = new GcsIpToolsService({ db, acp, bans, bus, settings });
  ipTools.listen(bus);
  notifications.registerTarget("core.multi_account", {
    canView: async (userId) => (await acp.usersWith(IP_TOOLS_ACP_SECTION, "view", 500)).includes(userId),
    describe: async (id) => {
      const user = await db.user.findUnique({ where: { id }, select: { name: true } });
      return user ? { title: user.name, href: `/admin/members/ip-tools?member=${encodeURIComponent(id)}` } : null;
    },
  });
  bus.on("antispam.multi_account", async (e) => {
    const userId = typeof e.payload.userId === "string" ? e.payload.userId : null;
    if (!userId) return;
    const others = Array.isArray(e.payload.others) ? e.payload.others.length : 0;
    const banned = Array.isArray(e.payload.banned) ? e.payload.banned.length : 0;
    await antispam.log("multi_account", { userId, ip: typeof e.payload.ip === "string" ? e.payload.ip : null, detail: { others, banned } });
    const staff = (await acp.usersWith(IP_TOOLS_ACP_SECTION, "view")).filter((id) => id !== userId);
    if (staff.length > 0) await notifications.notify({ userIds: staff, type: "core.multi_account", targetType: "core.multi_account", targetId: userId, actorId: null, data: { others, banned } });
  });
  // Stare sistem: alertele (disc, joburi picate) trimise administratorilor; linkul duce la pagina de stare.
  const systemStatus = new GcsSystemStatusService({ db, kv, jobs, settings, acp, notifications, edition: infra.edition });
  notifications.registerTarget(STATUS_ALERT_TYPE, {
    canView: async (userId) => (await acp.usersWith("system.status", "view", 500)).includes(userId),
    describe: async (id) => ({ title: id.startsWith("job:") ? id.slice(4) : id, href: "/admin/system/status" }),
  });
  // Contact: mesajele primite; notificarea duce la cutia din ACP, cu mesajul deschis.
  const contact = new GcsContactService({ db, settings, acp, notifications, mailer, rateLimiter, antispam, siteName: () => settings.get<string>("site.name") });
  // Recomandări: notificarea duce la pagina membrului cu invitațiile lui.
  const referrals = new GcsReferralService({ db, bus, settings, acp, notifications });
  notifications.registerTarget(REFERRAL_NOTIFICATION, {
    canView: async () => true,
    describe: async (id) => {
      const r = await db.referral.findUnique({ where: { id: Number(id) || 0 }, select: { referredId: true } });
      const u = r ? await db.user.findUnique({ where: { id: r.referredId }, select: { name: true } }) : null;
      return u ? { title: u.name, href: "/settings/referral" } : null;
    },
  });
  notifications.registerTarget(CONTACT_NOTIFICATION, {
    canView: async (userId) => (await acp.usersWith(CONTACT_ACP_SECTION, "view", 500)).includes(userId),
    describe: async (id) => {
      const msg = await db.contactMessage.findUnique({ where: { id: Number(id) || 0 }, select: { subject: true } });
      return msg ? { title: msg.subject, href: `/admin/settings/contact?open=${id}` } : null;
    },
  });
  const notificationProducers = new GcsNotificationProducers({
    db,
    kv,
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
    groupDirectory,
    push,
    apps,
  });
  notificationProducers.registerTargets();
  notificationProducers.listen(bus);
  // Punctele de extensie ale chat-ului (Chat Pro), împărțite de serviciu și de citiri.
  const chatExtensions = new GcsChatExtensions();
  // Mențiunile din textul simplu (chat, statusuri): după id, cu setările de mențiune ale grupurilor.
  const textMentions = new GcsTextMentions({ db, groupMentions });
  // Drepturile de moderare (grupuri + accesul de moderator) și sancțiunile, aceleași pentru scriere și citire.
  const chatRights = new GcsChatRights({ db, permissions });
  const chat = new GcsChatService({ db, bus, permissions, settings, rateLimiter, realtime, acp, attachments, extensions: chatExtensions, textMentions, groupMentions, rights: chatRights, antispam });
  // „Marchează ca spammer”: fiecare aplicație își ascunde conținutul membrului (postările prin moderare, cu contoarele).
  antispam.registerContent({
    key: "forums.posts",
    hide: async (userId, actor) => {
      const rows = await db.post.findMany({ where: { authorId: userId, visibility: "VISIBLE" }, select: { id: true }, orderBy: { id: "desc" }, take: 500 });
      let count = 0;
      for (const r of rows) {
        const ok = await posts.hide(actor, r.id, "spam").then(() => true, () => false);
        if (ok) count++;
      }
      return count;
    },
  });
  antispam.registerContent({
    key: "chat.messages",
    hide: async (userId, actor) => (await db.chatMessage.updateMany({ where: { authorId: userId, hiddenAt: null, deletedAt: null }, data: { hiddenAt: new Date(), hiddenById: actor.userId } })).count,
  });
  antispam.registerContent({
    key: "profile.statuses",
    hide: async (userId) => (await db.statusUpdate.updateMany({ where: { authorId: userId, visibility: "VISIBLE" }, data: { visibility: "HIDDEN" } })).count,
  });
  // Stilul numelor din pastilele mențiunilor (decorarea de bază, înaintea extensiilor); `appearance` e creat mai jos.
  chatExtensions.useBase(chatMentionNames({ db, letterUsers: () => appearance.letterUsers() }));
  // Linkurile externe (nofollow după ACP → SEO) și imaginile externe (ACP → Încărcări și imagini) ale mesajelor.
  chatExtensions.useBase(async (views) => {
    const policy = await loadContentPolicy(settings, siteHost(await settings.get<string>("site.url")));
    for (const v of views) {
      v.html = applyContentPolicy(v.html, policy);
      if (policy.remoteImages !== "allow") v.embeds = v.embeds.filter((e) => e.kind !== "image" || remoteImageShown(e.url, policy));
    }
  });
  const chatQueries = new GcsChatQueries({ db, permissions, extensions: chatExtensions, rights: chatRights });
  const chatModeration = new GcsChatModeration({ db, permissions, settings, realtime, acp, chat, warnings, notifications, reports });
  const chatPro = new GcsChatProService({
    db,
    cache,
    settings,
    permissions,
    apps,
    acp,
    chat,
    chatQueries,
    attachments,
    realtime,
    rateLimiter,
    notifications,
    reports,
    // Câștigătorul unei perioade: insigna de perioadă (se poate câștiga din nou în altă perioadă).
    grantBadge: (userId, key, reason) => achievementRules.grantPeriodWinner({ userId, badgeKey: key, period: reason.replace(/[^a-z0-9_:.-]+/gi, "_").slice(0, 60), reason, source: "chat_pro" }),
  });
  chatPro.register();
  const realtimeRooms = new GcsRealtimeRooms({ permissions, forumQueries });
  realtimeRooms.register("chat", (actor, key) => chatQueries.canRead(actor, key));
  // Widget-ul „Ultimele realizări”: fluxul public al badge-urilor noi.
  realtimeRooms.register("feed", async (_actor, id) => id === "badges");
  // Aplicația Servere (etapa Gaming): statusul din Redis, citirile publice, ACP-ul și interogarea din worker.
  const serverStore = new GcsServerStatusStore(kv);
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
    kv,
    bus,
    settings,
    permissions,
    acp,
    apps,
    attachments,
    rateLimiter,
    realtime,
    render: (content, ctx) => posting.render(content, ctx),
    markGroupMentions: (actor, rendered) => posting.markGroupMentions(actor, rendered),
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
  // Profil gaming v2: hover card v2 cu cipurile și statusul aplicațiilor (Clanuri, Servere, VIP), coloana profilului,
  // conturile externe (Steam, FACEIT, aduse de worker), dispozitivele și preferințele contului.
  const hoverCards = new GcsHoverCardLoader({ db, permissions, queries: profileQueries, social, apps });
  registerCardContributions(hoverCards, { db, clanQueries, bridgeQueries: bridge.queries, serverQueries });
  // Donațiile (VIP clasic): mesajul de mulțumire al botului comunității nu e legat încă (vezi `thankYou`).
  const donations = new GcsDonationService({ db, bus, settings, acp, realtime, thankYou: null });
  registerDonationNotifications({ db, bus, notifications, acp, actors });
  const profileExtras = new GcsProfileExtras({ db, cache, queries: profileQueries, sponsor: (userId) => donations.sponsor(userId) });
  const externalProfiles = new GcsExternalProfiles({ db, settings, jobs });
  const devices = new GcsDeviceService({ db, mailer, settings, baseUrl: async () => baseUrl(await settings.get<string>("site.url")) });
  // Blocarea după parole greșite, folosită și de „Am uitat parola” (resetarea uită blocarea contului).
  const loginLockout = new GcsLoginLockout({ db, kv, settings, ipLock: () => process.env.GCS_DISABLE_RATE_LIMIT !== "1" });
  const memberPrefs = new GcsMemberPrefsService({ db, bus });
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
  const appearance = new GcsMemberAppearanceService({ db, cache, kv, bus });
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
    kv,
    bus,
    registry,
    permissions,
    jobs,
    plugins: pluginAdmin,
    database: pluginDatabase,
    api: new GcsPluginPublicApi({ db, forumQueries, posting, servers: serverQueries }),
    appearance,
    media: pluginMedia,
    dataDir: process.env.GCS_PLUGINS_DIR || path.join(opts.configDir, "plugins"),
    ...(process.env.GCS_APPLICATIONS_DIR ? { applicationsDir: process.env.GCS_APPLICATIONS_DIR } : {}),
    iconSvg,
    siteLocale: () => settings.get<string>("site.locale"),
    bot: () => communityBot,
    safeMode: process.env.GCS_PLUGINS_SAFE_MODE === "1",
    ...(Number(process.env.GCS_PLUGINS_MAX_FAILURES) > 0 ? { maxFailures: Number(process.env.GCS_PLUGINS_MAX_FAILURES) } : {}),
    // Anunțurile între procese (VPS); în Lite, celelalte procese află la reconcilierea periodică.
    ...(infra.redis ? { subscriber: () => infra.redis!.duplicate(), publish: (channel: string, message: string) => infra.redis!.publish(channel, message) } : {}),
  });
  pluginRef.host = plugins;
  // `{ template, data }` întors de un plugin: motorul de șabloane (sandbox, limite de timp și iterații); rezultatul trece
  // apoi prin sanitizer-ul pluginurilor.
  plugins.setTemplateRenderer(async (_plugin, template, data) =>
    template.length > 64 * 1024 ? "" : renderTemplate(template, data, { locale: await settings.get<string>("site.locale"), components: templateComponents() }),
  );

  const memberList = new GcsMemberList({ db, permissions, ranks, groups: groupDirectory });
  const topics = new GcsTopicService(posting, { polls, prefixes });
  const forumModeration = new GcsForumModerationService(posting, { posts, reports, acp });
  const communityBot = new GcsCommunityBot({ db, settings, topics, posts, moderation: forumModeration, conversations, chat, acp, translator: () => translation.provider(), setAvatar: (actor, file) => profiles.setAvatar(actor, file) });
  // Bun venitul botului: din coadă (ascultătorii magistralei rulează în cererea de înregistrare).
  bus.on("user.registered", async (e) => {
    const userId = e.payload.userId;
    if (typeof userId === "string") await jobs.enqueue(BOT_WELCOME_JOB, { userId }, { jobId: `bot-welcome-${userId}` });
  });

  // Sitemap-ul: ce vede grupul `guest` (forumuri, topicuri, profiluri publice, clanuri, servere).
  const sitemap = new GcsSitemapService({
    db,
    settings,
    permissions,
    apps,
    cache,
    guest: async () => {
      const g = await db.group.findUniqueOrThrow({ where: { key: "guest" }, select: { id: true } });
      return { userId: null, groupIds: [g.id], primaryGroupId: g.id, isBanned: false, ip: "0.0.0.0" };
    },
    clansVisible: (actor) => clanQueries.canView(actor),
    serverIds: (actor) => serverQueries.visibleIds(actor),
  });

  const services: GcsServices = {
    db,
    licenseOnline,
    edition: infra.edition,
    infra,
    kv,
    lock,
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
    groupDisplay,
    groupDirectory,
    groupsPro,
    members,
    notifications,
    realtime,
    presence,
    realtimeRooms,
    realtimeHub: new GcsRealtimeHub({ db, presence, realtimeRooms, realtime, chatPro }),
    notificationProducers,
    push,
    chat,
    chatPro,
    chatQueries,
    chatModeration,
    apps,
    translation,
    communityBot,
    widgets: new GcsWidgetService({ db, cache, bus, registry, acp, apps }),
    nav: new GcsNavService({ db, cache, bus, registry, acp, apps, isIcon: isGcsIcon }),
    themes: new GcsThemeService({ db, cache, bus, acp }),
    themeCss: new GcsThemeCssService({ db, bus, acp }),
    templates,
    stats: new GcsStatsService({ db, cache, registry, apps }),
    postbit: new GcsPostbitService({ db, cache, permissions, settings, groups: groupDirectory }),
    memberList,
    mentionQueries: new GcsMentionQueries({ db, cache, permissions, groupMentions }),
    activity: new GcsActivityStream({ db, cache, permissions, social }),
    leaderboard: new GcsLeaderboard({ db, cache, permissions, settings, onlineTime }),
    onlineTime,
    // Fără magazin încă: planurile au butonul „Contactează staff-ul” (`checkout` vine odată cu plățile).
    vipPublic: new GcsVipPublic({ db, registry, permissions, settings, vip, checkout: null }),
    bans,
    warnings,
    antispam,
    ipTools,
    actors,
    rateLimiter,
    loginLockout,
    passwordReset: new GcsPasswordResetService({
      db,
      settings,
      rateLimiter,
      lockout: loginLockout,
      baseUrl: async () => baseUrl(await settings.get<string>("site.url")),
      ipLimit: () => process.env.GCS_DISABLE_RATE_LIMIT !== "1",
    }),
    retention: new GcsRetentionService({ db, settings }),
    sitemap,
    indexNow: new GcsIndexNowService({
      db,
      settings,
      siteUrl: async () => baseUrl(await settings.get<string>("site.url")),
      changedTopics: (since, limit) => sitemap.changedTopics(since, limit),
    }),
    orphanFiles: new GcsOrphanFilesService({ db, settings, attachments }),
    fileAdmin: new GcsFileAdminService({ db, acp, attachments, settings }),
    systemStatus,
    cacheAdmin: new GcsCacheAdminService({ db, kv, cache, acp }),
    contact,
    referrals,
    statsReports: new GcsStatsReportService({ db, acp, settings }),
    tagsAdmin: new GcsTagsAdmin({ db, acp, settings, bus }),
    bulkMail: new GcsBulkMailService({
      db,
      acp,
      settings,
      mailer,
      secret: () => process.env.GCS_SECRET ?? "gcs-dev-secret-not-for-production-use",
      baseUrl: async () => baseUrl(await settings.get<string>("site.url")),
    }),
    files,
    attachments,
    forums,
    topics,
    posts,
    forumQueries,
    readMarkers,
    follows,
    reactions,
    polls,
    prefixes,
    reports,
    moderation: forumModeration,
    search: new GcsForumSearch({ db, permissions, settings, rateLimiter, kv }),
    posting,
    forumModerators: new GcsForumModeratorService({ db, permissions, acp }),
    forumSlots: new GcsForumSlotService({ db, cache, bus, registry, apps, acp }),
    ratings,
    topicTools,
    archive,
    mailer,
    profiles,
    profileFields: new GcsProfileFieldAdmin({ db, bus, acp }),
    social,
    achievements,
    achievementAdmin: new GcsAchievementAdmin({ db, bus, acp, achievements, jobs, attachments, rules: achievementRules }),
    achievementRules,
    membership,
    promotions,
    cosmetics,
    vip,
    ranks,
    profileQueries,
    hoverCards,
    profileExtras,
    donations,
    externalProfiles,
    devices,
    memberPrefs,
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
      clearCache: () => cache.clear(),
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
    memberAdmin: new GcsMemberAdmin({ db, bus, acp, bans }),
    optInGroups: new GcsOptInGroups({ db, bus, permissions }),
    staffPage: new GcsStaffPage({ db, bus, acp, permissions, members: memberList }),
    whereabouts: new GcsWhereabouts({ kv }),
    memberPanels: new GcsMemberPanelData({ db }),
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
  removal.register(chatProMemberData({ db: d.db }));
  removal.register(onlineTimeMemberData({ db: d.db }));
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
  await s.infra.close().catch(() => {});
  await s.db.$disconnect().catch(() => {});
}
