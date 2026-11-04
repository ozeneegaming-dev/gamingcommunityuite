import {
  GCS_RICH_FIELDS,
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  renderRichField,
  settingValueError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAppService,
  type GcsEventBus,
  type GcsJobQueue,
  type GcsModuleRegistry,
  type GcsPermissionService,
  type GcsSettingsService,
} from "@gcs/core";
import { ci, jsonInts, jsonStrings, type Prisma, type PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "../forums/queries";
import { DOWNLOAD_CATEGORY_ACTIONS, type GcsDownloadAccess } from "./access";
import { fieldDefInput } from "./fields";
import { categoryOptions, DOWNLOAD_SETTINGS, readDownloadOptions, type GcsCategoryOptions } from "./options";
import type { GcsVirusScanner } from "./scanner";
import type { GcsDownloadService } from "./service";
import { DOWNLOAD_JOBS, type GcsDownloadUploads } from "./uploads";
import { DOWNLOADS_ACP, DOWNLOADS_CACHE_TAG, DOWNLOADS_CONTAINER, downloadFileHref, type GcsDownloadStatus } from "./text";

type Tx = Prisma.TransactionClient;
const PER_PAGE = 30;
export const GCS_DOWNLOAD_ACP_FILTERS = ["all", "approved", "pending", "scanning", "rejected", "quarantined", "hidden", "featured"] as const;
export type GcsDownloadAcpFilter = (typeof GCS_DOWNLOAD_ACP_FILTERS)[number];

/** Testul standard al antivirusurilor (un șir inofensiv recunoscut de orice motor), compus la rulare. */
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS", "-TEST-FILE!$H+H*"].join("");

export type GcsCategoryInput = {
  name: string;
  description?: unknown;
  parentId: number | null;
  icon?: string;
  iconId?: string | null;
  coverId?: string | null;
  enabled?: boolean;
  vipOnly?: boolean;
  clanId?: number | null;
  options?: Record<string, unknown>;
  fieldIds?: number[];
};

export type GcsDownloadAcpRow = {
  id: number;
  title: string;
  href: string;
  status: GcsDownloadStatus;
  version: string;
  size: number;
  downloads: number;
  featured: boolean;
  vip: boolean;
  createdAt: string;
  author: GcsUserRef | null;
  category: { id: number; name: string };
};

const statusWhere = (f: GcsDownloadAcpFilter): Prisma.DownloadFileWhereInput =>
  f === "all" ? {} : f === "featured" ? { featured: true } : { status: f.toUpperCase() as Prisma.EnumDownloadStatusFilter["equals"] };

/**
 * ACP → Comunitate → Descărcări: categoriile (cu permisiunile pe container, moștenirea, copierea, ordinea), câmpurile
 * suplimentare, setările, coada de aprobare, toate fișierele, antivirusul (starea, testul, carantina) și statisticile.
 */
export class GcsDownloadAdmin {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      acp: GcsAcpRoleService;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      registry: GcsModuleRegistry;
      apps: GcsAppService;
      jobs: GcsJobQueue;
      access: GcsDownloadAccess;
      service: GcsDownloadService;
      uploads: GcsDownloadUploads;
    },
  ) {}

  private async changed(permissions = false): Promise<void> {
    if (permissions) await this.deps.permissions.bumpVersion();
    await this.deps.bus.emit({ name: "downloads.updated", payload: { fileIds: [] }, tags: [DOWNLOADS_CACHE_TAG] });
  }

  private async users(ids: (string | null)[]): Promise<Map<string, GcsUserRef>> {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
    if (unique.length === 0) return new Map();
    return new Map((await this.deps.db.user.findMany({ where: { id: { in: unique } }, select: userRefSelect })).map((u) => [u.id, toRef(u)] as const));
  }

  // ─── Prezentare ───────────────────────────────────────────────────────────────────────────────────────────

  async overview(actor: GcsActor) {
    const { db, acp, uploads } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.overview, "view");
    const [byStatus, downloads, categories, pendingVersions, infected, used, latest, top, scanner] = await Promise.all([
      db.downloadFile.groupBy({ by: ["status"], _count: { _all: true } }),
      db.downloadFile.aggregate({ _sum: { downloads: true } }),
      db.downloadCategory.count(),
      db.downloadVersion.count({ where: { status: "PENDING" } }),
      db.downloadAsset.count({ where: { scanStatus: "INFECTED" } }),
      uploads.siteUsedBytes(),
      db.downloadFile.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { category: { select: { id: true, name: true } } } }),
      db.downloadFile.findMany({ where: { status: "APPROVED" }, orderBy: { downloads: "desc" }, take: 8, include: { category: { select: { id: true, name: true } } } }),
      this.scannerStatus(),
    ]);
    const counts = Object.fromEntries(byStatus.map((r) => [r.status.toLowerCase(), r._count._all])) as Record<string, number>;
    const users = await this.users([...latest, ...top].map((f) => f.authorId));
    const row = (f: (typeof latest)[number]): GcsDownloadAcpRow => this.toRow(f, users);
    const opts = await readDownloadOptions(this.deps.settings);
    return {
      counts,
      downloads: downloads._sum.downloads ?? 0,
      categories,
      pendingVersions,
      infected,
      storage: { used, limit: opts.totalQuotaGb > 0 ? opts.totalQuotaGb * 1024 ** 3 : null },
      latest: latest.map(row),
      top: top.map(row),
      scanner,
    };
  }

  private toRow(f: { id: number; title: string; slug: string; status: string; version: string; size: bigint; downloads: number; featured: boolean; vipOnly: boolean; createdAt: Date; authorId: string | null; category: { id: number; name: string } }, users: Map<string, GcsUserRef>): GcsDownloadAcpRow {
    return {
      id: f.id,
      title: f.title,
      href: downloadFileHref(f),
      status: f.status.toLowerCase() as GcsDownloadStatus,
      version: f.version,
      size: Number(f.size),
      downloads: f.downloads,
      featured: f.featured,
      vip: f.vipOnly,
      createdAt: f.createdAt.toISOString(),
      author: f.authorId ? (users.get(f.authorId) ?? null) : null,
      category: f.category,
    };
  }

  // ─── Categoriile ──────────────────────────────────────────────────────────────────────────────────────────

  /** Toate categoriile (arborele în ordine), cu numărul de fișiere și dacă își moștenesc permisiunile. */
  async categories(actor: GcsActor) {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.categories, "view");
    const [rows, inherit, clans] = await Promise.all([
      db.downloadCategory.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }),
      db.containerInherit.findMany({ where: { containerType: DOWNLOADS_CONTAINER }, select: { containerId: true, inherits: true } }),
      db.clan.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, tag: true, name: true } }),
    ]);
    const ordered: (typeof rows)[number][] = [];
    const walk = (parentId: number | null, depth: number) => {
      for (const c of rows.filter((r) => r.parentId === parentId)) {
        ordered.push(Object.assign(c, { depth }));
        if (depth < 8) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return {
      rows: ordered.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        depth: (c as unknown as { depth: number }).depth,
        name: c.name,
        slug: c.slug,
        icon: c.icon,
        iconId: c.iconId,
        coverId: c.coverId,
        enabled: c.enabled,
        vipOnly: c.vipOnly,
        clanId: c.clanId,
        filesCount: c.filesCount,
        descriptionJson: c.descriptionJson,
        options: categoryOptions(c.options),
        fieldIds: jsonInts(c.fieldIds),
        inherits: inherit.find((i) => i.containerId === String(c.id))?.inherits ?? false,
      })),
      clans: (await this.deps.apps.enabled("clans")) ? clans : [],
    };
  }

  private async validateCategory(input: GcsCategoryInput, id: number | null): Promise<Omit<Prisma.DownloadCategoryUncheckedCreateInput, "position">> {
    const { db } = this.deps;
    const errors: Record<string, string> = {};
    const name = input.name.replace(/\s+/g, " ").trim();
    if (name.length < 2) errors.name = "too_short";
    if (name.length > 80) errors.name = "too_long";
    if (input.parentId !== null) {
      const parent = await db.downloadCategory.findUnique({ where: { id: input.parentId }, select: { id: true } });
      if (!parent) errors.parentId = "invalid_choice";
      else if (id !== null && (await this.descendants(id)).concat(id).includes(input.parentId)) errors.parentId = "cycle";
    }
    if (input.clanId != null) {
      const clan = await db.clan.findUnique({ where: { id: input.clanId }, select: { id: true } });
      const taken = await db.downloadCategory.findFirst({ where: { clanId: input.clanId, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (!clan) errors.clanId = "invalid_choice";
      else if (taken) errors.clanId = "taken";
    }
    const fieldIds = [...new Set((input.fieldIds ?? []).filter((n) => Number.isInteger(n) && n > 0))];
    if (fieldIds.length && (await db.downloadField.count({ where: { id: { in: fieldIds } } })) !== fieldIds.length) errors.fieldIds = "invalid_choice";
    const icon = (input.icon ?? "").trim();
    if (icon && !/^fa-(solid|regular|brands) fa-[a-z0-9-]{1,40}$/.test(icon)) errors.icon = "invalid";
    let description: { json: unknown; html: string } | null = null;
    if (input.description !== undefined && input.description !== "" && input.description !== null) {
      try {
        description = renderRichField(input.description, GCS_RICH_FIELDS.downloadText, { maxChars: 3000, maxImages: 2, field: "description" });
      } catch (error) {
        if (error instanceof GcsValidationError) Object.assign(errors, error.fields);
        else throw error;
      }
    }
    const options = categoryOptions({ ...input.options });
    if (options.forumTopic.enabled) {
      const forum = options.forumTopic.forumId ? await db.forum.findUnique({ where: { id: options.forumTopic.forumId }, select: { type: true } }) : null;
      if (!forum || (forum.type !== "FORUM" && forum.type !== "QA")) errors.forumId = "invalid_choice";
    }
    for (const id2 of [input.iconId, input.coverId]) if (id2 && !/^[A-Za-z0-9_-]{1,40}$/.test(id2)) errors.image = "invalid";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return {
      name,
      slug: slugify(name),
      parentId: input.parentId,
      icon,
      iconId: input.iconId ?? null,
      coverId: input.coverId ?? null,
      enabled: input.enabled ?? true,
      vipOnly: input.vipOnly ?? false,
      clanId: input.clanId ?? null,
      options: options as unknown as Prisma.InputJsonValue,
      fieldIds,
      ...(description ? { descriptionJson: description.json as Prisma.InputJsonValue, descriptionHtml: description.html } : { descriptionJson: undefined, descriptionHtml: "" }),
    };
  }

  private async descendants(id: number): Promise<number[]> {
    const rows = await this.deps.db.downloadCategory.findMany({ select: { id: true, parentId: true } });
    const out: number[] = [];
    const walk = (p: number, depth: number) => {
      for (const c of rows.filter((r) => r.parentId === p)) {
        out.push(c.id);
        if (depth < 32) walk(c.id, depth + 1);
      }
    };
    walk(id, 0);
    return out;
  }

  /** Permisiunile unei categorii noi: o subcategorie moștenește părintele; una de la rădăcină primește valorile implicite. */
  private async initPermissions(tx: Tx, id: number, parentId: number | null, clan: boolean): Promise<void> {
    const ref = { containerType: DOWNLOADS_CONTAINER, containerId: String(id) };
    if (parentId !== null && !clan) {
      await tx.containerInherit.create({ data: { ...ref, parentId: String(parentId), inherits: true } });
      return;
    }
    if (parentId !== null) await tx.containerInherit.create({ data: { ...ref, parentId: String(parentId), inherits: false } });
    const groups = await tx.group.findMany({ select: { id: true, key: true } });
    const rows: Prisma.ContainerPermissionCreateManyInput[] = [];
    for (const def of this.deps.registry.permissionDefs()) {
      if (def.scope !== "container" || def.containerType !== DOWNLOADS_CONTAINER) continue;
      // Categoria unui clan: toată lumea o vede, restul vine din apartenența la clan (și staff-ul de sus).
      if (clan && def.key !== "downloads.see" && def.key !== "downloads.view") {
        for (const g of groups) if (["root_admin", "admin", "super_moderator"].includes(g.key)) rows.push({ ...ref, groupId: g.id, action: def.key });
        continue;
      }
      for (const g of groups) if (def.default[g.key] === true) rows.push({ ...ref, groupId: g.id, action: def.key });
    }
    await tx.containerPermission.createMany({ data: rows, skipDuplicates: true });
  }

  async createCategory(actor: GcsActor, input: GcsCategoryInput): Promise<number> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.categories, "edit");
    const data = await this.validateCategory(input, null);
    const id = await db.$transaction(async (tx) => {
      const last = await tx.downloadCategory.findFirst({ where: { parentId: data.parentId ?? null }, orderBy: { position: "desc" }, select: { position: true } });
      const row = await tx.downloadCategory.create({ data: { ...data, position: last ? last.position + 1 : 0 } });
      await this.initPermissions(tx, row.id, row.parentId, row.clanId !== null);
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.category_create", targetType: "download_category", targetId: String(row.id), after: { name: row.name }, ip: actor.ip });
      return row.id;
    });
    await this.changed(true);
    return id;
  }

  async updateCategory(actor: GcsActor, id: number, input: GcsCategoryInput): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.categories, "edit");
    const before = await db.downloadCategory.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    const data = await this.validateCategory(input, id);
    await db.$transaction(async (tx) => {
      await tx.downloadCategory.update({ where: { id }, data });
      if (before.parentId !== data.parentId) {
        const ref = { containerType: DOWNLOADS_CONTAINER, containerId: String(id) };
        const row = await tx.containerInherit.findUnique({ where: { containerType_containerId: ref } });
        if (data.parentId === null) {
          // La rădăcină nu mai are de la cine moșteni: păstrează permisiunile efective de acum (devin ale ei).
          if (row?.inherits) await this.copyPermissions(tx, String(before.parentId), String(id));
          await tx.containerInherit.deleteMany({ where: ref });
        } else if (row) await tx.containerInherit.update({ where: { id: row.id }, data: { parentId: String(data.parentId) } });
        else await tx.containerInherit.create({ data: { ...ref, parentId: String(data.parentId), inherits: false } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.category_update", targetType: "download_category", targetId: String(id), before: { name: before.name, options: before.options }, after: { name: data.name, options: data.options }, ip: actor.ip });
    });
    await this.changed(before.parentId !== data.parentId);
  }

  private async copyPermissions(tx: Tx, fromId: string, toId: string): Promise<void> {
    const rows = await tx.containerPermission.findMany({ where: { containerType: DOWNLOADS_CONTAINER, containerId: fromId }, select: { groupId: true, action: true } });
    await tx.containerPermission.deleteMany({ where: { containerType: DOWNLOADS_CONTAINER, containerId: toId } });
    await tx.containerPermission.createMany({ data: rows.map((r) => ({ ...r, containerType: DOWNLOADS_CONTAINER, containerId: toId })), skipDuplicates: true });
  }

  /** „Copiază”: o categorie nouă cu aceleași setări și permisiuni (fără fișiere), lângă original. */
  async copyCategory(actor: GcsActor, id: number, name: string): Promise<number> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.categories, "edit");
    const src = await db.downloadCategory.findUnique({ where: { id } });
    if (!src) throw new GcsNotFound();
    const title = name.replace(/\s+/g, " ").trim() || `${src.name} (2)`;
    if (title.length < 2 || title.length > 80) throw new GcsValidationError({ name: "invalid" });
    const newId = await db.$transaction(async (tx) => {
      const row = await tx.downloadCategory.create({
        data: { parentId: src.parentId, position: src.position + 1, name: title, slug: slugify(title), descriptionJson: src.descriptionJson ?? undefined, descriptionHtml: src.descriptionHtml, icon: src.icon, iconId: src.iconId, coverId: src.coverId, enabled: src.enabled, vipOnly: src.vipOnly, options: src.options ?? {}, fieldIds: src.fieldIds ?? [] },
      });
      const inherit = await tx.containerInherit.findUnique({ where: { containerType_containerId: { containerType: DOWNLOADS_CONTAINER, containerId: String(id) } } });
      if (inherit) await tx.containerInherit.create({ data: { containerType: DOWNLOADS_CONTAINER, containerId: String(row.id), parentId: inherit.parentId, inherits: inherit.inherits } });
      await this.copyPermissions(tx, String(id), String(row.id));
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.category_copy", targetType: "download_category", targetId: String(row.id), after: { from: id, name: title }, ip: actor.ip });
      return row.id;
    });
    await this.changed(true);
    return newId;
  }

  /** Ordinea categoriilor sub același părinte (lista trasă cu mouse-ul). */
  async reorderCategories(actor: GcsActor, parentId: number | null, ids: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.categories, "edit");
    const siblings = await db.downloadCategory.findMany({ where: { parentId }, select: { id: true } });
    const known = new Set(siblings.map((s) => s.id));
    if (ids.length !== known.size || !ids.every((i) => known.has(i))) throw new GcsValidationError({ order: "invalid" });
    await db.$transaction(ids.map((cid, i) => db.downloadCategory.update({ where: { id: cid }, data: { position: i } })));
    await this.changed();
  }

  /**
   * Șterge o categorie: fișierele ei se mută în `moveTo` sau, cu `deleteContent`, se șterg; subcategoriile urcă la
   * părinte. Fără nicio alegere, o categorie cu fișiere nu se șterge.
   */
  async deleteCategory(actor: GcsActor, id: number, opts: { moveTo?: number | null; deleteContent?: boolean }): Promise<void> {
    const { db, acp, service } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.categories, "delete");
    const cat = await db.downloadCategory.findUnique({ where: { id } });
    if (!cat) throw new GcsNotFound();
    const count = await db.downloadFile.count({ where: { categoryId: id } });
    if (count > 0 && !opts.moveTo && !opts.deleteContent) throw new GcsConflict({ reason: "has_content" });
    if (opts.moveTo) {
      if (opts.moveTo === id || !(await db.downloadCategory.findUnique({ where: { id: opts.moveTo }, select: { id: true } }))) throw new GcsValidationError({ moveTo: "invalid_choice" });
      await db.$transaction(async (tx) => {
        await tx.downloadFile.updateMany({ where: { categoryId: id }, data: { categoryId: opts.moveTo! } });
        await tx.downloadAsset.updateMany({ where: { categoryId: id }, data: { categoryId: opts.moveTo! } });
      });
    } else if (opts.deleteContent) {
      const files = await db.downloadFile.findMany({ where: { categoryId: id }, include: { versions: { include: { assets: true } } } });
      for (const f of files) await service.purge(f, actor);
    }
    await db.$transaction(async (tx) => {
      const ref = { containerType: DOWNLOADS_CONTAINER, containerId: String(id) };
      await tx.downloadCategory.updateMany({ where: { parentId: id }, data: { parentId: cat.parentId } });
      await tx.containerInherit.updateMany({ where: { containerType: DOWNLOADS_CONTAINER, parentId: String(id) }, data: { parentId: cat.parentId === null ? null : String(cat.parentId) } });
      await tx.containerPermission.deleteMany({ where: ref });
      await tx.containerInherit.deleteMany({ where: ref });
      await tx.follow.deleteMany({ where: { contentType: "downloads.category", contentId: String(id) } });
      await tx.downloadCategory.delete({ where: { id } });
      if (opts.moveTo) {
        const n = await tx.downloadFile.count({ where: { categoryId: opts.moveTo, status: "APPROVED" } });
        await tx.downloadCategory.update({ where: { id: opts.moveTo }, data: { filesCount: n } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.category_delete", targetType: "download_category", targetId: String(id), before: { name: cat.name }, after: opts, ip: actor.ip });
    });
    await this.changed(true);
  }

  // ─── Câmpurile suplimentare ───────────────────────────────────────────────────────────────────────────────

  async fields(actor: GcsActor) {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.fields, "view");
    const [rows, cats] = await Promise.all([db.downloadField.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }), db.downloadCategory.findMany({ select: { id: true, name: true, fieldIds: true } })]);
    return rows.map((f) => ({
      ...f,
      options: jsonStrings(f.options),
      viewGroups: jsonInts(f.viewGroups),
      editGroups: jsonInts(f.editGroups),
      categories: cats.filter((c) => jsonInts(c.fieldIds).includes(f.id)).map((c) => ({ id: c.id, name: c.name })),
    }));
  }

  /** Salvează un câmp (nou sau existent) și categoriile în care e activat. */
  async saveField(actor: GcsActor, id: number | null, raw: Parameters<typeof fieldDefInput>[0] & { categoryIds?: number[] }): Promise<number> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.fields, "edit");
    const data = fieldDefInput(raw);
    const cats = await db.downloadCategory.findMany({ select: { id: true, fieldIds: true } });
    const wanted = new Set((raw.categoryIds ?? []).filter((c) => cats.some((x) => x.id === c)));
    const fieldId = await db.$transaction(async (tx) => {
      let fid = id;
      if (fid === null) {
        const last = await tx.downloadField.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
        fid = (await tx.downloadField.create({ data: { ...data, position: last ? last.position + 1 : 0 } })).id;
      } else {
        if (!(await tx.downloadField.findUnique({ where: { id: fid }, select: { id: true } }))) throw new GcsNotFound();
        await tx.downloadField.update({ where: { id: fid }, data });
      }
      for (const c of cats) {
        const list = jsonInts(c.fieldIds);
        const has = list.includes(fid);
        if (wanted.has(c.id) && !has) await tx.downloadCategory.update({ where: { id: c.id }, data: { fieldIds: [...list, fid] } });
        if (!wanted.has(c.id) && has) await tx.downloadCategory.update({ where: { id: c.id }, data: { fieldIds: list.filter((x) => x !== fid) } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: id === null ? "downloads.field_create" : "downloads.field_update", targetType: "download_field", targetId: String(fid), after: { name: data.name, type: data.type }, ip: actor.ip });
      return fid;
    });
    await this.changed();
    return fieldId;
  }

  async deleteField(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.fields, "delete");
    const field = await db.downloadField.findUnique({ where: { id } });
    if (!field) throw new GcsNotFound();
    const cats = await db.downloadCategory.findMany({ select: { id: true, fieldIds: true } });
    await db.$transaction(async (tx) => {
      for (const c of cats) if (jsonInts(c.fieldIds).includes(id)) await tx.downloadCategory.update({ where: { id: c.id }, data: { fieldIds: jsonInts(c.fieldIds).filter((x) => x !== id) } });
      await tx.downloadField.delete({ where: { id } });
      await writeAudit(tx, { actorId: actor.userId, action: "downloads.field_delete", targetType: "download_field", targetId: String(id), before: { name: field.name }, ip: actor.ip });
    });
    await this.changed();
  }

  async reorderFields(actor: GcsActor, ids: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.fields, "edit");
    const all = await db.downloadField.findMany({ select: { id: true } });
    if (ids.length !== all.length || !all.every((f) => ids.includes(f.id))) throw new GcsValidationError({ order: "invalid" });
    await db.$transaction(ids.map((fid, i) => db.downloadField.update({ where: { id: fid }, data: { position: i } })));
    await this.changed();
  }

  // ─── Setările ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Salvează setările trimise (doar cele schimbate, fiecare validată), pe secțiunea ACP a paginii. */
  async saveSettings(actor: GcsActor, section: typeof DOWNLOADS_ACP.settings | typeof DOWNLOADS_ACP.antivirus, values: Record<string, unknown>): Promise<void> {
    const { acp, settings } = this.deps;
    await acp.assert(actor, section, "edit");
    const errors: Record<string, string> = {};
    const changed: [string, unknown][] = [];
    for (const def of DOWNLOAD_SETTINGS) {
      if (!(def.key in values)) continue;
      const error = settingValueError(def, values[def.key]);
      if (error) errors[def.key] = error;
      else if (JSON.stringify(await settings.get(def.key)) !== JSON.stringify(values[def.key])) changed.push([def.key, values[def.key]]);
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    for (const [key, value] of changed) await settings.set(key, value, actor);
    await this.changed();
  }

  // ─── Coada, fișierele, carantina ──────────────────────────────────────────────────────────────────────────

  /** Coada de aprobare: versiunile care așteaptă (fișiere noi și versiuni noi), cu rezultatul verificării. */
  async queue(actor: GcsActor, page = 1) {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.queue, "view");
    const where: Prisma.DownloadVersionWhereInput = { status: { in: ["PENDING", "SCANNING"] } };
    const total = await db.downloadVersion.count({ where });
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const p = Math.min(Math.max(1, page), pages);
    const rows = await db.downloadVersion.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (p - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { assets: { orderBy: { position: "asc" } }, file: { include: { category: { select: { id: true, name: true } } } } },
    });
    const users = await this.users(rows.flatMap((r) => [r.createdById, r.file.authorId]));
    return {
      rows: rows.map((v) => ({
        versionId: v.id,
        status: v.status.toLowerCase() as GcsDownloadStatus,
        label: v.label,
        changelogHtml: v.changelogHtml,
        createdAt: v.createdAt.toISOString(),
        isNew: v.file.versionId === null,
        file: { id: v.file.id, title: v.file.title, href: downloadFileHref(v.file), summary: v.file.summary, descriptionHtml: v.file.descriptionHtml, category: v.file.category, screenshots: jsonStrings(v.file.screenshotIds) },
        author: v.createdById ? (users.get(v.createdById) ?? null) : null,
        assets: v.assets.map((a) => ({ id: a.id, name: a.name, size: Number(a.size), kind: a.kind, source: a.source.toLowerCase(), url: a.source === "LINK" ? a.url : null, state: a.state.toLowerCase(), scan: a.scanStatus.toLowerCase(), scanResult: a.scanResult, sha256: a.sha256 })),
      })),
      pagination: { page: p, pages, perPage: PER_PAGE, total } satisfies GcsPagination,
    };
  }

  async files(actor: GcsActor, query: { filter: GcsDownloadAcpFilter; q?: string; categoryId?: number | null; page?: number }) {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.files, "view");
    const q = (query.q ?? "").trim().slice(0, 60);
    const where: Prisma.DownloadFileWhereInput = { ...statusWhere(query.filter), ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(q ? { title: ci({ contains: q }) } : {}) };
    const [total, counts] = await Promise.all([
      db.downloadFile.count({ where }),
      Promise.all(GCS_DOWNLOAD_ACP_FILTERS.map(async (f) => [f, await db.downloadFile.count({ where: statusWhere(f) })] as const)),
    ]);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const p = Math.min(Math.max(1, query.page ?? 1), pages);
    const rows = await db.downloadFile.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * PER_PAGE, take: PER_PAGE, include: { category: { select: { id: true, name: true } } } });
    const users = await this.users(rows.map((r) => r.authorId));
    return { rows: rows.map((r) => this.toRow(r, users)), counts: Object.fromEntries(counts) as Record<GcsDownloadAcpFilter, number>, pagination: { page: p, pages, perPage: PER_PAGE, total } satisfies GcsPagination };
  }

  // ─── Antivirusul ──────────────────────────────────────────────────────────────────────────────────────────

  /** Starea antivirusului: disponibil (motorul, semnăturile) sau de ce nu, cu setările de acum. */
  async scannerStatus() {
    const opts = await readDownloadOptions(this.deps.settings);
    const scanner: GcsVirusScanner | null = this.deps.uploads.scannerFor(opts);
    const edition = scanner === null && opts.av.enabled && opts.av.address ? "lite_or_invalid" : null;
    const info = scanner ? await scanner.info() : null;
    return {
      enabled: opts.av.enabled,
      configured: scanner !== null,
      reason: !opts.av.enabled ? "disabled" : scanner === null ? (edition ? "unsupported" : "no_address") : info?.available ? null : "unreachable",
      available: Boolean(info?.available),
      engine: info?.engine ?? null,
      signatures: info?.signatures ?? null,
      signaturesAt: info?.signaturesAt ?? null,
      error: info?.error ?? null,
      address: opts.av.address,
    };
  }

  async antivirus(actor: GcsActor) {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.antivirus, "view");
    const [status, byScan, quarantine] = await Promise.all([
      this.scannerStatus(),
      db.downloadAsset.groupBy({ by: ["scanStatus"], where: { source: { not: "LINK" }, state: "READY" }, _count: { _all: true } }),
      db.downloadAsset.findMany({ where: { scanStatus: "INFECTED" }, orderBy: { scannedAt: "desc" }, take: 100, include: { file: { select: { id: true, title: true, slug: true } } } }),
    ]);
    const users = await this.users(quarantine.map((a) => a.uploaderId));
    return {
      status,
      counts: Object.fromEntries(byScan.map((r) => [r.scanStatus.toLowerCase(), r._count._all])) as Record<string, number>,
      quarantine: quarantine.map((a) => ({
        id: a.id,
        name: a.name,
        size: Number(a.size),
        signature: a.scanResult,
        engine: a.scanEngine,
        at: a.scannedAt?.toISOString() ?? a.createdAt.toISOString(),
        uploader: a.uploaderId ? (users.get(a.uploaderId) ?? null) : null,
        file: a.file ? { id: a.file.id, title: a.file.title, href: downloadFileHref(a.file) } : null,
      })),
    };
  }

  /** „Testează antivirusul”: trimite fișierul de test standard; un motor funcțional îl găsește. */
  async testScanner(actor: GcsActor): Promise<{ ok: boolean; result: string }> {
    await this.deps.acp.assert(actor, DOWNLOADS_ACP.antivirus, "view");
    const scanner = this.deps.uploads.scannerFor(await readDownloadOptions(this.deps.settings));
    if (!scanner) return { ok: false, result: "unavailable" };
    const verdict = await scanner.scan((async function* () { yield Buffer.from(EICAR); })(), 1024);
    return verdict.status === "infected" ? { ok: true, result: verdict.signature } : { ok: false, result: verdict.status === "error" ? verdict.error : "not_detected" };
  }

  /** Rescanează acum (un lot, apoi jobul periodic continuă). */
  async rescanNow(actor: GcsActor): Promise<void> {
    await this.deps.acp.assert(actor, DOWNLOADS_ACP.antivirus, "edit");
    await this.deps.db.downloadAsset.updateMany({ where: { state: "READY", scanStatus: { in: ["CLEAN", "SKIPPED", "ERROR"] } }, data: { scannedAt: null } });
    await this.deps.jobs.enqueue(DOWNLOAD_JOBS.rescan, {}, { jobId: "downloads-rescan-now" });
  }

  /** Șterge definitiv un fișier din carantină. */
  async deleteQuarantined(actor: GcsActor, assetId: string): Promise<void> {
    const { db, acp, uploads } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.antivirus, "delete");
    const a = await db.downloadAsset.findUnique({ where: { id: assetId } });
    if (!a || a.scanStatus !== "INFECTED") throw new GcsNotFound();
    await uploads.removeAsset(a);
    await writeAudit(db, { actorId: actor.userId, action: "downloads.quarantine_delete", targetType: "download_asset", targetId: assetId, before: { name: a.name, signature: a.scanResult }, ip: actor.ip });
  }

  // ─── Statisticile ─────────────────────────────────────────────────────────────────────────────────────────

  /** Raportul din ACP → Statistici → Descărcări: descărcările pe zile, fișierele, autorii și cei care descarcă cel mai mult. */
  async stats(actor: GcsActor, days = 30) {
    const { db, acp } = this.deps;
    await acp.assert(actor, DOWNLOADS_ACP.stats, "view");
    const span = Math.min(Math.max(days, 7), 365);
    const since = new Date(Date.now() - span * 86_400_000);
    const [logs, submissions, topFiles, topAuthors, topUsers] = await Promise.all([
      db.downloadLog.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true }, take: 200_000 }),
      db.downloadFile.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true }, take: 50_000 }),
      db.downloadFile.findMany({ where: { status: "APPROVED" }, orderBy: { downloads: "desc" }, take: 10, select: { id: true, title: true, slug: true, downloads: true } }),
      db.downloadFile.groupBy({ by: ["authorId"], where: { status: "APPROVED", authorId: { not: null } }, _sum: { downloads: true }, _count: { _all: true }, orderBy: { _sum: { downloads: "desc" } }, take: 10 }),
      db.downloadLog.groupBy({ by: ["userId"], where: { createdAt: { gte: since }, userId: { not: null } }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 10 }),
    ]);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const series: { day: string; downloads: number; submissions: number }[] = [];
    for (let i = span - 1; i >= 0; i--) series.push({ day: day(new Date(Date.now() - i * 86_400_000)), downloads: 0, submissions: 0 });
    const at = new Map(series.map((s) => [s.day, s] as const));
    for (const l of logs) { const s = at.get(day(l.createdAt)); if (s) s.downloads++; }
    for (const f of submissions) { const s = at.get(day(f.createdAt)); if (s) s.submissions++; }
    const users = await this.users([...topAuthors.map((a) => a.authorId), ...topUsers.map((u) => u.userId)]);
    return {
      days: span,
      series,
      totals: { downloads: logs.length, submissions: submissions.length },
      topFiles: topFiles.map((f) => ({ id: f.id, title: f.title, href: downloadFileHref(f), downloads: f.downloads })),
      topAuthors: topAuthors.map((a) => ({ user: a.authorId ? (users.get(a.authorId) ?? null) : null, files: a._count._all, downloads: a._sum.downloads ?? 0 })),
      topDownloaders: topUsers.map((u) => ({ user: u.userId ? (users.get(u.userId) ?? null) : null, downloads: u._count._all })),
    };
  }

  /** Acțiunile pe categorie, pentru legenda matricei de permisiuni. */
  categoryActions(): readonly string[] {
    return DOWNLOAD_CATEGORY_ACTIONS;
  }
}

export type GcsCategoryAdminRow = Awaited<ReturnType<GcsDownloadAdmin["categories"]>>["rows"][number];
export type { GcsCategoryOptions };
