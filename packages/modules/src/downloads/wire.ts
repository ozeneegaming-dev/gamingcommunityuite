import os from "node:os";
import path from "node:path";
import type {
  GcsAcpRoleService,
  GcsActor,
  GcsActorResolver,
  GcsAppService,
  GcsAttachmentService,
  GcsCache,
  GcsEventBus,
  GcsFileStore,
  GcsFollowService,
  GcsJobQueue,
  GcsModuleRegistry,
  GcsNotificationService,
  GcsPermissionService,
  GcsRateLimiter,
  GcsSettingsService,
} from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsPostService } from "../forums/posts";
import type { GcsTopicService } from "../forums/topics";
import { GcsDownloadAccess } from "./access";
import { GcsDownloadAdmin } from "./admin";
import { registerDownloadNotifications } from "./notify";
import { GcsDownloadQueries } from "./queries";
import { GcsClamdScanner, parseScannerAddress, type GcsVirusScanner } from "./scanner";
import { GcsDownloadService, type GcsDownloadTopicHooks } from "./service";
import { DOWNLOAD_CATEGORY_IMAGE, DOWNLOAD_SCREENSHOT, DOWNLOAD_WATERMARK, downloadFileHref } from "./text";
import { GcsDownloadUploads } from "./uploads";

/** Serviciile aplicației Descărcări, legate între ele (un singur câmp în `GcsServices`). */
export type GcsDownloads = {
  access: GcsDownloadAccess;
  service: GcsDownloadService;
  uploads: GcsDownloadUploads;
  queries: GcsDownloadQueries;
  admin: GcsDownloadAdmin;
};

export type GcsDownloadsDeps = {
  db: PrismaClient;
  cache: GcsCache;
  bus: GcsEventBus;
  settings: GcsSettingsService;
  permissions: GcsPermissionService;
  acp: GcsAcpRoleService;
  apps: GcsAppService;
  registry: GcsModuleRegistry;
  attachments: GcsAttachmentService;
  files: GcsFileStore;
  jobs: GcsJobQueue;
  actors: GcsActorResolver;
  rateLimiter: GcsRateLimiter;
  follows: GcsFollowService;
  notifications: GcsNotificationService;
  topics: GcsTopicService;
  posts: GcsPostService;
  edition: "vps" | "lite";
  configDir: string;
  secret: () => string;
  /** Testele dau un antivirus fals. */
  scanner?: (address: string) => GcsVirusScanner;
};

/**
 * Construiește Descărcările: drepturile, încărcările (folderul temporar, folderul de import al staff-ului), serviciul,
 * citirile, ACP-ul, accesul la capturi și imagini, notificările și topicul de suport din forum.
 */
export function createDownloads(d: GcsDownloadsDeps): GcsDownloads {
  const access = new GcsDownloadAccess({ db: d.db, cache: d.cache, permissions: d.permissions, apps: d.apps });
  // Topicul de suport: creat ca autorul fișierului (cu drepturile lui pe forumul ales); șters de sistem.
  const topics: GcsDownloadTopicHooks = {
    create: async (file, opts) => {
      if (!file.authorId) return null;
      const author = await d.actors.forUser(file.authorId, "");
      const base = String((await d.settings.get<string>("site.url")) ?? "").replace(/\/$/, "");
      const href = `${base}${downloadFileHref(file)}`;
      const content = {
        type: "doc",
        content: [
          ...(file.summary ? [{ type: "paragraph", content: [{ type: "text", text: file.summary }] }] : []),
          ...file.fieldsText.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
          ...(/^https?:\/\//.test(href) ? [{ type: "paragraph", content: [{ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }] }] : []),
        ],
      };
      const title = `${opts.prefix ? `${opts.prefix} ` : ""}${file.title}${opts.suffix ? ` ${opts.suffix}` : ""}`.slice(0, 150);
      const created = await d.topics.create(author, { forumId: opts.forumId, title, content });
      return created.topicId;
    },
    remove: async (topicId) => {
      const topic = await d.db.topic.findUnique({ where: { id: topicId }, select: { firstPostId: true } });
      const root = await d.db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } });
      if (!topic?.firstPostId || !root) return;
      const system: GcsActor = { userId: null, groupIds: [root.id], primaryGroupId: root.id, isBanned: false, ip: "" };
      await d.posts.delete(system, topic.firstPostId);
    },
  };
  let uploads: GcsDownloadUploads | null = null;
  const service = new GcsDownloadService({
    db: d.db,
    cache: d.cache,
    bus: d.bus,
    settings: d.settings,
    permissions: d.permissions,
    access,
    attachments: d.attachments,
    files: d.files,
    actors: d.actors,
    rateLimiter: d.rateLimiter,
    uploads: () => uploads!,
    secret: d.secret,
    topics,
  });
  uploads = new GcsDownloadUploads({
    db: d.db,
    files: d.files,
    jobs: d.jobs,
    bus: d.bus,
    settings: d.settings,
    permissions: d.permissions,
    access,
    rateLimiter: d.rateLimiter,
    scanner: d.scanner ?? ((address) => new GcsClamdScanner(parseScannerAddress(address)!)),
    tmpDir: path.join(os.tmpdir(), "gcs-downloads"),
    importDir: process.env.GCS_DOWNLOADS_IMPORT_DIR || path.join(d.configDir, "imports"),
    edition: d.edition,
    onAssetReady: (versionId) => service.settle(versionId),
  });
  const queries = new GcsDownloadQueries({ db: d.db, cache: d.cache, settings: d.settings, permissions: d.permissions, access, follows: d.follows, service, uploads });
  const admin = new GcsDownloadAdmin({ db: d.db, bus: d.bus, acp: d.acp, settings: d.settings, permissions: d.permissions, registry: d.registry, apps: d.apps, jobs: d.jobs, access, service, uploads });

  // Capturile se văd cu fișierul; iconițele și copertele categoriilor sunt publice (ca ale forumurilor).
  d.attachments.registerAccess(DOWNLOAD_SCREENSHOT, (actor, id) => queries.canViewFile(actor, Number(id)));
  d.attachments.registerAccess(DOWNLOAD_CATEGORY_IMAGE, async () => true);
  d.attachments.registerAccess(DOWNLOAD_WATERMARK, async () => true);
  // Un fișier găsit infectat la rescanare blochează versiunea lui.
  d.bus.on("downloads.infected", async (e) => {
    if (e.payload.rescan) await service.quarantineVersionOf(String(e.payload.assetId));
  });
  registerDownloadNotifications({ db: d.db, bus: d.bus, notifications: d.notifications, queries, actors: d.actors, follows: d.follows, acp: d.acp });
  uploads.registerJobs(d.jobs, () => access.appEnabled());
  return { access, service, uploads, queries, admin };
}
