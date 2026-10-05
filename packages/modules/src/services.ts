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
  GcsGroupService,
  GcsJobQueue,
  GcsLocalFileStore,
  GcsMemberDirectory,
  GcsPermissionService,
  GcsReactionService,
  GcsRedisRateLimiter,
  GcsReportService,
  GcsS3FileStore,
  GcsSettingsService,
  GcsWarningService,
  sendEmail,
  type GcsFileStore,
  type GcsMailer,
  type GcsModule,
  type GcsModuleRegistry,
} from "@gcs/core";
import { PrismaClient } from "@gcs/db";
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
import { GcsMembership } from "./profile/membership";
import { GcsProfileService } from "./profile/profile";
import { GcsPromotionService } from "./profile/promotions";
import { GcsSocialService } from "./profile/social";
import { createRegistry } from "./registry";

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
  members: GcsMemberDirectory;
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
  social: GcsSocialService;
  achievements: GcsAchievementService;
  membership: GcsMembership;
  promotions: GcsPromotionService;
};

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

/** Host-ul public: din setarea `site.url`, altfel din `GCS_BASE_URL` (embed-urile Twitch îl cer). */
function siteHost(siteUrl: string): string {
  const url = siteUrl || process.env.GCS_BASE_URL || "http://localhost";
  return URL.canParse(url) ? new URL(url).host : "localhost";
}

/** Lista Redis în care ajung emailurile când rulează E2E (`GCS_TEST_ROUTES=1`), în loc de SMTP. */
export const TEST_OUTBOX_KEY = "gcs:test:outbox";

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
  const acpDashboard = new GcsAcpDashboardService({ db, acp });
  const acpSearch = new GcsAcpSearch({ db, registry, acp });
  const groups = new GcsGroupService({ db, bus, permissions, acp });
  const members = new GcsMemberDirectory({ db });
  const bans = new GcsBanService({ db, cache, bus, acp });
  const warnings = new GcsWarningService({ db, bus, acp, bans });
  const actors = new GcsActorResolver({ db, cache });
  const rateLimiter = new GcsRedisRateLimiter(redis);
  const files = createFileStore(opts.configDir);
  const attachments = new GcsAttachmentService({ db, store: files, permissions, rateLimiter });
  const forums = new GcsForumService({ db, bus, permissions, acp, registry });
  const readMarkers = new GcsReadMarkerService({ db, settings });
  const follows = new GcsFollowService({ db });
  const posting = new GcsForumPosting({
    db,
    bus,
    permissions,
    settings,
    rateLimiter,
    renderer: new GcsContentRenderer(),
    attachments,
    siteHost: async () => siteHost(await settings.get<string>("site.url")),
  });
  const polls = new GcsPollService(posting);
  const prefixes = new GcsPrefixService({ db, bus, acp });
  const reactions = new GcsReactionService({ db, bus, cache, acp });
  const reports = new GcsReportService({ db, bus, rateLimiter });
  const posts = new GcsPostService(posting);
  registerForumContent(posting, { reactions, attachments, reports, posts });
  const mailer: GcsMailer =
    process.env.GCS_TEST_ROUTES === "1"
      ? async (mail) => {
          await redis.lpush(TEST_OUTBOX_KEY, JSON.stringify(mail));
          await redis.ltrim(TEST_OUTBOX_KEY, 0, 49);
        }
      : (mail) => sendEmail(mail, settings);
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
    members,
    bans,
    warnings,
    actors,
    rateLimiter,
    files,
    attachments,
    forums,
    topics: new GcsTopicService(posting, { polls, prefixes }),
    posts,
    forumQueries: new GcsForumQueries({ db, cache, permissions, settings, readMarkers, follows, reactions, polls }),
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
    social,
    achievements,
    membership,
    promotions,
  };
  registerAppJobs(services);
  return services;
}

/** Închide conexiunile (oprirea worker-ului, resetarea după instalare). */
export async function closeGcsServices(s: GcsServices): Promise<void> {
  await s.jobs.close().catch(() => {});
  await s.db.$disconnect().catch(() => {});
  s.redis.disconnect();
}
