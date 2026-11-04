import { createHmac, timingSafeEqual } from "node:crypto";
import {
  GCS_RICH_FIELDS,
  contentRefs,
  GcsConflict,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  normalizeTag,
  renderRichField,
  watermarkImage,
  writeAudit,
  type GcsActor,
  type GcsActorResolver,
  type GcsAttachmentService,
  type GcsCache,
  type GcsEventBus,
  type GcsFileStore,
  type GcsPermissionService,
  type GcsRateLimiter,
  type GcsRendered,
  type GcsSettingsService,
  type GcsUploadedFile,
} from "@gcs/core";
import { jsonInts, jsonStrings, type DownloadAsset, type Prisma, type PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import type { GcsCategoryRights, GcsCategoryRow, GcsDownloadAccess } from "./access";
import { validateFieldValues, type GcsDownloadFieldDef } from "./fields";
import { readDownloadOptions } from "./options";
import type { GcsDownloadUploads } from "./uploads";
import { DOWNLOAD_FILE_CONTENT, DOWNLOAD_SCREENSHOT, DOWNLOADS_CACHE_TAG, downloadFileHref } from "./text";

type Tx = Prisma.TransactionClient;

export type GcsDownloadSubmitInput = {
  categoryId: number;
  title: string;
  summary?: string;
  description: unknown;
  version?: string;
  changelog?: unknown;
  assetIds: string[];
  screenshotIds?: string[];
  fields?: Record<string, unknown>;
  tags?: string[];
  acceptTerms?: boolean;
};

export type GcsDownloadEditInput = {
  title: string;
  summary?: string;
  description: unknown;
  screenshotIds?: string[];
  fields?: Record<string, unknown>;
  tags?: string[];
};

export type GcsDownloadVersionInput = { version?: string; changelog?: unknown; assetIds: string[]; acceptTerms?: boolean };

/** Ce poate face un modul extern când un fișier e publicat / șters (topicul de suport din forum). */
export type GcsDownloadTopicHooks = {
  create: (file: { id: number; title: string; slug: string; authorId: string | null; summary: string; screenshotUrl: string | null; fieldsText: string[] }, opts: { forumId: number; prefix: string; suffix: string }) => Promise<number | null>;
  remove: (topicId: number) => Promise<void>;
};

const TITLE_MAX = 120;
const SUMMARY_MAX = 300;
const VERSION_MAX = 40;
const MAX_TAGS = 10;
const DESCRIPTION_LIMITS = { maxChars: 20_000, maxImages: 6 };
const CHANGELOG_LIMITS = { maxChars: 5000, maxImages: 0 };
const COMMENT_LIMITS = { maxChars: 5000, maxImages: 2 };
const SUBMIT_LIMIT = { window: 3600, max: 30 };
const COMMENT_LIMIT = { window: 600, max: 20 };
const DOWNLOAD_LIMIT = { window: 3600, max: 300 };
const TOKEN_TTL_SEC = 3600;

const CONTENT_RENDER = GCS_RICH_FIELDS.downloadText;

/**
 * Descărcările (aplicația standard `downloads`, specul 2026-11-03-descarcari): trimiterea unui fișier (cu versiunea,
 * capturile, câmpurile suplimentare, etichetele), versiunile noi, decizia de după verificare (antivirus → coada de
 * aprobare sau publicare), moderarea staff-ului, descărcarea (drepturile categoriei, VIP, fără linkuri directe), logul,
 * recenziile și comentariile. Fiecare schimbare emite un eveniment (notificările, cache-ul paginilor).
 */
export class GcsDownloadService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      access: GcsDownloadAccess;
      attachments: GcsAttachmentService;
      files: GcsFileStore;
      actors: GcsActorResolver;
      rateLimiter: GcsRateLimiter;
      uploads: () => GcsDownloadUploads;
      secret: () => string;
      topics?: GcsDownloadTopicHooks | null;
    },
  ) {}

  private async changed(fileIds: number[], extra: string[] = []): Promise<void> {
    await this.deps.bus.emit({ name: "downloads.updated", payload: { fileIds }, tags: [DOWNLOADS_CACHE_TAG, ...fileIds.map((id) => `downloads:file:${id}`), ...extra] });
  }

  private async requireApp(actor: GcsActor): Promise<void> {
    if (!(await this.deps.access.canUseApp(actor))) throw new GcsNotFound();
  }

  private render(raw: unknown, field: string, limits: { maxChars: number; maxImages: number }): GcsRendered {
    return renderRichField(raw, CONTENT_RENDER, { ...limits, field });
  }

  private optionalRender(raw: unknown, field: string, limits: { maxChars: number; maxImages: number }): GcsRendered | null {
    if (raw === undefined || raw === null || raw === "") return null;
    try {
      return this.render(raw, field, limits);
    } catch (error) {
      if (error instanceof GcsValidationError && error.fields[field] === "required") return null;
      throw error;
    }
  }

  private cleanTitle(raw: string): string {
    const title = raw.replace(/\s+/g, " ").trim();
    if (title.length < 3) throw new GcsValidationError({ title: "too_short" });
    if (title.length > TITLE_MAX) throw new GcsValidationError({ title: "too_long" }, { max: String(TITLE_MAX) });
    return title;
  }

  private cleanVersion(raw: string | undefined, mode: GcsCategoryRow["options"]["versioning"]): string {
    const v = (raw ?? "").replace(/\s+/g, " ").trim();
    if (mode === "off") return "";
    if (!v && mode === "required") throw new GcsValidationError({ version: "required" });
    if (v.length > VERSION_MAX) throw new GcsValidationError({ version: "too_long" });
    return v;
  }

  private cleanTags(raw: string[] | undefined, category: GcsCategoryRow): string[] {
    if (!raw || raw.length === 0) return [];
    if (!category.options.tags) throw new GcsValidationError({ tags: "disabled" });
    const tags = [...new Set(raw.map((t) => normalizeTag(t)))];
    if (tags.includes(null)) throw new GcsValidationError({ tags: "invalid" });
    if (tags.length > MAX_TAGS) throw new GcsValidationError({ tags: "too_many" }, { max: String(MAX_TAGS) });
    return tags as string[];
  }

  /** Câmpurile suplimentare activate în categorie. */
  private async categoryFields(category: GcsCategoryRow): Promise<GcsDownloadFieldDef[]> {
    if (category.fieldIds.length === 0) return [];
    const rows = await this.deps.db.downloadField.findMany({ where: { id: { in: category.fieldIds } }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows.map((f) => ({ ...f, options: jsonStrings(f.options), viewGroups: jsonInts(f.viewGroups), editGroups: jsonInts(f.editGroups) }));
  }

  /** Fișierele încărcate de actor pentru această trimitere: ale lui, nelegate, din aceeași categorie, fără eșecuri. */
  private async freshAssets(actor: GcsActor, ids: string[], categoryId: number): Promise<DownloadAsset[]> {
    const unique = [...new Set(ids)].filter((id) => /^[a-z0-9]{8,40}$/i.test(id));
    if (unique.length === 0) throw new GcsValidationError({ files: "required" });
    const rows = await this.deps.db.downloadAsset.findMany({ where: { id: { in: unique }, uploaderId: actor.userId, versionId: null } });
    if (rows.length !== unique.length || rows.some((r) => r.categoryId !== categoryId)) throw new GcsValidationError({ files: "invalid" });
    const failed = rows.find((r) => r.state === "FAILED");
    if (failed) throw new GcsValidationError({ files: failed.error ?? "failed" }, { name: failed.name });
    if (rows.some((r) => r.state === "UPLOADING")) throw new GcsValidationError({ files: "incomplete" });
    return unique.map((id) => rows.find((r) => r.id === id)!);
  }

  private async checkScreenshots(actor: GcsActor, ids: string[] | undefined, category: GcsCategoryRow, fileId: number | null): Promise<string[]> {
    const list = [...new Set(ids ?? [])].filter((id) => /^[A-Za-z0-9_-]{1,40}$/.test(id));
    if (list.length > 0 && !category.options.screenshots) throw new GcsValidationError({ screenshots: "disabled" });
    if (list.length > category.options.maxScreenshots) throw new GcsValidationError({ screenshots: "too_many" }, { max: String(category.options.maxScreenshots) });
    if (category.options.screenshots && category.options.requireScreenshots && list.length === 0) throw new GcsValidationError({ screenshots: "required" });
    if (list.length === 0) return [];
    const rows = await this.deps.db.attachment.findMany({ where: { id: { in: list } }, select: { id: true, ownerId: true, contentType: true, contentId: true, mime: true } });
    const ok =
      rows.length === list.length &&
      rows.every((r) => r.mime.startsWith("image/") && ((r.contentType === null && r.ownerId === actor.userId) || (fileId !== null && r.contentType === DOWNLOAD_SCREENSHOT && r.contentId === String(fileId))));
    if (!ok) throw new GcsValidationError({ screenshots: "invalid" });
    return list;
  }

  private checkTerms(category: GcsCategoryRow, accepted: boolean | undefined): void {
    const terms = category.options.submitTerms.trim();
    if (terms && !accepted) throw new GcsValidationError({ terms: "required" });
  }

  private mentionsEvent(rendered: GcsRendered | null, authorId: string, kind: "file" | "comment" | "review", fileId: number, refId: number) {
    const userIds = (rendered?.mentions ?? []).filter((id) => id !== authorId);
    return userIds.length > 0 ? this.deps.bus.emit({ name: "downloads.mentioned", payload: { userIds, authorId, kind, fileId, refId } }) : Promise.resolve();
  }

  /**
   * Trimite un fișier nou: titlul, rezumatul, descrierea (editorul, cu mențiuni), versiunea și lista schimbărilor,
   * fișierele încărcate (cel puțin unul), capturile, câmpurile, etichetele și termenii categoriei. Fișierul începe
   * „în verificare”; starea finală o dă `settle` după antivirus (coada de aprobare sau publicat).
   */
  async submit(actor: GcsActor, input: GcsDownloadSubmitInput): Promise<{ fileId: number; status: string; href: string }> {
    const { db, access, rateLimiter } = this.deps;
    await this.requireApp(actor);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const category = await access.category(input.categoryId);
    if (!category) throw new GcsValidationError({ categoryId: "invalid_choice" });
    const rights = await access.rights(actor, category.id);
    if (!rights.upload) throw new GcsForbidden({ permission: "downloads.upload" });
    this.checkTerms(category, input.acceptTerms);
    const title = this.cleanTitle(input.title);
    const summary = (input.summary ?? "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX);
    const description = this.render(input.description, "description", DESCRIPTION_LIMITS);
    const version = this.cleanVersion(input.version, category.options.versioning);
    const changelog = this.optionalRender(input.changelog, "changelog", CHANGELOG_LIMITS);
    if (category.options.requireChangelog && category.options.versioning !== "off" && !changelog) throw new GcsValidationError({ changelog: "required" });
    const tags = this.cleanTags(input.tags, category);
    const fields = validateFieldValues(await this.categoryFields(category), input.fields ?? {}, actor.groupIds, {});
    const assets = await this.freshAssets(actor, input.assetIds, category.id);
    if (assets.length > 1 && !category.options.multipleFiles) throw new GcsValidationError({ files: "single" });
    const screenshots = await this.checkScreenshots(actor, input.screenshotIds, category, null);
    const limit = await rateLimiter.consume(`downloads:submit:${actor.userId}`, SUBMIT_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });

    const file = await db.$transaction(async (tx) => {
      const created = await tx.downloadFile.create({
        data: {
          categoryId: category.id,
          authorId: actor.userId,
          title,
          slug: slugify(title),
          summary,
          descriptionJson: description.json as Prisma.InputJsonValue,
          descriptionHtml: description.html,
          status: "SCANNING",
          version,
          fields: fields as Prisma.InputJsonValue,
          tags,
          screenshotIds: screenshots,
        },
      });
      const v = await tx.downloadVersion.create({
        data: { fileId: created.id, label: version, changelogJson: (changelog?.json ?? undefined) as Prisma.InputJsonValue | undefined, changelogHtml: changelog?.html ?? "", status: "SCANNING", createdById: actor.userId },
      });
      for (const [i, a] of assets.entries()) await tx.downloadAsset.update({ where: { id: a.id }, data: { fileId: created.id, versionId: v.id, position: i } });
      if (screenshots.length > 0) await this.deps.attachments.attach(tx, screenshots, { contentType: DOWNLOAD_SCREENSHOT, contentId: String(created.id), ownerId: actor.userId! });
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.submit", targetType: "download", targetId: String(created.id), after: { title, categoryId: category.id, version }, ip: actor.ip });
      return { ...created, versionId: v.id };
    });
    await this.deps.bus.emit({ name: "downloads.submitted", payload: { fileId: file.id, authorId: actor.userId, categoryId: category.id } });
    await this.settle(file.versionId);
    const fresh = await db.downloadFile.findUnique({ where: { id: file.id }, select: { status: true } });
    return { fileId: file.id, status: (fresh?.status ?? "SCANNING").toLowerCase(), href: downloadFileHref(file) };
  }

  /**
   * Trimiterea în bloc (dreptul de grup `downloads.bulk`): fiecare fișier încărcat devine o intrare separată, cu titlul
   * din numele fișierului și aceeași descriere. Restul se completează apoi pe fiecare intrare.
   */
  async submitMany(actor: GcsActor, input: { categoryId: number; description: unknown; assetIds: string[]; acceptTerms?: boolean }): Promise<{ fileIds: number[] }> {
    if (!(await this.deps.permissions.can(actor, "downloads.bulk"))) throw new GcsForbidden({ permission: "downloads.bulk" });
    const ids = [...new Set(input.assetIds)].slice(0, 50);
    if (ids.length === 0) throw new GcsValidationError({ files: "required" });
    const rows = await this.deps.db.downloadAsset.findMany({ where: { id: { in: ids }, uploaderId: actor.userId ?? "" }, select: { id: true, name: true } });
    const out: number[] = [];
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new GcsValidationError({ files: "invalid" });
      const title = row.name.replace(/\.[A-Za-z0-9]{1,12}$/, "").replace(/[_-]+/g, " ").trim().padEnd(3, ".");
      const { fileId } = await this.submit(actor, { categoryId: input.categoryId, title, description: input.description, assetIds: [id], ...(input.acceptTerms !== undefined ? { acceptTerms: input.acceptTerms } : {}) });
      out.push(fileId);
    }
    return { fileIds: out };
  }

  /** Autorul (sau staff-ul) și drepturile lui pe fișier. */
  private async fileForEdit(actor: GcsActor, fileId: number) {
    const { db, access } = this.deps;
    await this.requireApp(actor);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const file = Number.isInteger(fileId) ? await db.downloadFile.findUnique({ where: { id: fileId } }) : null;
    if (!file) throw new GcsNotFound();
    const rights = await access.rights(actor, file.categoryId);
    const own = file.authorId === actor.userId;
    if (!own && !rights.moderate) throw new GcsForbidden({ permission: "downloads.moderate" });
    if (own && !rights.moderate && (file.status === "QUARANTINED" || file.status === "HIDDEN")) throw new GcsForbidden({ reason: "locked" });
    const category = await access.category(file.categoryId);
    if (!category) throw new GcsNotFound();
    return { file, rights, category, own };
  }

  /** O versiune nouă (autorul sau staff-ul): fișierele ei trec prin verificare și, după categorie, prin aprobare. */
  async addVersion(actor: GcsActor, fileId: number, input: GcsDownloadVersionInput): Promise<{ versionId: number; status: string }> {
    const { db } = this.deps;
    const { file, category } = await this.fileForEdit(actor, fileId);
    if (category.options.versioning === "off" && file.versionId !== null) {
      // Fără versiuni: o „versiune nouă” înlocuiește fișierele, tot prin verificare.
    }
    this.checkTerms(category, input.acceptTerms);
    if (await db.downloadVersion.count({ where: { fileId: file.id, status: { in: ["SCANNING", "PENDING"] } } })) throw new GcsConflict({ reason: "version_pending" });
    const label = this.cleanVersion(input.version, category.options.versioning);
    if (label && label === file.version) throw new GcsValidationError({ version: "same" });
    const changelog = this.optionalRender(input.changelog, "changelog", CHANGELOG_LIMITS);
    if (category.options.requireChangelog && category.options.versioning !== "off" && !changelog) throw new GcsValidationError({ changelog: "required" });
    const assets = await this.freshAssets(actor, input.assetIds, category.id);
    if (assets.length > 1 && !category.options.multipleFiles) throw new GcsValidationError({ files: "single" });
    const v = await db.$transaction(async (tx) => {
      const created = await tx.downloadVersion.create({
        data: { fileId: file.id, label, changelogJson: (changelog?.json ?? undefined) as Prisma.InputJsonValue | undefined, changelogHtml: changelog?.html ?? "", status: "SCANNING", createdById: actor.userId },
      });
      for (const [i, a] of assets.entries()) await tx.downloadAsset.update({ where: { id: a.id }, data: { fileId: file.id, versionId: created.id, position: i } });
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.version", targetType: "download", targetId: String(file.id), after: { versionId: created.id, label }, ip: actor.ip });
      return created;
    });
    await this.settle(v.id);
    const fresh = await db.downloadVersion.findUnique({ where: { id: v.id }, select: { status: true } });
    return { versionId: v.id, status: (fresh?.status ?? "SCANNING").toLowerCase() };
  }

  /** Editează detaliile (titlul, rezumatul, descrierea, capturile, câmpurile, etichetele); fișierele se schimbă prin versiuni. */
  async edit(actor: GcsActor, fileId: number, input: GcsDownloadEditInput): Promise<void> {
    const { db } = this.deps;
    const { file, category } = await this.fileForEdit(actor, fileId);
    const title = this.cleanTitle(input.title);
    const summary = (input.summary ?? "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX);
    const description = this.render(input.description, "description", DESCRIPTION_LIMITS);
    const tags = this.cleanTags(input.tags, category);
    const fields = validateFieldValues(await this.categoryFields(category), input.fields ?? {}, actor.groupIds, (file.fields ?? {}) as Record<string, unknown>);
    const screenshots = input.screenshotIds === undefined ? jsonStrings(file.screenshotIds) : await this.checkScreenshots(actor, input.screenshotIds, category, file.id);
    const removed = jsonStrings(file.screenshotIds).filter((id) => !screenshots.includes(id));
    await db.$transaction(async (tx) => {
      await tx.downloadFile.update({
        where: { id: file.id },
        data: { title, slug: slugify(title), summary, descriptionJson: description.json as Prisma.InputJsonValue, descriptionHtml: description.html, tags, fields: fields as Prisma.InputJsonValue, screenshotIds: screenshots },
      });
      const fresh = screenshots.filter((id) => !jsonStrings(file.screenshotIds).includes(id));
      if (fresh.length > 0) await this.deps.attachments.attach(tx, fresh, { contentType: DOWNLOAD_SCREENSHOT, contentId: String(file.id), ownerId: actor.userId! });
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.edit", targetType: "download", targetId: String(file.id), before: { title: file.title }, after: { title }, ip: actor.ip });
    });
    if (removed.length > 0) await this.deps.attachments.removeAny(removed).catch(() => 0);
    await this.changed([file.id]);
  }

  /**
   * O captură de ecran: imaginea trece prin încărcarea obișnuită (tipul real, recodarea, limita grupului), apoi, dacă
   * e setat, primește watermark-ul site-ului. Rămâne nelegată până la salvarea formularului.
   */
  async uploadScreenshot(actor: GcsActor, input: { categoryId: number; fileId?: number | null }, file: GcsUploadedFile): Promise<{ id: string; url: string }> {
    const { access, attachments, db, files, settings } = this.deps;
    await this.requireApp(actor);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    let category: GcsCategoryRow | null;
    if (input.fileId) category = (await this.fileForEdit(actor, input.fileId)).category;
    else {
      category = await access.category(input.categoryId);
      if (!category) throw new GcsValidationError({ categoryId: "invalid_choice" });
      if (!(await access.rights(actor, category.id)).upload) throw new GcsForbidden({ permission: "downloads.upload" });
    }
    if (!category.options.screenshots) throw new GcsValidationError({ file: "disabled" });
    if (category.options.screenshotMaxKb > 0 && file.bytes.length > category.options.screenshotMaxKb * 1024) {
      throw new GcsValidationError({ file: "too_large" }, { maxKb: String(category.options.screenshotMaxKb) });
    }
    const info = await attachments.upload(actor, file, { permission: "downloads.app_access" });
    if (!info.isImage) {
      await attachments.discard([info.id]).catch(() => {});
      throw new GcsValidationError({ file: "not_image" });
    }
    const opts = await readDownloadOptions(settings);
    if (opts.watermark.id) {
      const [shot, mark] = await Promise.all([
        db.attachment.findUnique({ where: { id: info.id }, select: { storageKey: true, mime: true } }),
        db.attachment.findUnique({ where: { id: opts.watermark.id }, select: { storageKey: true } }),
      ]);
      const [shotFile, markFile] = await Promise.all([shot ? files.get(shot.storageKey) : null, mark ? files.get(mark.storageKey) : null]);
      if (shot && shotFile && markFile) {
        const marked = await watermarkImage(await streamBuffer(shotFile.body), await streamBuffer(markFile.body), { position: opts.watermark.position, opacity: opts.watermark.opacity });
        if (marked) {
          await files.put(shot.storageKey, marked, shot.mime);
          await db.attachment.update({ where: { id: info.id }, data: { size: marked.length } });
        }
      }
    }
    return { id: info.id, url: info.url };
  }

  // ─── Verificarea și aprobarea ─────────────────────────────────────────────────────────────────────────────

  /**
   * Starea unei versiuni după ce toate fișierele ei au fost procesate (idempotent; doar din `SCANNING`): un fișier eșuat
   * → respinsă; unul infectat → carantină (autorul anunțat, staff-ul alertat); o eroare a antivirusului → după setare
   * (coada de aprobare sau blocată); altfel coada de aprobare (categoria cere aprobare și autorul nu e scutit) sau publicată.
   */
  async settle(versionId: number): Promise<void> {
    const { db, access, actors, permissions } = this.deps;
    const v = await db.downloadVersion.findUnique({ where: { id: versionId }, include: { assets: true, file: true } });
    if (!v || v.status !== "SCANNING") return;
    if (v.assets.some((a) => a.state === "UPLOADING" || a.state === "RECEIVED")) return;
    const first = v.file.versionId === null;
    const category = await access.category(v.file.categoryId);
    const size = v.assets.reduce((sum, a) => sum + Number(a.size), 0);
    const failed = v.assets.find((a) => a.state === "FAILED");
    const infected = v.assets.find((a) => a.scanStatus === "INFECTED");
    const scanError = v.assets.find((a) => a.scanStatus === "ERROR");
    const opts = await readDownloadOptions(this.deps.settings);
    let status: "REJECTED" | "QUARANTINED" | "PENDING" | "APPROVED";
    let reason: string | null = null;
    if (infected) {
      status = "QUARANTINED";
      reason = infected.scanResult ?? "infected";
    } else if (failed) {
      status = "REJECTED";
      reason = failed.error ?? "file_check";
    } else if (scanError && opts.av.onError === "block") {
      status = "REJECTED";
      reason = "scan_error";
    } else {
      const author = v.createdById ? await actors.forUser(v.createdById, "") : null;
      const skip = author ? (await permissions.can(author, "downloads.skip_approval")) || (await access.isModerator(author)) : false;
      status = category?.options.approval !== false && !skip ? "PENDING" : "APPROVED";
      if (scanError) status = "PENDING";
    }
    const claimed = await db.downloadVersion.updateMany({ where: { id: v.id, status: "SCANNING" }, data: { status: status === "APPROVED" ? "PENDING" : status, size: BigInt(size), rejectReason: reason } });
    if (claimed.count === 0) return;
    if (first && status !== "APPROVED") await db.downloadFile.update({ where: { id: v.fileId }, data: { status, rejectReason: reason } });
    if (status === "APPROVED") {
      await this.publish(v.id, null);
      return;
    }
    const kind = status === "PENDING" ? "queued" : status === "QUARANTINED" ? "blocked" : "rejected";
    await this.deps.bus.emit({ name: "downloads.reviewed", payload: { fileId: v.fileId, versionId: v.id, authorId: v.createdById, kind, reason, first, title: v.file.title } });
    await this.changed([v.fileId]);
  }

  /** Publică o versiune (aprobată de staff sau fără aprobare): devine versiunea curentă; cele vechi, după categorie. */
  private async publish(versionId: number, approverId: string | null): Promise<void> {
    const { db, access } = this.deps;
    const v = await db.downloadVersion.findUnique({ where: { id: versionId }, include: { assets: true, file: true } });
    if (!v) return;
    const first = v.file.status !== "APPROVED" && v.file.status !== "HIDDEN";
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.downloadVersion.update({ where: { id: v.id }, data: { status: "APPROVED", approvedAt: now, rejectReason: null } });
      await tx.downloadFile.update({
        where: { id: v.fileId },
        data: {
          versionId: v.id,
          version: v.label,
          size: BigInt(v.assets.reduce((s, a) => s + Number(a.size), 0)),
          filesCount: v.assets.length,
          publishedAt: now,
          ...(first ? { status: "APPROVED", approvedAt: now, approvedById: approverId, rejectReason: null } : {}),
        },
      });
      await this.recountCategory(tx, v.file.categoryId);
    });
    const category = await access.category(v.file.categoryId);
    await this.pruneVersions(v.fileId, category);
    if (first && category?.options.forumTopic.enabled && this.deps.topics && v.file.topicId === null) {
      const topicId = await this.deps.topics
        .create(
          { id: v.file.id, title: v.file.title, slug: v.file.slug, authorId: v.file.authorId, summary: v.file.summary, screenshotUrl: jsonStrings(v.file.screenshotIds)[0] ? `/files/${jsonStrings(v.file.screenshotIds)[0]}` : null, fieldsText: [] },
          { forumId: category.options.forumTopic.forumId, prefix: category.options.forumTopic.prefix, suffix: category.options.forumTopic.suffix },
        )
        .catch(() => null);
      if (topicId) await db.downloadFile.update({ where: { id: v.fileId }, data: { topicId } });
    }
    if (first) {
      const desc = v.file.descriptionJson ? { mentions: contentRefs(v.file.descriptionJson).mentions } : null;
      if (v.file.authorId && desc) await this.mentionsEvent(desc as GcsRendered, v.file.authorId, "file", v.fileId, v.fileId);
    }
    await this.deps.bus.emit({ name: "downloads.published", payload: { fileId: v.fileId, versionId: v.id, authorId: v.file.authorId, first, approverId, categoryId: v.file.categoryId, title: v.file.title, label: v.label } });
    await this.changed([v.fileId]);
  }

  /** Versiunile vechi peste limita categoriei (sau toate, fără păstrare) dispar, cu fișierele lor. */
  private async pruneVersions(fileId: number, category: GcsCategoryRow | null): Promise<void> {
    if (!category) return;
    const { db } = this.deps;
    const file = await db.downloadFile.findUnique({ where: { id: fileId }, select: { versionId: true } });
    const old = await db.downloadVersion.findMany({ where: { fileId, status: "APPROVED", id: { not: file?.versionId ?? 0 } }, orderBy: { createdAt: "desc" }, include: { assets: true } });
    const keep = !category.options.keepVersions ? 0 : category.options.versionsToKeep === 0 ? old.length : category.options.versionsToKeep;
    for (const v of old.slice(keep)) await this.dropVersion(v);
  }

  private async dropVersion(v: { id: number; assets: DownloadAsset[] }): Promise<void> {
    for (const a of v.assets) await this.deps.uploads().removeAsset(a);
    await this.deps.db.downloadVersion.deleteMany({ where: { id: v.id } });
  }

  private async recountCategory(tx: Tx, categoryId: number): Promise<void> {
    const [count, last] = await Promise.all([
      tx.downloadFile.count({ where: { categoryId, status: "APPROVED" } }),
      tx.downloadFile.findFirst({ where: { categoryId, status: "APPROVED" }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
    ]);
    await tx.downloadCategory.update({ where: { id: categoryId }, data: { filesCount: count, lastFileAt: last?.publishedAt ?? null } });
  }

  private async moderator(actor: GcsActor, categoryId: number): Promise<GcsCategoryRights> {
    await this.requireApp(actor);
    const rights = await this.deps.access.rights(actor, categoryId);
    if (!rights.moderate) throw new GcsForbidden({ permission: "downloads.moderate" });
    return rights;
  }

  /** Staff: aprobă o versiune din coadă (sau una blocată greșit de verificare). */
  async approve(actor: GcsActor, versionId: number): Promise<void> {
    const { db } = this.deps;
    const v = await db.downloadVersion.findUnique({ where: { id: versionId }, include: { file: { select: { categoryId: true } }, assets: { select: { scanStatus: true } } } });
    if (!v) throw new GcsNotFound();
    await this.moderator(actor, v.file.categoryId);
    if (v.status === "APPROVED") return;
    if (v.status === "SCANNING") throw new GcsConflict({ reason: "scanning" });
    if (v.assets.some((a) => a.scanStatus === "INFECTED")) throw new GcsConflict({ reason: "infected" });
    await writeAudit(db, { actorId: actor.userId, action: "downloads.approve", targetType: "download", targetId: String(v.fileId), after: { versionId }, ip: actor.ip });
    await this.publish(v.id, actor.userId);
  }

  /** Staff: respinge o versiune (cu motivul, trimis autorului). Fișierele ei se șterg. */
  async reject(actor: GcsActor, versionId: number, reason: string): Promise<void> {
    const { db } = this.deps;
    const v = await db.downloadVersion.findUnique({ where: { id: versionId }, include: { file: true, assets: true } });
    if (!v) throw new GcsNotFound();
    await this.moderator(actor, v.file.categoryId);
    if (v.status === "APPROVED") throw new GcsConflict({ reason: "approved" });
    const why = reason.replace(/\s+/g, " ").trim().slice(0, 500);
    const first = v.file.versionId === null;
    await db.$transaction(async (tx) => {
      await tx.downloadVersion.update({ where: { id: v.id }, data: { status: "REJECTED", rejectReason: why || null } });
      if (first) await tx.downloadFile.update({ where: { id: v.fileId }, data: { status: "REJECTED", rejectReason: why || null } });
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.reject", targetType: "download", targetId: String(v.fileId), after: { versionId, reason: why }, ip: actor.ip });
    });
    for (const a of v.assets.filter((x) => x.scanStatus !== "INFECTED")) await this.deps.uploads().removeAsset(a);
    await this.deps.bus.emit({ name: "downloads.reviewed", payload: { fileId: v.fileId, versionId: v.id, authorId: v.createdById, kind: "rejected", reason: why, first, title: v.file.title } });
    await this.changed([v.fileId]);
  }

  /** Staff: recomandat (caseta „Recomandate”), ascuns / afișat, comentarii închise. */
  async setFlags(actor: GcsActor, fileId: number, flags: { featured?: boolean; hidden?: boolean; commentsLocked?: boolean; vipOnly?: boolean }): Promise<void> {
    const { db } = this.deps;
    const file = await db.downloadFile.findUnique({ where: { id: fileId } });
    if (!file) throw new GcsNotFound();
    await this.moderator(actor, file.categoryId);
    const data: Prisma.DownloadFileUpdateInput = {};
    if (flags.featured !== undefined) data.featured = flags.featured;
    if (flags.commentsLocked !== undefined) data.commentsLocked = flags.commentsLocked;
    if (flags.vipOnly !== undefined) data.vipOnly = flags.vipOnly;
    if (flags.hidden !== undefined) {
      if (flags.hidden && file.status === "APPROVED") data.status = "HIDDEN";
      else if (!flags.hidden && file.status === "HIDDEN") data.status = "APPROVED";
    }
    await db.$transaction(async (tx) => {
      await tx.downloadFile.update({ where: { id: fileId }, data });
      if (data.status) await this.recountCategory(tx, file.categoryId);
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.flags", targetType: "download", targetId: String(fileId), before: { featured: file.featured, status: file.status, commentsLocked: file.commentsLocked, vipOnly: file.vipOnly }, after: flags, ip: actor.ip });
    });
    await this.changed([fileId]);
  }

  /** Staff: mută fișierul în altă categorie (contoarele ambelor se refac). */
  async move(actor: GcsActor, fileId: number, categoryId: number): Promise<void> {
    const { db, access } = this.deps;
    const file = await db.downloadFile.findUnique({ where: { id: fileId } });
    if (!file) throw new GcsNotFound();
    await this.moderator(actor, file.categoryId);
    const target = await access.category(categoryId);
    if (!target) throw new GcsValidationError({ categoryId: "invalid_choice" });
    if (target.id === file.categoryId) return;
    await db.$transaction(async (tx) => {
      await tx.downloadFile.update({ where: { id: fileId }, data: { categoryId: target.id } });
      await tx.downloadAsset.updateMany({ where: { fileId }, data: { categoryId: target.id } });
      await this.recountCategory(tx, file.categoryId);
      await this.recountCategory(tx, target.id);
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.move", targetType: "download", targetId: String(fileId), before: { categoryId: file.categoryId }, after: { categoryId: target.id }, ip: actor.ip });
    });
    await this.changed([fileId]);
  }

  /** Șterge un fișier (autorul, cât timp nu e publicat, sau staff-ul): versiunile, fișierele, capturile, topicul ales. */
  async remove(actor: GcsActor, fileId: number): Promise<void> {
    const { db, access } = this.deps;
    await this.requireApp(actor);
    const file = await db.downloadFile.findUnique({ where: { id: fileId }, include: { versions: { include: { assets: true } } } });
    if (!file) throw new GcsNotFound();
    const rights = await access.rights(actor, file.categoryId);
    const ownDraft = file.authorId === actor.userId && file.status !== "APPROVED" && file.status !== "HIDDEN" && file.status !== "QUARANTINED";
    if (!rights.moderate && !ownDraft) throw new GcsForbidden({ permission: "downloads.moderate" });
    await this.purge(file, actor);
  }

  /** Ștergerea propriu-zisă (și pentru ștergerea unei categorii cu tot conținutul). */
  async purge(file: { id: number; categoryId: number; title: string; topicId: number | null; versions: { id: number; assets: DownloadAsset[] }[] }, actor: GcsActor | null): Promise<void> {
    const { db, access } = this.deps;
    for (const v of file.versions) for (const a of v.assets) await this.deps.uploads().removeAsset(a);
    const loose = await db.downloadAsset.findMany({ where: { fileId: file.id } });
    for (const a of loose) await this.deps.uploads().removeAsset(a);
    await this.deps.attachments.deleteFor(DOWNLOAD_SCREENSHOT, [String(file.id)]).catch(() => {});
    const category = await access.category(file.categoryId);
    await db.$transaction(async (tx) => {
      await tx.follow.deleteMany({ where: { contentType: DOWNLOAD_FILE_CONTENT, contentId: String(file.id) } });
      await tx.downloadFile.delete({ where: { id: file.id } });
      await this.recountCategory(tx, file.categoryId);
      await writeAudit(tx, { actorId: actor?.userId ?? null, action: "downloads.delete", targetType: "download", targetId: String(file.id), before: { title: file.title }, ip: actor?.ip ?? null });
    });
    if (file.topicId && category?.options.forumTopic.deleteWithFile && this.deps.topics) await this.deps.topics.remove(file.topicId).catch(() => {});
    await this.changed([file.id]);
  }

  /** Staff: un fișier blocat greșit de antivirus („fals pozitiv”) iese din carantină; versiunea revine la verificare. */
  async releaseQuarantine(actor: GcsActor, assetId: string): Promise<void> {
    const { db, files } = this.deps;
    const a = await db.downloadAsset.findUnique({ where: { id: assetId }, include: { version: true, file: true } });
    if (!a || a.scanStatus !== "INFECTED" || !a.storageKey) throw new GcsNotFound();
    await this.moderator(actor, a.file?.categoryId ?? a.categoryId ?? 0);
    const stored = await files.get(a.storageKey);
    if (!stored) throw new GcsNotFound();
    const key = a.storageKey.replace("downloads/quarantine/", "downloads/files/");
    await files.put(key, await streamBuffer(stored.body), a.mime);
    await files.delete(a.storageKey).catch(() => {});
    await db.downloadAsset.update({ where: { id: a.id }, data: { storageKey: key, scanStatus: "CLEAN", scanResult: `released:${a.scanResult ?? ""}`.slice(0, 200), scannedAt: new Date() } });
    await writeAudit(db, { actorId: actor.userId, action: "downloads.release", targetType: "download_asset", targetId: a.id, before: { signature: a.scanResult }, ip: actor.ip });
    if (a.version && a.version.status === "QUARANTINED") {
      const others = await db.downloadAsset.count({ where: { versionId: a.version.id, scanStatus: "INFECTED" } });
      if (others === 0) {
        await db.downloadVersion.update({ where: { id: a.version.id }, data: { status: "PENDING", rejectReason: null } });
        if (a.file && a.file.versionId === null) await db.downloadFile.update({ where: { id: a.file.id }, data: { status: "PENDING", rejectReason: null } });
      }
    }
    if (a.fileId) await this.changed([a.fileId]);
  }

  /** O versiune găsită infectată la rescanare: blocată, iar fișierul fără altă versiune curată e ascuns. */
  async quarantineVersionOf(assetId: string): Promise<void> {
    const { db } = this.deps;
    const a = await db.downloadAsset.findUnique({ where: { id: assetId }, include: { version: true, file: true } });
    if (!a?.version || !a.file) return;
    if (a.version.status === "APPROVED" || a.version.status === "PENDING") await db.downloadVersion.update({ where: { id: a.version.id }, data: { status: "QUARANTINED", rejectReason: a.scanResult } });
    if (a.file.versionId === a.version.id && (a.file.status === "APPROVED" || a.file.status === "PENDING")) {
      await db.$transaction(async (tx) => {
        await tx.downloadFile.update({ where: { id: a.file!.id }, data: { status: "QUARANTINED", rejectReason: a.scanResult } });
        await this.recountCategory(tx, a.file!.categoryId);
      });
    }
    await this.changed([a.file.id]);
  }

  // ─── Descărcarea ──────────────────────────────────────────────────────────────────────────────────────────

  /** Tokenul linkului de descărcare (fără linkuri directe): legat de fișier, de membru și de o oră. */
  downloadToken(userId: string, assetId: string, now = Date.now()): string {
    const exp = Math.floor(now / 1000 / 600) * 600 + TOKEN_TTL_SEC;
    const sig = createHmac("sha256", this.deps.secret()).update(`dl|${assetId}|${userId}|${exp}`).digest("base64url").slice(0, 32);
    return `${exp}.${sig}`;
  }

  verifyToken(token: string, userId: string, assetId: string, now = Date.now()): boolean {
    const m = /^(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(token);
    if (!m || Number(m[1]) * 1000 < now) return false;
    const expected = createHmac("sha256", this.deps.secret()).update(`dl|${assetId}|${userId}|${m[1]}`).digest("base64url").slice(0, 32);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]!));
  }

  /**
   * Deschide un fișier pentru descărcare: aplicația, drepturile categoriei (membri logați), VIP-ul, versiunea publicată
   * (autorul și staff-ul văd și ce așteaptă aprobarea), niciodată un fișier infectat, tokenul (fără linkuri directe), o
   * limită pe membru, apoi logul și contoarele. Un link extern întoarce adresa (redirect).
   */
  async open(actor: GcsActor, assetId: string, token: string | null): Promise<{ kind: "stream"; body: ReadableStream<Uint8Array>; size: number; name: string; mime: string } | { kind: "redirect"; url: string }> {
    const { db, access, files, rateLimiter } = this.deps;
    await this.requireApp(actor);
    if (!/^[a-z0-9]{8,40}$/i.test(assetId)) throw new GcsNotFound();
    const a = await db.downloadAsset.findUnique({ where: { id: assetId }, include: { version: true, file: true } });
    if (!a?.file || !a.version || a.state !== "READY" || a.scanStatus === "INFECTED") throw new GcsNotFound();
    const rights = await access.rights(actor, a.file.categoryId);
    if (!rights.view) throw new GcsNotFound();
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const own = a.file.authorId === actor.userId;
    const published = a.version.status === "APPROVED" && a.file.status === "APPROVED";
    if (!published && !own && !rights.moderate) throw new GcsNotFound();
    if (!rights.download && !own) throw new GcsForbidden({ permission: "downloads.download" });
    if ((a.file.vipOnly || (await access.vipCategory(a.file.categoryId))) && !rights.vip && !own) throw new GcsForbidden({ reason: "vip" });
    const opts = await readDownloadOptions(this.deps.settings);
    if (opts.preventDirect && !(token && this.verifyToken(token, actor.userId, a.id))) throw new GcsForbidden({ reason: "token" });
    const limit = await rateLimiter.consume(`downloads:get:${actor.userId}`, DOWNLOAD_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const category = await access.category(a.file.categoryId);
    await db.$transaction(async (tx) => {
      await tx.downloadAsset.update({ where: { id: a.id }, data: { downloads: { increment: 1 } } });
      await tx.downloadVersion.update({ where: { id: a.version!.id }, data: { downloads: { increment: 1 } } });
      await tx.downloadFile.update({ where: { id: a.file!.id }, data: { downloads: { increment: 1 } } });
      if (category?.options.logDownloads !== false) await tx.downloadLog.create({ data: { fileId: a.file!.id, versionId: a.version!.id, assetId: a.id, userId: actor.userId, size: a.size } });
    });
    if (a.source === "LINK" && a.url) return { kind: "redirect", url: a.url };
    if (!a.storageKey) throw new GcsNotFound();
    const stored = await files.get(a.storageKey);
    if (!stored) throw new GcsNotFound();
    return { kind: "stream", body: stored.body, size: stored.size, name: a.name, mime: a.mime };
  }

  // ─── Recenziile și comentariile ───────────────────────────────────────────────────────────────────────────

  private async publishedFile(actor: GcsActor, fileId: number) {
    const { db, access } = this.deps;
    await this.requireApp(actor);
    const file = Number.isInteger(fileId) ? await db.downloadFile.findUnique({ where: { id: fileId } }) : null;
    if (!file || file.status !== "APPROVED") throw new GcsNotFound();
    const rights = await access.rights(actor, file.categoryId);
    if (!rights.view) throw new GcsNotFound();
    const category = await access.category(file.categoryId);
    if (!category) throw new GcsNotFound();
    return { file, rights, category };
  }

  private async recountReviews(tx: Tx, fileId: number): Promise<void> {
    const agg = await tx.downloadReview.aggregate({ where: { fileId, status: "VISIBLE" }, _avg: { rating: true }, _count: { _all: true } });
    await tx.downloadFile.update({ where: { id: fileId }, data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 100) / 100, reviewsCount: agg._count._all } });
  }

  /** O recenzie (una pe membru; a doua oară se actualizează): nota 1–5 și textul; fără recenzii la propriul fișier. */
  async review(actor: GcsActor, fileId: number, input: { rating: number; body: unknown }): Promise<{ id: number; pending: boolean }> {
    const { db, rateLimiter } = this.deps;
    const { file, rights, category } = await this.publishedFile(actor, fileId);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!category.options.reviews) throw new GcsForbidden({ reason: "disabled" });
    if (!rights.review) throw new GcsForbidden({ permission: "downloads.review" });
    if (file.authorId === actor.userId) throw new GcsForbidden({ reason: "own_content" });
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new GcsValidationError({ rating: "invalid_range" });
    if (category.options.reviewNeedsDownload && (await db.downloadLog.count({ where: { fileId, userId: actor.userId } })) === 0) throw new GcsForbidden({ reason: "download_first" });
    const body = this.render(input.body, "body", COMMENT_LIMITS);
    const limit = await rateLimiter.consume(`downloads:comment:${actor.userId}`, COMMENT_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const pending = category.options.reviewsApproval && !rights.moderate;
    const status = pending ? "PENDING" : "VISIBLE";
    const row = await db.$transaction(async (tx) => {
      const saved = await tx.downloadReview.upsert({
        where: { fileId_userId: { fileId, userId: actor.userId! } },
        create: { fileId, userId: actor.userId!, rating: input.rating, bodyJson: body.json as Prisma.InputJsonValue, bodyHtml: body.html, version: file.version, status },
        update: { rating: input.rating, bodyJson: body.json as Prisma.InputJsonValue, bodyHtml: body.html, version: file.version, status },
      });
      await this.recountReviews(tx, fileId);
      return saved;
    });
    if (!pending) {
      await this.deps.bus.emit({ name: "downloads.reviewed_by", payload: { fileId, reviewId: row.id, authorId: file.authorId, userId: actor.userId, rating: input.rating } });
      await this.mentionsEvent(body, actor.userId, "review", fileId, row.id);
    }
    await this.changed([fileId]);
    return { id: row.id, pending };
  }

  /** Un comentariu (cu mențiuni); categoria poate cere aprobarea lor. */
  async comment(actor: GcsActor, fileId: number, raw: unknown): Promise<{ id: number; pending: boolean }> {
    const { db, rateLimiter } = this.deps;
    const { file, rights, category } = await this.publishedFile(actor, fileId);
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (!category.options.comments) throw new GcsForbidden({ reason: "disabled" });
    if (!rights.comment) throw new GcsForbidden({ permission: "downloads.comment" });
    if (file.commentsLocked && !rights.moderate) throw new GcsForbidden({ reason: "locked" });
    const body = this.render(raw, "body", COMMENT_LIMITS);
    const limit = await rateLimiter.consume(`downloads:comment:${actor.userId}`, COMMENT_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const pending = category.options.commentsApproval && !rights.moderate;
    const row = await db.$transaction(async (tx) => {
      const created = await tx.downloadComment.create({ data: { fileId, authorId: actor.userId, bodyJson: body.json as Prisma.InputJsonValue, bodyHtml: body.html, status: pending ? "PENDING" : "VISIBLE" } });
      if (!pending) await tx.downloadFile.update({ where: { id: fileId }, data: { commentsCount: { increment: 1 } } });
      return created;
    });
    if (!pending) {
      await this.deps.bus.emit({ name: "downloads.commented", payload: { fileId, commentId: row.id, authorId: file.authorId, userId: actor.userId } });
      await this.mentionsEvent(body, actor.userId, "comment", fileId, row.id);
    }
    await this.changed([fileId]);
    return { id: row.id, pending };
  }

  /** Editarea unui comentariu (autorul sau staff-ul). */
  async editComment(actor: GcsActor, commentId: number, raw: unknown): Promise<void> {
    const { db, access } = this.deps;
    const c = await db.downloadComment.findUnique({ where: { id: commentId }, include: { file: { select: { categoryId: true } } } });
    if (!c) throw new GcsNotFound();
    const rights = await access.rights(actor, c.file.categoryId);
    if (c.authorId !== actor.userId && !rights.moderate) throw new GcsForbidden({ permission: "downloads.moderate" });
    const body = this.render(raw, "body", COMMENT_LIMITS);
    await db.downloadComment.update({ where: { id: commentId }, data: { bodyJson: body.json as Prisma.InputJsonValue, bodyHtml: body.html } });
    await this.changed([c.fileId]);
  }

  /** Staff: aprobă, ascunde sau șterge un comentariu / o recenzie; autorul își poate șterge propriul comentariu. */
  async moderatePost(actor: GcsActor, kind: "comment" | "review", id: number, action: "approve" | "hide" | "delete"): Promise<void> {
    const { db, access } = this.deps;
    const row = kind === "comment" ? await db.downloadComment.findUnique({ where: { id }, include: { file: { select: { categoryId: true } } } }) : await db.downloadReview.findUnique({ where: { id }, include: { file: { select: { categoryId: true } } } });
    if (!row) throw new GcsNotFound();
    const rights = await access.rights(actor, row.file.categoryId);
    const author = kind === "comment" ? (row as { authorId: string | null }).authorId : (row as { userId: string }).userId;
    const ownDelete = action === "delete" && author === actor.userId && actor.userId !== null;
    if (!rights.moderate && !ownDelete) throw new GcsForbidden({ permission: "downloads.moderate" });
    await db.$transaction(async (tx) => {
      if (kind === "comment") {
        if (action === "delete") await tx.downloadComment.delete({ where: { id } });
        else await tx.downloadComment.update({ where: { id }, data: { status: action === "approve" ? "VISIBLE" : "HIDDEN" } });
        const visible = await tx.downloadComment.count({ where: { fileId: row.fileId, status: "VISIBLE" } });
        await tx.downloadFile.update({ where: { id: row.fileId }, data: { commentsCount: visible } });
      } else {
        if (action === "delete") await tx.downloadReview.delete({ where: { id } });
        else await tx.downloadReview.update({ where: { id }, data: { status: action === "approve" ? "VISIBLE" : "HIDDEN" } });
        await this.recountReviews(tx, row.fileId);
      }
      await writeAudit(tx, { actorId: actor.userId, action: `downloads.${kind}_${action}`, targetType: "download", targetId: String(row.fileId), after: { id }, ip: actor.ip });
    });
    await this.changed([row.fileId]);
  }

  /** Numără o vizualizare a paginii (o dată la 30 de minute pe vizitator). */
  async countView(fileId: number, viewer: string): Promise<void> {
    const { allowed } = await this.deps.rateLimiter.consume(`downloads:view:${fileId}:${viewer}`, { window: 1800, max: 1 });
    if (allowed) await this.deps.db.downloadFile.updateMany({ where: { id: fileId }, data: { views: { increment: 1 } } });
  }
}

async function streamBuffer(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}
