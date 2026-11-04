import type { GcsActor, GcsCache, GcsFollowService, GcsPermissionService, GcsSettingsService } from "@gcs/core";
import { ci, jsonHas, jsonInts, jsonStrings, type DownloadAsset, type Prisma, type PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "../forums/queries";
import type { GcsCategoryRow, GcsDownloadAccess } from "./access";
import { fieldAllows, type GcsDownloadFieldDef } from "./fields";
import { kindLabel } from "./filetype";
import { CATEGORY_SORTS, readDownloadOptions, type GcsCategorySort, type GcsDownloadOptions } from "./options";
import type { GcsDownloadService } from "./service";
import type { GcsDownloadUploads } from "./uploads";
import { DOWNLOAD_FILE_CONTENT, downloadCategoryHref, downloadFileHref, type GcsDownloadStatus } from "./text";

export type GcsDownloadCard = {
  id: number;
  title: string;
  slug: string;
  href: string;
  summary: string;
  version: string;
  size: number;
  downloads: number;
  rating: number;
  reviewsCount: number;
  commentsCount: number;
  publishedAt: string;
  createdAt: string;
  status: GcsDownloadStatus;
  featured: boolean;
  vip: boolean;
  cover: string | null;
  author: GcsUserRef | null;
  category: { id: number; name: string; href: string; icon: string };
};

export type GcsCategoryNode = {
  id: number;
  name: string;
  slug: string;
  href: string;
  icon: string;
  iconUrl: string | null;
  coverUrl: string | null;
  descriptionHtml: string;
  filesCount: number;
  lastFileAt: string | null;
  vip: boolean;
  enabled: boolean;
  clanId: number | null;
  depth: number;
  children: GcsCategoryNode[];
};

export type GcsDownloadAssetView = { id: string; name: string; size: number; kind: string; source: "upload" | "link" | "path"; scan: string; scanResult: string | null; host: string | null; href: string | null };
export type GcsDownloadVersionView = { id: number; label: string; status: GcsDownloadStatus; changelogHtml: string; createdAt: string; approvedAt: string | null; size: number; downloads: number; rejectReason: string | null; assets: GcsDownloadAssetView[] };
export type GcsDownloadFieldView = { id: number; name: string; type: string; location: string; text: string | null; members: GcsUserRef[]; url: string | null };
export type GcsDownloadPostView = { id: number; user: GcsUserRef | null; bodyHtml: string; createdAt: string; status: "visible" | "pending" | "hidden"; rating?: number; version?: string; canEdit: boolean; canDelete: boolean };
export type GcsDownloadDenial = "guest" | "vip" | "no_permission" | null;

export type GcsDownloadFileView = {
  file: GcsDownloadCard & { descriptionHtml: string; tags: string[]; views: number; filesCount: number; rejectReason: string | null; commentsLocked: boolean; updatedAt: string; topicId: number | null };
  crumbs: { id: number; name: string; href: string }[];
  screenshots: { id: string; url: string; thumb: string }[];
  fields: GcsDownloadFieldView[];
  current: GcsDownloadVersionView | null;
  pending: GcsDownloadVersionView | null;
  history: GcsDownloadVersionView[];
  access: {
    canDownload: boolean;
    denial: GcsDownloadDenial;
    message: string;
    terms: string;
    canReview: boolean;
    reviewDenial: "guest" | "own" | "no_permission" | "disabled" | "download_first" | null;
    canComment: boolean;
    commentsEnabled: boolean;
    reviewsEnabled: boolean;
    canEdit: boolean;
    canNewVersion: boolean;
    moderate: boolean;
    canDelete: boolean;
    canSeeLog: boolean;
    versioning: string;
  };
  reviews: GcsDownloadPostView[];
  myReview: { rating: number; status: string } | null;
  comments: GcsDownloadPostView[];
  following: boolean;
  followers: number;
};

const STATUS = (s: string) => s.toLowerCase() as GcsDownloadStatus;
const PUBLISHED: Prisma.DownloadFileWhereInput = { status: "APPROVED" };

const ORDER: Record<GcsCategorySort, Prisma.DownloadFileOrderByWithRelationInput[]> = {
  updated: [{ publishedAt: "desc" }, { id: "desc" }],
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  downloads: [{ downloads: "desc" }, { id: "desc" }],
  rating: [{ ratingAvg: "desc" }, { reviewsCount: "desc" }, { id: "desc" }],
  title: [{ title: "asc" }, { id: "asc" }],
};

const fileSelect = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  version: true,
  size: true,
  downloads: true,
  ratingAvg: true,
  reviewsCount: true,
  commentsCount: true,
  publishedAt: true,
  createdAt: true,
  status: true,
  featured: true,
  vipOnly: true,
  screenshotIds: true,
  authorId: true,
  categoryId: true,
} as const satisfies Prisma.DownloadFileSelect;
type FileRow = Prisma.DownloadFileGetPayload<{ select: typeof fileSelect }>;

/**
 * Citirile publice ale Descărcărilor: indexul (categoriile vizibile și casetele Recomandate / Noutăți / Cele mai bine
 * notate / Cele mai descărcate, din setări), categoria (subcategorii, sortare, pagini), pagina fișierului (versiuni,
 * capturi, câmpuri, drepturile vizitatorului, recenzii, comentarii), „fișierele mele”, formularul de trimitere, logul
 * descărcărilor și fluxul RSS.
 */
export class GcsDownloadQueries {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      access: GcsDownloadAccess;
      follows: GcsFollowService;
      service: GcsDownloadService;
      uploads: GcsDownloadUploads;
    },
  ) {}

  appEnabled(): Promise<boolean> {
    return this.deps.access.appEnabled();
  }

  canUseApp(actor: GcsActor): Promise<boolean> {
    return this.deps.access.canUseApp(actor);
  }

  options(): Promise<GcsDownloadOptions> {
    return readDownloadOptions(this.deps.settings);
  }

  private async users(ids: (string | null)[]): Promise<Map<string, GcsUserRef>> {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
    if (unique.length === 0) return new Map();
    const rows = await this.deps.db.user.findMany({ where: { id: { in: unique } }, select: userRefSelect });
    return new Map(rows.map((u) => [u.id, toRef(u)] as const));
  }

  /** Categoriile ca arbore (doar cele din `visible`), cu adâncimea fiecăreia. */
  private tree(all: GcsCategoryRow[], visible: Set<number>, vipIds: Set<number>): GcsCategoryNode[] {
    const build = (parentId: number | null, depth: number): GcsCategoryNode[] =>
      all
        .filter((c) => c.parentId === parentId && visible.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          href: downloadCategoryHref(c),
          icon: c.icon,
          iconUrl: c.iconId ? `/files/${c.iconId}` : null,
          coverUrl: c.coverId ? `/files/${c.coverId}` : null,
          descriptionHtml: c.descriptionHtml,
          filesCount: c.filesCount,
          lastFileAt: c.lastFileAt,
          vip: vipIds.has(c.id),
          enabled: c.enabled,
          clanId: c.clanId,
          depth,
          children: depth < 6 ? build(c.id, depth + 1) : [],
        }));
    return build(null, 0);
  }

  /** Categoriile VIP (ele sau un părinte). */
  private vipIds(all: GcsCategoryRow[]): Set<number> {
    const out = new Set<number>();
    const isVip = (c: GcsCategoryRow | undefined, depth: number): boolean => Boolean(c) && depth < 32 && (c!.vipOnly || (c!.parentId !== null && isVip(all.find((p) => p.id === c!.parentId), depth + 1)));
    for (const c of all) if (isVip(c, 0)) out.add(c.id);
    return out;
  }

  private async cards(rows: FileRow[], all: GcsCategoryRow[], vipIds: Set<number>): Promise<GcsDownloadCard[]> {
    const users = await this.users(rows.map((r) => r.authorId));
    return rows.map((r) => {
      const c = all.find((x) => x.id === r.categoryId);
      const cover = jsonStrings(r.screenshotIds)[0];
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        href: downloadFileHref(r),
        summary: r.summary,
        version: r.version,
        size: Number(r.size),
        downloads: r.downloads,
        rating: r.ratingAvg,
        reviewsCount: r.reviewsCount,
        commentsCount: r.commentsCount,
        publishedAt: r.publishedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        status: STATUS(r.status),
        featured: r.featured,
        vip: r.vipOnly || vipIds.has(r.categoryId),
        cover: cover ? `/files/${cover}?thumb=1` : null,
        author: r.authorId ? (users.get(r.authorId) ?? null) : null,
        category: c ? { id: c.id, name: c.name, href: downloadCategoryHref(c), icon: c.icon } : { id: r.categoryId, name: "", href: "/downloads", icon: "" },
      };
    });
  }

  /** Categoriile ale căror fișiere actorul le poate vedea (vede categoria și fișierele). */
  async viewableIds(actor: GcsActor): Promise<Set<number>> {
    const [see, view] = await Promise.all([this.deps.access.allowed(actor, "downloads.see"), this.deps.access.allowed(actor, "downloads.view")]);
    return new Set([...view].filter((id) => see.has(id)));
  }

  private async box(actor: GcsActor, where: Prisma.DownloadFileWhereInput, order: Prisma.DownloadFileOrderByWithRelationInput[], categories: number[], take: number, ctx: { all: GcsCategoryRow[]; vip: Set<number>; viewable: Set<number> }) {
    const allowed = [...ctx.viewable].filter((id) => categories.length === 0 || categories.includes(id));
    if (allowed.length === 0) return [];
    const rows = await this.deps.db.downloadFile.findMany({ where: { ...PUBLISHED, ...where, categoryId: { in: allowed } }, orderBy: order, take, select: fileSelect });
    return this.cards(rows, ctx.all, ctx.vip);
  }

  /** Pagina `/downloads`: categoriile vizibile și casetele alese în ACP. */
  async index(actor: GcsActor) {
    const { access, db } = this.deps;
    const [all, opts, viewable, see, uploadable] = await Promise.all([access.categories(), this.options(), this.viewableIds(actor), access.allowed(actor, "downloads.see"), access.allowed(actor, "downloads.upload")]);
    const vip = this.vipIds(all);
    const ctx = { all, vip, viewable };
    const n = opts.boxes.count;
    const [featured, fresh, rated, downloaded, total] = await Promise.all([
      opts.boxes.featured.show ? this.box(actor, { featured: true }, ORDER.updated, [], opts.boxes.featured.count, ctx) : [],
      opts.boxes.new.show ? this.box(actor, {}, ORDER.newest, opts.boxes.new.categories, n, ctx) : [],
      opts.boxes.rated.show ? this.box(actor, { reviewsCount: { gt: 0 } }, ORDER.rating, opts.boxes.rated.categories, n, ctx) : [],
      opts.boxes.downloaded.show ? this.box(actor, { downloads: { gt: 0 } }, ORDER.downloads, opts.boxes.downloaded.categories, n, ctx) : [],
      db.downloadFile.count({ where: { ...PUBLISHED, categoryId: { in: [...viewable] } } }),
    ]);
    return {
      categories: this.tree(all, see, vip),
      boxes: { featured, new: fresh, rated, downloaded },
      total,
      canSubmit: actor.userId !== null && uploadable.size > 0,
      rss: opts.rss,
    };
  }

  /** Lista unei categorii (sau toate fișierele vizibile, fără categorie): căutare, etichetă, sortare, pagini. */
  async listing(actor: GcsActor, query: { categoryId?: number | null; sort?: string; page?: number; q?: string; tag?: string }) {
    const { access, db } = this.deps;
    const [all, opts, viewable, see] = await Promise.all([access.categories(), this.options(), this.viewableIds(actor), access.allowed(actor, "downloads.see")]);
    const vip = this.vipIds(all);
    const category = query.categoryId ? all.find((c) => c.id === query.categoryId) : null;
    if (query.categoryId && (!category || !see.has(category.id))) return null;
    const sort: GcsCategorySort = CATEGORY_SORTS.includes(query.sort as GcsCategorySort) ? (query.sort as GcsCategorySort) : (category?.options.sort ?? "updated");
    const q = (query.q ?? "").trim().slice(0, 60);
    const tag = (query.tag ?? "").trim().toLowerCase().slice(0, 30);
    const where: Prisma.DownloadFileWhereInput = {
      ...PUBLISHED,
      categoryId: category ? (viewable.has(category.id) ? category.id : -1) : { in: [...viewable] },
      ...(q ? { OR: [{ title: ci({ contains: q }) }, { summary: ci({ contains: q }) }] } : {}),
      ...(tag ? { tags: jsonHas(tag) } : {}),
    };
    const total = await db.downloadFile.count({ where });
    const pages = Math.max(1, Math.ceil(total / opts.perPage));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    const rows = await db.downloadFile.findMany({ where, orderBy: ORDER[sort], skip: (page - 1) * opts.perPage, take: opts.perPage, select: fileSelect });
    const rights = category ? await access.rights(actor, category.id) : null;
    return {
      category: category
        ? { id: category.id, name: category.name, slug: category.slug, href: downloadCategoryHref(category), icon: category.icon, descriptionHtml: category.descriptionHtml, vip: vip.has(category.id), canView: viewable.has(category.id), message: category.options.cannotView }
        : null,
      crumbs: category ? this.crumbs(all, category.id) : [],
      children: category ? this.tree(all, see, vip).flatMap(function find(n): GcsCategoryNode[] { return n.id === category.id ? n.children : n.children.flatMap(find); }) : this.tree(all, see, vip),
      files: await this.cards(rows, all, vip),
      pagination: { page, pages, perPage: opts.perPage, total } satisfies GcsPagination,
      sort,
      q,
      tag,
      canSubmit: Boolean(rights?.upload),
    };
  }

  private crumbs(all: GcsCategoryRow[], id: number): { id: number; name: string; href: string }[] {
    const out: { id: number; name: string; href: string }[] = [];
    let current = all.find((c) => c.id === id);
    for (let depth = 0; current && depth < 32; depth++) {
      out.unshift({ id: current.id, name: current.name, href: downloadCategoryHref(current) });
      current = current.parentId === null ? undefined : all.find((c) => c.id === current!.parentId);
    }
    return out;
  }

  /** Fișierul se vede: categoria (vede categoria și fișierele) și publicat, sau al autorului / staff-ului. */
  async canViewFile(actor: GcsActor, fileId: number): Promise<boolean> {
    const file = Number.isInteger(fileId) ? await this.deps.db.downloadFile.findUnique({ where: { id: fileId }, select: { status: true, authorId: true, categoryId: true } }) : null;
    if (!file || !(await this.deps.access.canUseApp(actor))) return false;
    const rights = await this.deps.access.rights(actor, file.categoryId);
    if (!rights.see || !rights.view) return false;
    return file.status === "APPROVED" || rights.moderate || (actor.userId !== null && file.authorId === actor.userId);
  }

  private assetView(a: DownloadAsset, token: ((id: string) => string) | null): GcsDownloadAssetView {
    let host: string | null = null;
    if (a.source === "LINK" && a.url) {
      try {
        host = new URL(a.url).hostname;
      } catch {
        host = null;
      }
    }
    return {
      id: a.id,
      name: a.name,
      size: Number(a.size),
      kind: a.source === "LINK" ? "link" : kindLabel(a.kind, a.name),
      source: a.source.toLowerCase() as GcsDownloadAssetView["source"],
      scan: a.scanStatus.toLowerCase(),
      scanResult: a.scanResult,
      host,
      href: token && a.state === "READY" && a.scanStatus !== "INFECTED" ? `/downloads/get/${a.id}${token(a.id)}` : null,
    };
  }

  private versionView(v: Prisma.DownloadVersionGetPayload<{ include: { assets: true } }>, token: ((id: string) => string) | null): GcsDownloadVersionView {
    return {
      id: v.id,
      label: v.label,
      status: STATUS(v.status),
      changelogHtml: v.changelogHtml,
      createdAt: v.createdAt.toISOString(),
      approvedAt: v.approvedAt?.toISOString() ?? null,
      size: Number(v.size),
      downloads: v.downloads,
      rejectReason: v.rejectReason,
      assets: [...v.assets].sort((a, b) => a.position - b.position).map((a) => this.assetView(a, token)),
    };
  }

  /** Pagina unui fișier, cu drepturile vizitatorului. `null` = nu există sau nu se vede. */
  async file(actor: GcsActor, fileId: number): Promise<GcsDownloadFileView | null> {
    const { db, access, follows, service, permissions } = this.deps;
    if (!(await this.canViewFile(actor, fileId))) return null;
    const file = await db.downloadFile.findUnique({ where: { id: fileId }, include: { versions: { include: { assets: true }, orderBy: { createdAt: "desc" } } } });
    if (!file) return null;
    const all = await access.categories();
    const category = all.find((c) => c.id === file.categoryId);
    if (!category) return null;
    const vip = this.vipIds(all);
    const rights = await access.rights(actor, category.id);
    const opts = await this.options();
    const own = actor.userId !== null && file.authorId === actor.userId;
    const isVip = file.vipOnly || vip.has(category.id);
    const denial: GcsDownloadDenial = !actor.userId ? "guest" : !rights.download && !own ? "no_permission" : isVip && !rights.vip && !own ? "vip" : null;
    const userId = actor.userId;
    const token = userId && denial === null ? (id: string) => (opts.preventDirect ? `?t=${service.downloadToken(userId, id)}` : "") : null;
    const current = file.versions.find((v) => v.id === file.versionId) ?? null;
    const pendingRow = rights.moderate || own ? (file.versions.find((v) => v.id !== file.versionId && ["SCANNING", "PENDING", "QUARANTINED", "REJECTED"].includes(v.status) && v.createdAt > (current?.createdAt ?? new Date(0))) ?? null) : null;
    const history = category.options.keepVersions ? file.versions.filter((v) => v.status === "APPROVED" && v.id !== file.versionId) : [];
    const ownToken = rights.moderate || own ? token ?? ((id: string) => (userId && opts.preventDirect ? `?t=${service.downloadToken(userId, id)}` : "")) : null;

    // Câmpurile vizibile grupurilor vizitatorului, în ordinea lor, cu valorile formatate.
    const fieldDefs: GcsDownloadFieldDef[] = category.fieldIds.length
      ? (await db.downloadField.findMany({ where: { id: { in: category.fieldIds } }, orderBy: [{ position: "asc" }, { id: "asc" }] })).map((f) => ({ ...f, options: jsonStrings(f.options), viewGroups: jsonInts(f.viewGroups), editGroups: jsonInts(f.editGroups) }))
      : [];
    const values = (file.fields ?? {}) as Record<string, unknown>;
    const memberIds = fieldDefs.filter((f) => f.type === "member").flatMap((f) => { const v = values[String(f.id)]; return Array.isArray(v) ? v : typeof v === "string" ? [v] : []; }) as string[];
    const [reviewRows, commentRows, following, followers, myReview, downloaded] = await Promise.all([
      category.options.reviews ? db.downloadReview.findMany({ where: { fileId, ...(rights.moderate ? {} : { OR: [{ status: "VISIBLE" }, ...(userId ? [{ userId }] : [])] }) }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
      category.options.comments ? db.downloadComment.findMany({ where: { fileId, ...(rights.moderate ? {} : { OR: [{ status: "VISIBLE" }, ...(userId ? [{ authorId: userId }] : [])] }) }, orderBy: { createdAt: "asc" }, take: 200 }) : [],
      follows.isFollowing(userId, DOWNLOAD_FILE_CONTENT, String(fileId)),
      follows.count(DOWNLOAD_FILE_CONTENT, String(fileId)),
      userId ? db.downloadReview.findUnique({ where: { fileId_userId: { fileId, userId } }, select: { rating: true, status: true } }) : null,
      userId && category.options.reviewNeedsDownload ? db.downloadLog.count({ where: { fileId, userId } }) : 0,
    ]);
    const users = await this.users([file.authorId, ...memberIds, ...reviewRows.map((r) => r.userId), ...commentRows.map((c) => c.authorId)]);
    const fields: GcsDownloadFieldView[] = fieldDefs
      .filter((f) => fieldAllows(actor.groupIds, f.viewGroups) && values[String(f.id)] !== undefined)
      .map((f) => {
        const v = values[String(f.id)];
        const list = Array.isArray(v) ? v : [v];
        if (f.type === "member") return { id: f.id, name: f.name, type: f.type, location: f.location, text: null, url: null, members: list.map((id) => users.get(String(id))).filter((u): u is GcsUserRef => Boolean(u)) };
        if (f.type === "url") return { id: f.id, name: f.name, type: f.type, location: f.location, text: String(v), url: String(v), members: [] };
        if (f.type === "checkbox") return { id: f.id, name: f.name, type: f.type, location: f.location, text: v ? "yes" : "no", url: null, members: [] };
        return { id: f.id, name: f.name, type: f.type, location: f.location, text: list.map(String).join(", "), url: null, members: [] };
      });
    const reviewDenial = !category.options.reviews ? "disabled" : !userId ? "guest" : own ? "own" : !rights.review ? "no_permission" : category.options.reviewNeedsDownload && downloaded === 0 ? "download_first" : null;
    const card = (await this.cards([{ ...file, screenshotIds: file.screenshotIds }], all, vip))[0]!;
    const termsShown = category.options.termsWhen === "download" || category.options.termsWhen === "both" ? category.options.terms : "";
    const canSeeLog = rights.moderate || (await permissions.can(actor, "downloads.view_logs")) || (own && category.options.authorSeesLog);
    return {
      file: {
        ...card,
        descriptionHtml: file.descriptionHtml,
        tags: jsonStrings(file.tags),
        views: file.views,
        filesCount: file.filesCount,
        rejectReason: rights.moderate || own ? file.rejectReason : null,
        commentsLocked: file.commentsLocked,
        updatedAt: file.updatedAt.toISOString(),
        topicId: file.topicId,
      },
      crumbs: this.crumbs(all, category.id),
      screenshots: jsonStrings(file.screenshotIds).map((id) => ({ id, url: `/files/${id}`, thumb: `/files/${id}?thumb=1` })),
      fields,
      current: current ? this.versionView(current, file.status === "APPROVED" ? token : ownToken) : null,
      pending: pendingRow ? this.versionView(pendingRow, ownToken) : null,
      history: history.map((v) => this.versionView(v, token)),
      access: {
        canDownload: denial === null,
        denial,
        message: denial === "no_permission" ? category.options.cannotDownload : "",
        terms: termsShown,
        canReview: reviewDenial === null,
        reviewDenial,
        canComment: Boolean(userId) && category.options.comments && rights.comment && (!file.commentsLocked || rights.moderate),
        commentsEnabled: category.options.comments,
        reviewsEnabled: category.options.reviews,
        canEdit: own || rights.moderate,
        canNewVersion: (own || rights.moderate) && file.status === "APPROVED",
        moderate: rights.moderate,
        canDelete: rights.moderate || (own && file.status !== "APPROVED" && file.status !== "HIDDEN" && file.status !== "QUARANTINED"),
        canSeeLog,
        versioning: category.options.versioning,
      },
      reviews: reviewRows.map((r) => ({
        id: r.id,
        user: users.get(r.userId) ?? null,
        bodyHtml: r.bodyHtml,
        createdAt: r.createdAt.toISOString(),
        status: r.status.toLowerCase() as GcsDownloadPostView["status"],
        rating: r.rating,
        version: r.version,
        canEdit: r.userId === userId,
        canDelete: rights.moderate || r.userId === userId,
      })),
      myReview: myReview ? { rating: myReview.rating, status: myReview.status.toLowerCase() } : null,
      comments: commentRows.map((c) => ({
        id: c.id,
        user: c.authorId ? (users.get(c.authorId) ?? null) : null,
        bodyHtml: c.bodyHtml,
        createdAt: c.createdAt.toISOString(),
        status: c.status.toLowerCase() as GcsDownloadPostView["status"],
        canEdit: c.authorId === userId || rights.moderate,
        canDelete: c.authorId === userId || rights.moderate,
      })),
      following,
      followers,
    };
  }

  /** Datele formularului de editare (autorul / staff-ul): textele salvate, câmpurile și capturile. */
  async editForm(actor: GcsActor, fileId: number) {
    const { db, access } = this.deps;
    const file = Number.isInteger(fileId) ? await db.downloadFile.findUnique({ where: { id: fileId } }) : null;
    if (!file || !actor.userId) return null;
    const rights = await access.rights(actor, file.categoryId);
    if (file.authorId !== actor.userId && !rights.moderate) return null;
    const context = await this.submitContext(actor, file.categoryId, file.id);
    return {
      file: { id: file.id, title: file.title, slug: file.slug, href: downloadFileHref(file), summary: file.summary, descriptionJson: file.descriptionJson, tags: jsonStrings(file.tags), fields: (file.fields ?? {}) as Record<string, unknown>, screenshots: jsonStrings(file.screenshotIds), version: file.version, status: STATUS(file.status) },
      context,
    };
  }

  /**
   * Formularul de trimitere: categoriile în care actorul poate încărca (arbore) și regulile categoriei alese (extensii,
   * mărime, mai multe fișiere, versiuni, capturi, termeni), câmpurile pe care le poate completa, linkurile / importul /
   * trimiterea în bloc permise și spațiul rămas.
   */
  async submitContext(actor: GcsActor, categoryId: number | null, fileId: number | null = null) {
    const { access, db, permissions, uploads } = this.deps;
    if (!actor.userId) return null;
    const [all, uploadable, see] = await Promise.all([access.categories(), access.allowed(actor, "downloads.upload"), access.allowed(actor, "downloads.see")]);
    const vip = this.vipIds(all);
    const usable = new Set([...uploadable].filter((id) => see.has(id) || fileId !== null));
    const chosen = categoryId ? all.find((c) => c.id === categoryId && (usable.has(c.id) || fileId !== null)) ?? null : null;
    const [links, importPath, bulk, quota, used] = await Promise.all([
      permissions.can(actor, "downloads.links"),
      permissions.can(actor, "downloads.import_path"),
      permissions.can(actor, "downloads.bulk"),
      uploads.quotaBytes(actor),
      uploads.usedBytes(actor.userId),
    ]);
    const fields = chosen && chosen.fieldIds.length
      ? (await db.downloadField.findMany({ where: { id: { in: chosen.fieldIds } }, orderBy: [{ position: "asc" }, { id: "asc" }] }))
          .map((f) => ({ ...f, options: jsonStrings(f.options), viewGroups: jsonInts(f.viewGroups), editGroups: jsonInts(f.editGroups) }))
          .filter((f) => fieldAllows(actor.groupIds, f.editGroups))
      : [];
    return {
      categories: this.tree(all, usable, vip),
      category: chosen
        ? {
            id: chosen.id,
            name: chosen.name,
            href: downloadCategoryHref(chosen),
            extensions: chosen.options.extensions,
            maxBytes: await uploads.maxBytes(actor, chosen.options.maxFileMb),
            multipleFiles: chosen.options.multipleFiles,
            versioning: chosen.options.versioning,
            requireChangelog: chosen.options.requireChangelog,
            screenshots: chosen.options.screenshots,
            requireScreenshots: chosen.options.requireScreenshots,
            maxScreenshots: chosen.options.maxScreenshots,
            screenshotMaxKb: chosen.options.screenshotMaxKb,
            tags: chosen.options.tags,
            submitTerms: chosen.options.termsWhen === "submit" || chosen.options.termsWhen === "both" ? chosen.options.submitTerms || chosen.options.terms : chosen.options.submitTerms,
            approval: chosen.options.approval,
            vip: vip.has(chosen.id),
          }
        : null,
      fields: fields.map((f) => ({ id: f.id, name: f.name, description: f.description, type: f.type, options: f.options, multiple: f.multiple, required: f.required })),
      links,
      importPath,
      bulk,
      quota: { limit: quota, used },
    };
  }

  /** „Fișierele mele”: trimiterile actorului, cu starea fiecăreia (și versiunile în lucru). */
  async mine(actor: GcsActor, page = 1) {
    const { db, access } = this.deps;
    if (!actor.userId) return null;
    const all = await access.categories();
    const vip = this.vipIds(all);
    const where: Prisma.DownloadFileWhereInput = { authorId: actor.userId };
    const total = await db.downloadFile.count({ where });
    const perPage = 20;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const p = Math.min(Math.max(1, page), pages);
    const rows = await db.downloadFile.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * perPage, take: perPage, select: { ...fileSelect, rejectReason: true } });
    const pendingVersions = await db.downloadVersion.findMany({ where: { fileId: { in: rows.map((r) => r.id) }, status: { in: ["SCANNING", "PENDING", "QUARANTINED", "REJECTED"] } }, select: { fileId: true, status: true, label: true, rejectReason: true }, orderBy: { createdAt: "desc" } });
    const cards = await this.cards(rows, all, vip);
    const [used, quota] = await Promise.all([this.deps.uploads.usedBytes(actor.userId), this.deps.uploads.quotaBytes(actor)]);
    return {
      files: cards.map((c, i) => ({ ...c, rejectReason: rows[i]!.rejectReason, pendingVersion: pendingVersions.find((v) => v.fileId === c.id && c.status === "approved") ?? null })),
      pagination: { page: p, pages, perPage, total },
      quota: { used, limit: quota },
    };
  }

  /** Logul descărcărilor unui fișier: staff-ul, `downloads.view_logs` sau autorul (dacă categoria îi arată logul). */
  async log(actor: GcsActor, fileId: number, page = 1) {
    const { db, access, permissions } = this.deps;
    const file = Number.isInteger(fileId) ? await db.downloadFile.findUnique({ where: { id: fileId }, select: { id: true, title: true, slug: true, authorId: true, categoryId: true } }) : null;
    if (!file || !actor.userId) return null;
    const [rights, category, logs] = await Promise.all([access.rights(actor, file.categoryId), access.category(file.categoryId), permissions.can(actor, "downloads.view_logs")]);
    const allowed = rights.moderate || logs || (file.authorId === actor.userId && category?.options.authorSeesLog);
    if (!allowed) return null;
    const perPage = 50;
    const total = await db.downloadLog.count({ where: { fileId } });
    const pages = Math.max(1, Math.ceil(total / perPage));
    const p = Math.min(Math.max(1, page), pages);
    const rows = await db.downloadLog.findMany({ where: { fileId }, orderBy: { createdAt: "desc" }, skip: (p - 1) * perPage, take: perPage });
    const versions = await db.downloadVersion.findMany({ where: { id: { in: rows.map((r) => r.versionId).filter((id): id is number => id !== null) } }, select: { id: true, label: true } });
    const users = await this.users(rows.map((r) => r.userId));
    return {
      file: { id: file.id, title: file.title, href: downloadFileHref(file) },
      rows: rows.map((r) => ({ id: r.id, user: r.userId ? (users.get(r.userId) ?? null) : null, version: versions.find((v) => v.id === r.versionId)?.label ?? "", size: Number(r.size), at: r.createdAt.toISOString() })),
      pagination: { page: p, pages, perPage, total },
    };
  }

  /** Fluxul RSS: ultimele fișiere publicate, vizibile unui vizitator (o categorie sau toate). */
  async feed(actor: GcsActor, categoryId: number | null, limit = 30) {
    const { access, db } = this.deps;
    const [all, viewable] = await Promise.all([access.categories(), this.viewableIds(actor)]);
    const ids = categoryId ? (viewable.has(categoryId) ? [categoryId] : []) : [...viewable];
    const rows = ids.length ? await db.downloadFile.findMany({ where: { ...PUBLISHED, categoryId: { in: ids } }, orderBy: ORDER.updated, take: limit, select: { ...fileSelect, descriptionHtml: true } }) : [];
    const category = categoryId ? all.find((c) => c.id === categoryId) ?? null : null;
    const cards = await this.cards(rows, all, this.vipIds(all));
    return { category: category ? { name: category.name, href: downloadCategoryHref(category) } : null, items: cards.map((c, i) => ({ ...c, descriptionHtml: rows[i]!.descriptionHtml })) };
  }

  /** Lista unui widget (cele mai noi / descărcate / notate / recomandate), din categoriile vizibile. */
  async top(actor: GcsActor, kind: "new" | "downloaded" | "rated" | "featured", limit: number, categoryId: number | null = null): Promise<GcsDownloadCard[]> {
    const all = await this.deps.access.categories();
    const viewable = await this.viewableIds(actor);
    const ctx = { all, vip: this.vipIds(all), viewable };
    const take = Math.min(Math.max(Math.trunc(limit) || 5, 1), 20);
    const cats = categoryId ? [categoryId] : [];
    if (kind === "featured") return this.box(actor, { featured: true }, ORDER.updated, cats, take, ctx);
    if (kind === "rated") return this.box(actor, { reviewsCount: { gt: 0 } }, ORDER.rating, cats, take, ctx);
    if (kind === "downloaded") return this.box(actor, { downloads: { gt: 0 } }, ORDER.downloads, cats, take, ctx);
    return this.box(actor, {}, ORDER.newest, cats, take, ctx);
  }

  /** Categoriile vizibile cu numărul de fișiere (widget-ul „Categorii”). */
  async categoryCounts(actor: GcsActor): Promise<GcsCategoryNode[]> {
    const [all, see] = await Promise.all([this.deps.access.categories(), this.deps.access.allowed(actor, "downloads.see")]);
    return this.tree(all, see, this.vipIds(all));
  }

  /** Categoria unui clan (pagina clanului afișează linkul), dacă există și actorul o vede. */
  async clanCategory(actor: GcsActor, clanId: number): Promise<{ id: number; name: string; href: string; filesCount: number } | null> {
    if (!(await this.deps.access.canUseApp(actor))) return null;
    const c = (await this.deps.access.categories()).find((x) => x.clanId === clanId && x.enabled);
    if (!c || !(await this.deps.access.rights(actor, c.id)).see) return null;
    return { id: c.id, name: c.name, href: downloadCategoryHref(c), filesCount: c.filesCount };
  }
}
