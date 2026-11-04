import {
  GcsConflict,
  GcsNotFound,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAttachmentService,
  type GcsEventBus,
  type GcsModuleRegistry,
  type GcsRendered,
  type GcsSettingsService,
} from "@gcs/core";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { Prisma, ci, jsonInts, type PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import { fieldDefsOf, parseFieldDefs, type GcsPagesFieldDef } from "./fields";
import { MAX_PAGE_HTML, blockFieldsOf, fillBlockTemplate, sanitizePageHtml } from "./html";
import { EMPTY_LAYOUT, isSafeLink, layoutBlocks, layoutOf, parseLayout, type GcsPagesLayout } from "./layout";
import { PAGES_PRESET_DEFS, presetData, type GcsPagesPreset } from "./presets";
import { PAGES_ACP, PAGES_CACHE_TAG, PAGES_MEDIA_TYPE, PAGES_RECORD_TYPE, RESERVED_SEGMENTS, SLUG_RE, pageHref, searchNormalize } from "./shared";

const MAX_DEPTH = 6;
/** Versiunile păstrate pentru o pagină (cele mai vechi se șterg). */
const MAX_REVISIONS = 30;
const MAX_NODES = 2000;
const MEDIA_PER_PAGE = 48;
export const PAGES_LIST_LAYOUTS = ["list", "grid", "table"] as const;
export const PAGES_DB_SORTS = ["newest", "updated", "title", "rating", "views", "comments"] as const;

export type GcsPagesNodeRow = {
  id: number;
  parentId: number | null;
  kind: "folder" | "page";
  title: string;
  slug: string;
  path: string;
  position: number;
  icon: string | null;
  contentType: "layout" | "html" | "database";
  databaseId: number | null;
  published: boolean;
  inMenu: boolean;
  viewGroupIds: number[];
  homeGroupIds: number[];
  updatedAt: string;
};

export type GcsPagesNodeInput = {
  kind: "folder" | "page";
  parentId: number | null;
  title: string;
  slug?: string;
  icon?: string | null;
  contentType?: "layout" | "html" | "database";
  databaseId?: number | null;
  published?: boolean;
  showTitle?: boolean;
  viewGroupIds?: number[];
  /** Grupurile (principale) pentru care pagina e pagina de pornire a aplicației. */
  homeGroupIds?: number[];
  seoTitle?: string;
  seoDescription?: string;
  /** Imaginea de distribuire: un element din biblioteca media (id-ul lui). */
  seoMediaId?: number | null;
  noindex?: boolean;
  inMenu?: boolean;
};

export type GcsPagesDatabaseInput = {
  name: string;
  key?: string;
  description?: string;
  icon?: string | null;
  recordLabel?: string;
  fields?: unknown;
  listLayout?: string;
  sort?: string;
  perPage?: number;
  comments?: boolean;
  ratings?: boolean;
  submissions?: boolean;
  approval?: boolean;
  authorEdit?: boolean;
  searchable?: boolean;
  inStream?: boolean;
  useCategories?: boolean;
  indexMode?: string;
  recordPlural?: string;
  commentApproval?: boolean;
  recordImage?: boolean;
  rss?: boolean;
  wiki?: boolean;
  revisions?: boolean;
  forumId?: number | null;
  viewGroupIds?: number[];
  submitGroupIds?: number[];
  commentGroupIds?: number[];
  rateGroupIds?: number[];
};

export type GcsPagesCategoryInput = {
  name: string;
  slug?: string;
  description?: string;
  icon?: string | null;
  color?: string | null;
  parentId?: number | null;
  /** Coperta: un element din biblioteca media (`null` = fără). */
  mediaId?: number | null;
  viewGroupIds?: number[];
  private?: boolean;
};

export const PAGES_INDEX_MODES = ["all", "categories", "featured"] as const;

/** Pachetul descărcat al unei baze de date (`gcs-pages-database`, versiunea 1). */
export type GcsPagesDatabasePackage = {
  format: "gcs-pages-database";
  v: 1;
  database: Omit<GcsPagesDatabaseInput, "viewGroupIds" | "submitGroupIds" | "commentGroupIds" | "rateGroupIds" | "forumId"> & { template: string };
  categories: { name: string; slug: string; description: string; icon: string | null; color: string | null; private: boolean; parent: string | null }[];
  records: { title: string; content: unknown; fields: Record<string, unknown>; category: string | null; featured: boolean; pinned: boolean }[];
};

export type GcsPagesMediaItem = {
  id: number;
  folderId: number | null;
  attachmentId: string;
  url: string;
  title: string;
  alt: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  isImage: boolean;
  createdAt: string;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const iconOrNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * ACP › Pagini (specul 2026-11-03-pagini §5): arborele de foldere și pagini (cu meniul site-ului), constructorul de
 * layout, bazele de date cu șabloanele gata și categoriile, biblioteca media. Fiecare acțiune verifică secțiunea ACP
 * și scrie în jurnalul de audit; înregistrările și comentariile sunt în `GcsPagesRecords`.
 */
export class GcsPagesAdmin {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: GcsAcpRoleService;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
      settings: GcsSettingsService;
      attachments: GcsAttachmentService;
      /** Conținutul editorului → JSON validat + HTML (randarea postărilor, cu blocurile permise actorului). */
      render: (content: unknown, actor: GcsActor) => Promise<GcsRendered>;
    },
  ) {}

  private async changed(extra: Record<string, unknown> = {}): Promise<void> {
    await this.deps.bus.emit({ name: "pages.updated", payload: extra, tags: [PAGES_CACHE_TAG, "activity"] });
  }

  // ─── Arborele ──────────────────────────────────────────────────────────────────────────────────────────────

  async tree(actor: GcsActor): Promise<GcsPagesNodeRow[]> {
    await this.deps.acp.assert(actor, PAGES_ACP.pages, "view");
    const rows = await this.deps.db.pagesNode.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      kind: n.kind === "folder" ? "folder" : "page",
      title: n.title,
      slug: n.slug,
      path: n.path,
      position: n.position,
      icon: n.icon,
      contentType: n.contentType === "database" || n.contentType === "html" ? n.contentType : "layout",
      databaseId: n.databaseId,
      published: n.published,
      inMenu: n.inMenu,
      viewGroupIds: jsonInts(n.viewGroupIds),
      homeGroupIds: jsonInts(n.homeGroupIds),
      updatedAt: n.updatedAt.toISOString(),
    }));
  }

  /** O pagină cu tot ce are (layout-ul, SEO, imaginea de distribuire ca element din bibliotecă). */
  async node(actor: GcsActor, id: number) {
    await this.deps.acp.assert(actor, PAGES_ACP.pages, "view");
    const n = Number.isSafeInteger(id) ? await this.deps.db.pagesNode.findUnique({ where: { id } }) : null;
    if (!n) return null;
    const seoMedia = n.seoImageId ? await this.deps.db.pagesMedia.findUnique({ where: { attachmentId: n.seoImageId }, select: { id: true } }) : null;
    return { ...n, viewGroupIds: jsonInts(n.viewGroupIds), homeGroupIds: jsonInts(n.homeGroupIds), layout: layoutOf(n.layout), seoMediaId: seoMedia?.id ?? null };
  }

  /** Calea unui nod: calea părintelui + slug-ul. */
  private async pathFor(parentId: number | null, slug: string): Promise<string> {
    if (parentId === null) return slug;
    const parent = await this.deps.db.pagesNode.findUnique({ where: { id: parentId }, select: { path: true } });
    return `${parent!.path}/${slug}`;
  }

  /** Adâncimea unui părinte (rădăcina = 0) și dacă `nodeId` e printre strămoșii lui (o mutare în propriul subarbore). */
  private async ancestry(parentId: number | null, nodeId: number | null): Promise<{ depth: number; cycle: boolean }> {
    let depth = 0;
    let cur = parentId;
    while (cur !== null) {
      if (cur === nodeId) return { depth, cycle: true };
      const row = await this.deps.db.pagesNode.findUnique({ where: { id: cur }, select: { parentId: true } });
      if (!row) break;
      depth++;
      cur = row.parentId;
      if (depth > MAX_DEPTH + 1) break;
    }
    return { depth, cycle: false };
  }

  /**
   * Creează sau salvează un folder / o pagină: părintele (un folder), slug-ul unic între frați (calea întreagă e unică),
   * grupurile, SEO, baza de date (una per pagină) și itemul din meniu. Schimbarea căii rescrie căile descendenților și
   * linkul din meniu.
   */
  async saveNode(actor: GcsActor, id: number | null, input: GcsPagesNodeInput): Promise<{ id: number; path: string }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const existing = id === null ? null : await db.pagesNode.findUnique({ where: { id } });
    if (id !== null && !existing) throw new GcsNotFound();
    if (id === null && (await db.pagesNode.count()) >= MAX_NODES) throw new GcsConflict({ reason: "too_many" });
    const errors: Record<string, string> = {};
    const kind = existing ? (existing.kind === "folder" ? "folder" : "page") : input.kind === "folder" ? "folder" : "page";
    const title = text(input.title, 120);
    if (title.length < 2) errors.title = "too_short";
    const slug = (input.slug ?? "").trim() ? (input.slug ?? "").trim().toLowerCase() : slugify(title);
    if (!SLUG_RE.test(slug)) errors.slug = "invalid_slug";
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = await db.pagesNode.findUnique({ where: { id: parentId }, select: { kind: true } });
      if (!parent || parent.kind !== "folder") errors.parentId = "invalid_parent";
      else {
        const { depth, cycle } = await this.ancestry(parentId, id);
        if (cycle) errors.parentId = "cycle";
        else if (depth >= MAX_DEPTH) errors.parentId = "too_deep";
      }
    }
    const icon = iconOrNull(input.icon);
    if (icon && !isGcsIcon(icon)) errors.icon = "invalid_choice";
    const viewGroupIds = [...new Set(input.viewGroupIds ?? [])];
    if (viewGroupIds.length > 0 && (await db.group.count({ where: { id: { in: viewGroupIds } } })) !== viewGroupIds.length) errors.viewGroupIds = "invalid_choice";
    const homeGroupIds = kind === "page" ? [...new Set(input.homeGroupIds ?? [])] : [];
    if (homeGroupIds.length > 0 && (await db.group.count({ where: { id: { in: homeGroupIds } } })) !== homeGroupIds.length) errors.homeGroupIds = "invalid_choice";
    const contentType = kind === "folder" ? "layout" : input.contentType === "database" || input.contentType === "html" ? input.contentType : "layout";
    const databaseId = contentType === "database" ? (input.databaseId ?? null) : null;
    if (contentType === "database") {
      const owner = databaseId ? await db.pagesDatabase.findUnique({ where: { id: databaseId }, select: { id: true, node: { select: { id: true } } } }) : null;
      if (!owner) errors.databaseId = "required";
      else if (owner.node && owner.node.id !== id) errors.databaseId = "in_use";
    }
    const seoMedia = input.seoMediaId ? await db.pagesMedia.findUnique({ where: { id: input.seoMediaId }, select: { attachmentId: true } }) : null;
    if (input.seoMediaId && !seoMedia) errors.seoMediaId = "invalid_choice";
    if (Object.keys(errors).length === 0) {
      const path = await this.pathFor(parentId, slug);
      if (parentId === null && (RESERVED_SEGMENTS.has(slug) || slug === "api")) errors.slug = "reserved";
      const clash = await db.pagesNode.findUnique({ where: { path }, select: { id: true } });
      if (clash && clash.id !== id) errors.slug = "taken";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const path = await this.pathFor(parentId, slug);
    const data = {
      kind,
      parentId,
      title,
      slug,
      path,
      icon,
      contentType,
      databaseId,
      published: input.published ?? true,
      showTitle: input.showTitle ?? true,
      viewGroupIds,
      homeGroupIds,
      seoTitle: text(input.seoTitle, 120) || null,
      seoDescription: text(input.seoDescription, 300) || null,
      seoImageId: seoMedia?.attachmentId ?? null,
      noindex: input.noindex ?? false,
      inMenu: kind === "page" && (input.inMenu ?? false),
      updatedById: actor.userId,
    };
    const saved = await db.$transaction(async (tx) => {
      const position = existing && existing.parentId === parentId ? existing.position : await tx.pagesNode.count({ where: { parentId } });
      const row = existing
        ? await tx.pagesNode.update({ where: { id: existing.id }, data: { ...data, position } })
        : await tx.pagesNode.create({ data: { ...data, position, layout: EMPTY_LAYOUT as unknown as Prisma.InputJsonValue } });
      if (existing && existing.path !== path) await this.rewritePaths(tx, existing.path, path);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: existing ? "pages.node.update" : "pages.node.create",
        targetType: "pages_node",
        targetId: String(row.id),
        before: existing ? { title: existing.title, path: existing.path, published: existing.published, inMenu: existing.inMenu } : null,
        after: { title, path, published: data.published, inMenu: data.inMenu },
        ip: actor.ip,
      });
      return row;
    });
    await this.syncMenu({ path: saved.path, title: saved.title, icon: saved.icon, inMenu: saved.inMenu && saved.published }, existing?.path ?? null);
    await this.changed({ nodeId: saved.id });
    return { id: saved.id, path: saved.path };
  }

  /** Căile descendenților după mutarea / redenumirea unui folder (și linkurile lor din meniu). */
  private async rewritePaths(tx: Prisma.TransactionClient, from: string, to: string): Promise<void> {
    const rows = await tx.pagesNode.findMany({ where: { path: { startsWith: `${from}/` } }, select: { id: true, path: true } });
    for (const r of rows) {
      const next = `${to}${r.path.slice(from.length)}`;
      await tx.pagesNode.update({ where: { id: r.id }, data: { path: next } });
      await tx.navItem.updateMany({ where: { href: pageHref(r.path), appKey: "pages" }, data: { href: pageHref(next) } });
    }
  }

  /**
   * Itemul paginii din meniul site-ului (Manager meniu): creat la sfârșitul meniului cu `appKey = pages` (dispare cu
   * aplicația oprită), recunoscut după adresă; scos când pagina iese din meniu sau nu mai e publicată. Adminul îl poate
   * muta, redenumi sau pune într-un submeniu din Manager meniu.
   */
  private async syncMenu(page: { path: string; title: string; icon: string | null; inMenu: boolean }, previousPath: string | null): Promise<void> {
    const { db, bus, settings } = this.deps;
    const href = pageHref(page.path);
    const hrefs = [...new Set([href, ...(previousPath ? [pageHref(previousPath)] : [])])];
    const items = await db.navItem.findMany({ where: { href: { in: hrefs }, appKey: "pages" }, select: { id: true, href: true } });
    if (!page.inMenu) {
      if (items.length === 0) return;
      await db.navItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    } else if (items.length > 0) {
      await db.navItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { href } });
    } else {
      const locale = (await settings.get<string>("site.locale")) || "ro";
      const position = await db.navItem.count({ where: { parentId: null } });
      await db.navItem.create({ data: { parentId: null, position, label: { [locale]: page.title }, icon: page.icon ?? "fa-solid fa-file-lines", href, appKey: "pages", kind: "app" } });
    }
    await bus.emit({ name: "nav.updated", payload: {}, tags: ["nav"] });
  }

  /** Ordinea fraților (tragerea în arbore): `ids` = copiii lui `parentId`, în ordinea nouă. */
  async reorder(actor: GcsActor, parentId: number | null, ids: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const siblings = await db.pagesNode.findMany({ where: { parentId }, select: { id: true } });
    const known = new Set(siblings.map((s) => s.id));
    if (ids.length !== known.size || ids.some((i) => !known.has(i))) throw new GcsValidationError({ order: "invalid_choice" });
    await db.$transaction(ids.map((nodeId, position) => db.pagesNode.update({ where: { id: nodeId }, data: { position } })));
    await this.changed();
  }

  /** Copia unei pagini (aceleași setări și același layout, nepublicată, fără bază de date și fără meniu). */
  async duplicate(actor: GcsActor, id: number): Promise<{ id: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const n = await db.pagesNode.findUnique({ where: { id } });
    if (!n || n.kind !== "page") throw new GcsNotFound();
    let slug = `${n.slug}-copie`.slice(0, 80);
    for (let i = 2; await db.pagesNode.findUnique({ where: { path: await this.pathFor(n.parentId, slug) }, select: { id: true } }); i++) slug = `${n.slug}-copie-${i}`.slice(0, 80);
    const created = await db.pagesNode.create({
      data: {
        kind: "page",
        parentId: n.parentId,
        title: n.title,
        slug,
        path: await this.pathFor(n.parentId, slug),
        position: await db.pagesNode.count({ where: { parentId: n.parentId } }),
        icon: n.icon,
        contentType: "layout",
        layout: (n.contentType === "layout" ? n.layout : EMPTY_LAYOUT) as Prisma.InputJsonValue,
        published: false,
        showTitle: n.showTitle,
        viewGroupIds: n.viewGroupIds as Prisma.InputJsonValue,
        seoTitle: n.seoTitle,
        seoDescription: n.seoDescription,
        seoImageId: n.seoImageId,
        noindex: n.noindex,
        updatedById: actor.userId,
      },
    });
    await writeAudit(db, { actorId: actor.userId, action: "pages.node.duplicate", targetType: "pages_node", targetId: String(created.id), before: { from: id }, after: { path: created.path }, ip: actor.ip });
    await this.changed();
    return { id: created.id };
  }

  /** Șterge o pagină sau un folder gol (baza de date a paginii rămâne, fără pagină; itemul din meniu dispare). */
  async deleteNode(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, settings } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "delete");
    const n = await db.pagesNode.findUnique({ where: { id }, select: { id: true, path: true, title: true, _count: { select: { children: true } } } });
    if (!n) throw new GcsNotFound();
    if (n._count.children > 0) throw new GcsConflict({ reason: "not_empty" });
    await db.$transaction(async (tx) => {
      await tx.pagesNode.delete({ where: { id } });
      await tx.navItem.deleteMany({ where: { href: pageHref(n.path), appKey: "pages" } });
      await writeAudit(tx, { actorId: actor.userId, action: "pages.node.delete", targetType: "pages_node", targetId: String(id), before: { title: n.title, path: n.path }, after: null, ip: actor.ip });
    });
    if ((await settings.get<number>("pages.home_page")) === id) await settings.set("pages.home_page", 0, actor);
    await this.deps.bus.emit({ name: "nav.updated", payload: {}, tags: ["nav"] });
    await this.changed();
  }

  // ─── Constructorul ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Salvează layout-ul unei pagini: structura (secțiuni, coloane, blocuri), conținutul fiecărui bloc randat ca o
   * postare (cu blocurile permise actorului), HTML-ul curățat, config-ul widget-urilor validat de modulul lor, bazele de
   * date și fișierele din bibliotecă existente. Erorile vin pe bloc (`block.<id>`).
   */
  async saveLayout(actor: GcsActor, id: number, raw: unknown): Promise<GcsPagesLayout> {
    const { db, acp, registry, render } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const node = await db.pagesNode.findUnique({ where: { id }, select: { id: true, kind: true, layout: true } });
    if (!node || node.kind !== "page") throw new GcsNotFound();
    const { layout, errors } = parseLayout(raw);
    const blocks = layoutBlocks(layout);
    const dbIds = [...new Set(blocks.flatMap((b) => (b.type === "records" ? [b.databaseId] : [])))];
    const mediaIds = [...new Set(blocks.flatMap((b) => (b.type === "image" && b.mediaId ? [b.mediaId] : [])))];
    const blockIds = [...new Set(blocks.flatMap((b) => (b.type === "block" ? [b.blockId] : [])))];
    const folderIds = [...new Set(blocks.flatMap((b) => (b.type === "pages" && b.folderId ? [b.folderId] : [])))];
    const [dbs, media, reusable, folders] = await Promise.all([
      dbIds.length ? db.pagesDatabase.findMany({ where: { id: { in: dbIds } }, select: { id: true, categories: { select: { id: true } } } }) : [],
      mediaIds.length ? db.pagesMedia.findMany({ where: { id: { in: mediaIds } }, select: { id: true } }) : [],
      blockIds.length ? db.pagesBlock.findMany({ where: { id: { in: blockIds } }, select: { id: true } }) : [],
      folderIds.length ? db.pagesNode.findMany({ where: { id: { in: folderIds }, kind: "folder" }, select: { id: true } }) : [],
    ]);
    const dbMap = new Map(dbs.map((d) => [d.id, new Set(d.categories.map((c) => c.id))]));
    const mediaSet = new Set(media.map((m) => m.id));
    const blockSet = new Set(reusable.map((b) => b.id));
    const folderSet = new Set(folders.map((f) => f.id));
    for (const b of blocks) {
      const key = `block.${b.id}`;
      if (b.icon && !isGcsIcon(b.icon)) b.icon = null;
      switch (b.type) {
        case "content":
          try {
            const rendered = b.doc ? await render(b.doc, actor) : null;
            b.html = rendered?.html ?? "";
            b.doc = rendered?.json ?? null;
          } catch (error) {
            if (error instanceof GcsValidationError) errors[key] = Object.values(error.fields)[0] ?? "invalid";
            else throw error;
          }
          break;
        case "html":
          b.html = sanitizePageHtml(b.html);
          break;
        case "widget": {
          const def = registry.widgetDef(b.widget);
          const config = def?.def.config(b.config) ?? null;
          if (!def || !config) errors[key] = "invalid_widget";
          else b.config = config;
          break;
        }
        case "records": {
          const cats = dbMap.get(b.databaseId);
          if (!cats) errors[key] = "invalid_database";
          else if (b.categoryId !== null && !cats.has(b.categoryId)) b.categoryId = null;
          break;
        }
        case "image":
          if (b.mediaId !== null && !mediaSet.has(b.mediaId)) errors[key] = "invalid_media";
          if (b.link && !isSafeLink(b.link)) errors[key] = "invalid_url";
          break;
        case "block":
          if (!blockSet.has(b.blockId)) errors[key] = "invalid_block";
          break;
        case "pages":
          if (b.folderId !== null && !folderSet.has(b.folderId)) b.folderId = null;
          break;
      }
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    await db.$transaction(async (tx) => {
      await this.keepRevision(tx, id, "layout", node.layout, "", actor);
      await tx.pagesNode.update({ where: { id }, data: { layout: layout as unknown as Prisma.InputJsonValue, updatedById: actor.userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "pages.layout.save", targetType: "pages_node", targetId: String(id), before: null, after: { sections: layout.sections.length, blocks: blocks.length }, ip: actor.ip });
    });
    await this.changed({ nodeId: id });
    return layout;
  }

  /** Versiunea de dinainte a conținutului (doar dacă avea ceva); se păstrează ultimele `MAX_REVISIONS`. */
  private async keepRevision(tx: Prisma.TransactionClient, nodeId: number, kind: "layout" | "html", layout: unknown, html: string, actor: GcsActor): Promise<void> {
    const hasContent = kind === "html" ? html.trim() !== "" : layoutBlocks(layoutOf(layout)).length > 0;
    if (!hasContent) return;
    await tx.pagesRevision.create({ data: { nodeId, kind, layout: kind === "layout" ? (layout as Prisma.InputJsonValue) : Prisma.DbNull, html, actorId: actor.userId } });
    const old = await tx.pagesRevision.findMany({ where: { nodeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: MAX_REVISIONS, select: { id: true } });
    if (old.length > 0) await tx.pagesRevision.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }

  /** Pagina „HTML manual”: HTML-ul curățat (cu etichetele `{block="…"}` / `{database="…"}` păstrate). */
  async saveHtml(actor: GcsActor, id: number, html: string): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const node = await db.pagesNode.findUnique({ where: { id }, select: { id: true, kind: true, html: true } });
    if (!node || node.kind !== "page") throw new GcsNotFound();
    if (html.length > MAX_PAGE_HTML) throw new GcsValidationError({ html: "too_long" });
    const clean = sanitizePageHtml(html);
    await db.$transaction(async (tx) => {
      await this.keepRevision(tx, id, "html", null, node.html, actor);
      await tx.pagesNode.update({ where: { id }, data: { html: clean, updatedById: actor.userId } });
      await writeAudit(tx, { actorId: actor.userId, action: "pages.html.save", targetType: "pages_node", targetId: String(id), before: null, after: { length: clean.length }, ip: actor.ip });
    });
    await this.changed({ nodeId: id });
  }

  /** Versiunile salvate ale unei pagini (cele mai noi primele), cu autorul. */
  async revisions(actor: GcsActor, nodeId: number) {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "view");
    const rows = await db.pagesRevision.findMany({ where: { nodeId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_REVISIONS });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => x !== null))];
    const users = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind === "html" ? ("html" as const) : ("layout" as const),
      at: r.createdAt.toISOString(),
      actor: r.actorId ? (users.get(r.actorId) ?? null) : null,
      blocks: r.kind === "layout" ? layoutBlocks(layoutOf(r.layout)).length : 0,
      length: r.html.length,
    }));
  }

  /** Restaurează o versiune (versiunea de acum devine și ea o versiune, deci restaurarea se poate anula). */
  async restoreRevision(actor: GcsActor, revisionId: number): Promise<{ nodeId: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const rev = await db.pagesRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw new GcsNotFound();
    const node = await db.pagesNode.findUnique({ where: { id: rev.nodeId }, select: { id: true, layout: true, html: true } });
    if (!node) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      if (rev.kind === "html") {
        await this.keepRevision(tx, node.id, "html", null, node.html, actor);
        await tx.pagesNode.update({ where: { id: node.id }, data: { html: rev.html, updatedById: actor.userId } });
      } else {
        await this.keepRevision(tx, node.id, "layout", node.layout, "", actor);
        await tx.pagesNode.update({ where: { id: node.id }, data: { layout: (rev.layout ?? EMPTY_LAYOUT) as Prisma.InputJsonValue, updatedById: actor.userId } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "pages.revision.restore", targetType: "pages_node", targetId: String(node.id), before: null, after: { revisionId }, ip: actor.ip });
    });
    await this.changed({ nodeId: node.id });
    return { nodeId: node.id };
  }

  // ─── Blocurile reutilizabile ───────────────────────────────────────────────────────────────────────────────

  async blocks(actor: GcsActor) {
    await this.deps.acp.assert(actor, PAGES_ACP.pages, "view");
    const rows = await this.deps.db.pagesBlock.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
    return rows.map((b) => ({ ...b, fields: blockFieldsOf(b.fields), values: (b.values && typeof b.values === "object" && !Array.isArray(b.values) ? b.values : {}) as Record<string, string> }));
  }

  /**
   * Un bloc reutilizabil: conținut bogat (randat ca o postare), HTML curățat sau șablon cu câmpuri (`{{cheie}}` înlocuit
   * cu valoarea câmpului, escapată, apoi totul curățat). Cheia e unică (eticheta `{block="cheie"}`).
   */
  async saveBlock(actor: GcsActor, id: number | null, input: { key?: string; name: string; description?: string; category?: string; kind: string; content?: unknown; html?: string; fields?: unknown; values?: Record<string, unknown> }): Promise<{ id: number }> {
    const { db, acp, render } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const existing = id === null ? null : await db.pagesBlock.findUnique({ where: { id } });
    if (id !== null && !existing) throw new GcsNotFound();
    const errors: Record<string, string> = {};
    const name = text(input.name, 80);
    if (name.length < 2) errors.name = "too_short";
    const key = (input.key ?? "").trim().toLowerCase() || existing?.key || slugify(name).slice(0, 60);
    if (!SLUG_RE.test(key)) errors.key = "invalid_slug";
    else {
      const clash = await db.pagesBlock.findUnique({ where: { key }, select: { id: true } });
      if (clash && clash.id !== id) errors.key = "taken";
    }
    const kind = input.kind === "html" || input.kind === "template" ? input.kind : "content";
    let contentJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let html = "";
    const fields = kind === "template" ? blockFieldsOf(input.fields) : [];
    const values: Record<string, string> = {};
    if (kind === "content") {
      try {
        const rendered = input.content ? await render(input.content, actor) : null;
        contentJson = rendered ? (rendered.json as Prisma.InputJsonValue) : Prisma.DbNull;
        html = rendered?.html ?? "";
      } catch (error) {
        if (error instanceof GcsValidationError) Object.assign(errors, error.fields);
        else throw error;
      }
    } else if (kind === "html") {
      html = sanitizePageHtml(input.html ?? "");
    } else {
      const source = (input.html ?? "").slice(0, MAX_PAGE_HTML);
      for (const f of fields) values[f.key] = String(input.values?.[f.key] ?? "").slice(0, 5000);
      html = sanitizePageHtml(fillBlockTemplate(source, fields, values));
      contentJson = source as unknown as Prisma.InputJsonValue;
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { key, name, description: text(input.description, 300), category: text(input.category, 60), kind, contentJson, html, fields: fields as unknown as Prisma.InputJsonValue, values };
    const row = existing ? await db.pagesBlock.update({ where: { id: existing.id }, data }) : await db.pagesBlock.create({ data });
    await writeAudit(db, { actorId: actor.userId, action: existing ? "pages.block.update" : "pages.block.create", targetType: "pages_block", targetId: String(row.id), before: existing ? { name: existing.name, key: existing.key } : null, after: { name, key, kind }, ip: actor.ip });
    await this.changed();
    return { id: row.id };
  }

  async deleteBlock(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.pages, "delete");
    const b = await db.pagesBlock.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!b) throw new GcsNotFound();
    await db.pagesBlock.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "pages.block.delete", targetType: "pages_block", targetId: String(id), before: { name: b.name }, after: null, ip: actor.ip });
    await this.changed();
  }

  // ─── Bazele de date ────────────────────────────────────────────────────────────────────────────────────────

  async databases(actor: GcsActor) {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "view");
    const rows = await db.pagesDatabase.findMany({ orderBy: { name: "asc" }, include: { node: { select: { id: true, path: true, title: true } }, _count: { select: { categories: true } } } });
    const pending = await db.pagesRecord.groupBy({ by: ["databaseId"], where: { status: "PENDING" }, _count: { _all: true } });
    const pendingBy = new Map(pending.map((p) => [p.databaseId, p._count._all]));
    return rows.map((d) => ({
      id: d.id,
      key: d.key,
      name: d.name,
      description: d.description,
      icon: d.icon,
      template: d.template,
      recordsCount: d.recordsCount,
      pending: pendingBy.get(d.id) ?? 0,
      categories: d._count.categories,
      fields: fieldDefsOf(d.fields).length,
      node: d.node,
      submissions: d.submissions,
      comments: d.comments,
      ratings: d.ratings,
    }));
  }

  async database(actor: GcsActor, id: number) {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "view");
    const d = Number.isSafeInteger(id) ? await db.pagesDatabase.findUnique({ where: { id }, include: { node: { select: { id: true, path: true, title: true } }, categories: { orderBy: [{ position: "asc" }, { id: "asc" }] } } }) : null;
    if (!d) return null;
    const covers = new Map(
      (await db.pagesMedia.findMany({ where: { attachmentId: { in: d.categories.flatMap((c) => (c.imageId ? [c.imageId] : [])) } }, select: { id: true, attachmentId: true } })).map((m) => [m.attachmentId, m.id]),
    );
    return {
      ...d,
      categories: d.categories.map((c) => ({ ...c, viewGroupIds: jsonInts(c.viewGroupIds), coverMediaId: c.imageId ? (covers.get(c.imageId) ?? null) : null })),
      fields: fieldDefsOf(d.fields),
      viewGroupIds: jsonInts(d.viewGroupIds),
      submitGroupIds: jsonInts(d.submitGroupIds),
      commentGroupIds: jsonInts(d.commentGroupIds),
      rateGroupIds: jsonInts(d.rateGroupIds),
    };
  }

  /** Cheia unică a unei baze de date, propusă din nume (`ghiduri`, `ghiduri-2`…). */
  private async freeKey(base: string, own: number | null = null): Promise<string> {
    const root = (SLUG_RE.test(base) ? base : slugify(base)).slice(0, 40);
    for (let i = 1; ; i++) {
      const key = i === 1 ? root : `${root}-${i}`;
      const row = await this.deps.db.pagesDatabase.findUnique({ where: { key }, select: { id: true } });
      if (!row || row.id === own) return key;
    }
  }

  private async groupsValid(ids: number[] | undefined): Promise<boolean> {
    const list = [...new Set(ids ?? [])];
    return list.length === 0 || (await this.deps.db.group.count({ where: { id: { in: list } } })) === list.length;
  }

  async saveDatabase(actor: GcsActor, id: number | null, input: GcsPagesDatabaseInput): Promise<{ id: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "edit");
    const existing = id === null ? null : await db.pagesDatabase.findUnique({ where: { id } });
    if (id !== null && !existing) throw new GcsNotFound();
    const errors: Record<string, string> = {};
    const name = text(input.name, 80);
    if (name.length < 2) errors.name = "too_short";
    const rawKey = (input.key ?? "").trim().toLowerCase();
    if (rawKey && !SLUG_RE.test(rawKey)) errors.key = "invalid_slug";
    if (rawKey) {
      const clash = await db.pagesDatabase.findUnique({ where: { key: rawKey }, select: { id: true } });
      if (clash && clash.id !== id) errors.key = "taken";
    }
    const icon = iconOrNull(input.icon);
    if (icon && !isGcsIcon(icon)) errors.icon = "invalid_choice";
    let fields: GcsPagesFieldDef[] = existing ? fieldDefsOf(existing.fields) : [];
    if (input.fields !== undefined) {
      const parsed = parseFieldDefs(input.fields);
      Object.assign(errors, parsed.errors);
      fields = parsed.defs;
    }
    const listLayout = input.listLayout ?? existing?.listLayout ?? "list";
    if (!(PAGES_LIST_LAYOUTS as readonly string[]).includes(listLayout)) errors.listLayout = "invalid_choice";
    const sort = input.sort ?? existing?.sort ?? "newest";
    if (!(PAGES_DB_SORTS as readonly string[]).includes(sort)) errors.sort = "invalid_choice";
    const perPage = input.perPage ?? existing?.perPage ?? 20;
    if (!Number.isInteger(perPage) || perPage < 5 || perPage > 100) errors.perPage = "invalid_range";
    for (const k of ["viewGroupIds", "submitGroupIds", "commentGroupIds", "rateGroupIds"] as const) if (!(await this.groupsValid(input[k]))) errors[k] = "invalid_choice";
    const indexMode = input.indexMode ?? existing?.indexMode ?? "all";
    if (!(PAGES_INDEX_MODES as readonly string[]).includes(indexMode)) errors.indexMode = "invalid_choice";
    const forumId = input.forumId === undefined ? (existing?.forumId ?? null) : input.forumId;
    if (forumId !== null) {
      const forum = await db.forum.findUnique({ where: { id: forumId }, select: { type: true } });
      if (!forum || (forum.type !== "FORUM" && forum.type !== "QA")) errors.forumId = "invalid_choice";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const data = {
      name,
      key: rawKey || existing?.key || (await this.freeKey(name, id)),
      description: input.description === undefined ? (existing?.description ?? "") : text(input.description, 500),
      icon: input.icon === undefined ? (existing?.icon ?? null) : icon,
      recordLabel: input.recordLabel === undefined ? (existing?.recordLabel ?? "") : text(input.recordLabel, 40),
      fields: fields as unknown as Prisma.InputJsonValue,
      listLayout,
      sort,
      perPage,
      comments: input.comments ?? existing?.comments ?? true,
      ratings: input.ratings ?? existing?.ratings ?? true,
      submissions: input.submissions ?? existing?.submissions ?? false,
      approval: input.approval ?? existing?.approval ?? true,
      authorEdit: input.authorEdit ?? existing?.authorEdit ?? true,
      searchable: input.searchable ?? existing?.searchable ?? true,
      inStream: input.inStream ?? existing?.inStream ?? true,
      useCategories: input.useCategories ?? existing?.useCategories ?? true,
      indexMode,
      recordPlural: input.recordPlural === undefined ? (existing?.recordPlural ?? "") : text(input.recordPlural, 40),
      commentApproval: input.commentApproval ?? existing?.commentApproval ?? false,
      recordImage: input.recordImage ?? existing?.recordImage ?? true,
      rss: input.rss ?? existing?.rss ?? true,
      wiki: input.wiki ?? existing?.wiki ?? false,
      revisions: input.revisions ?? existing?.revisions ?? true,
      forumId,
      viewGroupIds: [...new Set(input.viewGroupIds ?? jsonInts(existing?.viewGroupIds))],
      submitGroupIds: [...new Set(input.submitGroupIds ?? jsonInts(existing?.submitGroupIds))],
      commentGroupIds: [...new Set(input.commentGroupIds ?? jsonInts(existing?.commentGroupIds))],
      rateGroupIds: [...new Set(input.rateGroupIds ?? jsonInts(existing?.rateGroupIds))],
    };
    const saved = await db.$transaction(async (tx) => {
      const row = existing ? await tx.pagesDatabase.update({ where: { id: existing.id }, data }) : await tx.pagesDatabase.create({ data });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: existing ? "pages.database.update" : "pages.database.create",
        targetType: "pages_database",
        targetId: String(row.id),
        before: existing ? { name: existing.name, key: existing.key, submissions: existing.submissions, approval: existing.approval } : null,
        after: { name: data.name, key: data.key, submissions: data.submissions, approval: data.approval, fields: fields.map((f) => f.key) },
        ip: actor.ip,
      });
      return row;
    });
    await this.changed({ databaseId: saved.id });
    return { id: saved.id };
  }

  /**
   * „Creează din șablon”: baza de date (câmpurile, categoriile și funcțiile șablonului, cu textele traduse de `t`) și
   * pagina ei (`/pages/<cheie>`, sub `parentId` dacă e dat), într-un singur pas.
   */
  async createFromPreset(actor: GcsActor, preset: GcsPagesPreset, t: (key: string) => string, opts: { parentId?: number | null; name?: string } = {}): Promise<{ databaseId: number; nodeId: number; path: string }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "edit");
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    if (!PAGES_PRESET_DEFS[preset]) throw new GcsValidationError({ preset: "invalid_choice" });
    const data = presetData(preset, t);
    const name = text(opts.name, 80) || data.name;
    const key = await this.freeKey(preset === "blank" ? slugify(name) : data.slug);
    const { id: databaseId } = await this.saveDatabase(actor, null, {
      name,
      key,
      description: data.description,
      icon: data.icon,
      recordLabel: data.recordLabel,
      fields: data.fields,
      listLayout: data.listLayout,
      sort: data.sort,
      comments: data.comments,
      ratings: data.ratings,
      submissions: data.submissions,
      approval: data.approval,
    });
    await db.pagesDatabase.update({ where: { id: databaseId }, data: { template: preset } });
    for (const [position, c] of data.categories.entries()) {
      await db.pagesCategory.create({ data: { databaseId, name: text(c.name, 80), slug: slugify(c.name).slice(0, 60), description: text(c.description, 300), icon: c.icon, position } });
    }
    // Slug-ul paginii: cheia bazei de date, liber sub părinte.
    const parentId = opts.parentId ?? null;
    let slug = key;
    for (let i = 2; await db.pagesNode.findUnique({ where: { path: await this.pathFor(parentId, slug) }, select: { id: true } }); i++) slug = `${key}-${i}`;
    const node = await this.saveNode(actor, null, { kind: "page", parentId, title: name, slug, icon: data.icon, contentType: "database", databaseId, published: true });
    return { databaseId, nodeId: node.id, path: node.path };
  }

  /** Șterge o bază de date cu înregistrările, categoriile, comentariile și fișierele lor; pagina ei devine o pagină goală. */
  async deleteDatabase(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, attachments } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "delete");
    const d = await db.pagesDatabase.findUnique({ where: { id }, select: { id: true, name: true, key: true, recordsCount: true } });
    if (!d) throw new GcsNotFound();
    const recordIds = (await db.pagesRecord.findMany({ where: { databaseId: id }, select: { id: true } })).map((r) => String(r.id));
    await db.$transaction(async (tx) => {
      await tx.pagesNode.updateMany({ where: { databaseId: id }, data: { contentType: "layout", databaseId: null } });
      await tx.pagesDatabase.delete({ where: { id } });
      if (recordIds.length > 0) {
        await tx.contentRating.deleteMany({ where: { contentType: PAGES_RECORD_TYPE, contentId: { in: recordIds } } });
        await tx.contentRatingSummary.deleteMany({ where: { contentType: PAGES_RECORD_TYPE, contentId: { in: recordIds } } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "pages.database.delete", targetType: "pages_database", targetId: String(id), before: { name: d.name, key: d.key, records: d.recordsCount }, after: null, ip: actor.ip });
    });
    if (recordIds.length > 0) await attachments.deleteFor(PAGES_RECORD_TYPE, recordIds);
    await this.changed({ databaseId: id });
  }

  /**
   * Pachetul unei baze de date (descărcare): setările, câmpurile, categoriile și, opțional, înregistrările publicate
   * (titlul, conținutul, valorile câmpurilor fără fișiere). Grupurile și forumul nu pleacă (sunt ale acestui site).
   */
  async exportDatabase(actor: GcsActor, id: number, withRecords: boolean): Promise<GcsPagesDatabasePackage> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "view");
    const d = await db.pagesDatabase.findUnique({ where: { id }, include: { categories: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
    if (!d) throw new GcsNotFound();
    const fields = fieldDefsOf(d.fields);
    const slugOf = new Map(d.categories.map((c) => [c.id, c.slug]));
    const records = withRecords
      ? await db.pagesRecord.findMany({ where: { databaseId: id, status: "PUBLISHED" }, orderBy: { id: "asc" }, take: 2000, select: { title: true, contentJson: true, fields: true, categoryId: true, featured: true, pinned: true } })
      : [];
    const fileKeys = new Set(fields.filter((f) => f.type === "image" || f.type === "file" || f.type === "member" || f.type === "server").map((f) => f.key));
    return {
      format: "gcs-pages-database",
      v: 1,
      database: {
        name: d.name,
        key: d.key,
        description: d.description,
        icon: d.icon,
        template: d.template,
        recordLabel: d.recordLabel,
        recordPlural: d.recordPlural,
        fields,
        listLayout: d.listLayout,
        sort: d.sort,
        perPage: d.perPage,
        comments: d.comments,
        ratings: d.ratings,
        submissions: d.submissions,
        approval: d.approval,
        authorEdit: d.authorEdit,
        searchable: d.searchable,
        inStream: d.inStream,
        useCategories: d.useCategories,
        indexMode: d.indexMode,
        commentApproval: d.commentApproval,
        recordImage: d.recordImage,
        rss: d.rss,
        wiki: d.wiki,
        revisions: d.revisions,
      },
      categories: d.categories.map((c) => ({ name: c.name, slug: c.slug, description: c.description, icon: c.icon, color: c.color, private: c.private, parent: c.parentId ? (slugOf.get(c.parentId) ?? null) : null })),
      records: records.map((r) => ({
        title: r.title,
        content: r.contentJson,
        fields: Object.fromEntries(Object.entries((r.fields ?? {}) as Record<string, unknown>).filter(([k]) => !fileKeys.has(k))),
        category: r.categoryId ? (slugOf.get(r.categoryId) ?? null) : null,
        featured: r.featured,
        pinned: r.pinned,
      })),
    };
  }

  /** Importă un pachet descărcat (din acest site sau din altul): o bază nouă, cu categoriile, înregistrările și pagina ei. */
  async importDatabase(actor: GcsActor, pkg: unknown, opts: { parentId?: number | null } = {}): Promise<{ databaseId: number; nodeId: number; path: string; records: number }> {
    const { db, acp, render } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "edit");
    await acp.assert(actor, PAGES_ACP.pages, "edit");
    const p = (pkg && typeof pkg === "object" ? pkg : {}) as Partial<GcsPagesDatabasePackage>;
    if (p.format !== "gcs-pages-database" || p.v !== 1 || !p.database || typeof p.database !== "object") throw new GcsValidationError({ file: "invalid_package" });
    const src = p.database as GcsPagesDatabasePackage["database"];
    const key = await this.freeKey(typeof src.key === "string" ? src.key : slugify(String(src.name ?? "baza")));
    const { id: databaseId } = await this.saveDatabase(actor, null, { ...src, key, icon: src.icon && isGcsIcon(src.icon) ? src.icon : null, name: String(src.name ?? key) });
    await db.pagesDatabase.update({ where: { id: databaseId }, data: { template: typeof src.template === "string" ? src.template.slice(0, 20) : "blank" } });
    const cats = Array.isArray(p.categories) ? p.categories.slice(0, 200) : [];
    const idBySlug = new Map<string, number>();
    for (const [position, c] of cats.entries()) {
      const slug = typeof c.slug === "string" && SLUG_RE.test(c.slug) ? c.slug : slugify(String(c.name ?? "categorie")).slice(0, 60);
      if (idBySlug.has(slug)) continue;
      const row = await db.pagesCategory.create({
        data: { databaseId, name: text(c.name, 80) || slug, slug, description: text(c.description, 300), icon: c.icon && isGcsIcon(c.icon) ? c.icon : null, color: c.color && COLOR_RE.test(c.color) ? c.color : null, private: c.private === true, position },
      });
      idBySlug.set(slug, row.id);
    }
    for (const c of cats) if (c.parent && idBySlug.has(c.parent) && idBySlug.has(c.slug)) await db.pagesCategory.update({ where: { id: idBySlug.get(c.slug)! }, data: { parentId: idBySlug.get(c.parent)! } });
    const fields = fieldDefsOf(src.fields);
    let imported = 0;
    for (const r of Array.isArray(p.records) ? p.records.slice(0, 2000) : []) {
      const title = text(r.title, 150);
      if (title.length < 3) continue;
      let rendered: GcsRendered | null = null;
      try {
        rendered = r.content ? await render(r.content, actor) : null;
      } catch {
        continue;
      }
      const values = Object.fromEntries(fields.filter((f) => !["image", "file", "member", "server"].includes(f.type)).flatMap((f) => (r.fields && f.key in r.fields ? [[f.key, r.fields[f.key]]] : [])));
      await db.pagesRecord.create({
        data: {
          databaseId,
          categoryId: r.category ? (idBySlug.get(r.category) ?? null) : null,
          authorId: actor.userId,
          title,
          slug: slugify(title),
          contentJson: rendered ? (rendered.json as Prisma.InputJsonValue) : Prisma.DbNull,
          contentHtml: rendered?.html ?? "",
          fields: values as Prisma.InputJsonValue,
          searchText: searchNormalize(`${title} ${rendered?.text ?? ""}`).slice(0, 20_000),
          featured: r.featured === true,
          pinned: r.pinned === true,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });
      imported++;
    }
    await db.pagesDatabase.update({ where: { id: databaseId }, data: { recordsCount: imported } });
    for (const cid of idBySlug.values()) await db.pagesCategory.update({ where: { id: cid }, data: { recordsCount: await db.pagesRecord.count({ where: { categoryId: cid } }) } });
    const parentId = opts.parentId ?? null;
    let slug = key;
    for (let i = 2; await db.pagesNode.findUnique({ where: { path: await this.pathFor(parentId, slug) }, select: { id: true } }); i++) slug = `${key}-${i}`;
    const node = await this.saveNode(actor, null, { kind: "page", parentId, title: String(src.name ?? key).slice(0, 120), slug, icon: src.icon && isGcsIcon(src.icon) ? src.icon : null, contentType: "database", databaseId, published: true });
    return { databaseId, nodeId: node.id, path: node.path, records: imported };
  }

  // ─── Categoriile ───────────────────────────────────────────────────────────────────────────────────────────

  async saveCategory(actor: GcsActor, databaseId: number, id: number | null, input: GcsPagesCategoryInput): Promise<{ id: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "edit");
    const base = await db.pagesDatabase.findUnique({ where: { id: databaseId }, select: { id: true } });
    const existing = id === null ? null : await db.pagesCategory.findFirst({ where: { id, databaseId } });
    if (!base || (id !== null && !existing)) throw new GcsNotFound();
    const errors: Record<string, string> = {};
    const name = text(input.name, 80);
    if (name.length < 2) errors.name = "too_short";
    const slug = (input.slug ?? "").trim() ? (input.slug ?? "").trim().toLowerCase() : slugify(name).slice(0, 60);
    if (!SLUG_RE.test(slug)) errors.slug = "invalid_slug";
    else {
      const clash = await db.pagesCategory.findUnique({ where: { databaseId_slug: { databaseId, slug } }, select: { id: true } });
      if (clash && clash.id !== id) errors.slug = "taken";
    }
    const icon = iconOrNull(input.icon);
    if (icon && !isGcsIcon(icon)) errors.icon = "invalid_choice";
    const color = input.color?.trim() || null;
    if (color && !COLOR_RE.test(color)) errors.color = "invalid_color";
    // Părintele: o categorie a aceleiași baze, fără cicluri.
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const all = await db.pagesCategory.findMany({ where: { databaseId }, select: { id: true, parentId: true } });
      const byId = new Map(all.map((c) => [c.id, c.parentId]));
      if (!byId.has(parentId)) errors.parentId = "invalid_parent";
      else for (let cur: number | null = parentId, n = 0; cur !== null && n < 50; cur = byId.get(cur) ?? null, n++) if (cur === id) errors.parentId = "cycle";
    }
    const cover = input.mediaId ? await db.pagesMedia.findUnique({ where: { id: input.mediaId }, select: { attachmentId: true } }) : null;
    if (input.mediaId && !cover) errors.mediaId = "invalid_choice";
    if (!(await this.groupsValid(input.viewGroupIds))) errors.viewGroupIds = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      name,
      slug,
      description: text(input.description, 300),
      icon,
      color,
      parentId,
      imageId: input.mediaId === undefined ? (existing?.imageId ?? null) : (cover?.attachmentId ?? null),
      viewGroupIds: [...new Set(input.viewGroupIds ?? jsonInts(existing?.viewGroupIds))],
      private: input.private ?? existing?.private ?? false,
    };
    const row = existing
      ? await db.pagesCategory.update({ where: { id: existing.id }, data })
      : await db.pagesCategory.create({ data: { ...data, databaseId, position: await db.pagesCategory.count({ where: { databaseId } }) } });
    await writeAudit(db, { actorId: actor.userId, action: existing ? "pages.category.update" : "pages.category.create", targetType: "pages_database", targetId: String(databaseId), before: existing ? { name: existing.name } : null, after: { name, slug }, ip: actor.ip });
    await this.changed({ databaseId });
    return { id: row.id };
  }

  /** Șterge o categorie; înregistrările ei rămân fără categorie. */
  async deleteCategory(actor: GcsActor, databaseId: number, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "delete");
    const c = await db.pagesCategory.findFirst({ where: { id, databaseId } });
    if (!c) throw new GcsNotFound();
    await db.$transaction([db.pagesCategory.updateMany({ where: { parentId: id }, data: { parentId: c.parentId } }), db.pagesCategory.delete({ where: { id } })]);
    await writeAudit(db, { actorId: actor.userId, action: "pages.category.delete", targetType: "pages_database", targetId: String(databaseId), before: { name: c.name }, after: null, ip: actor.ip });
    await this.changed({ databaseId });
  }

  async reorderCategories(actor: GcsActor, databaseId: number, ids: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.databases, "edit");
    const rows = await db.pagesCategory.findMany({ where: { databaseId }, select: { id: true } });
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== known.size || ids.some((i) => !known.has(i))) throw new GcsValidationError({ order: "invalid_choice" });
    await db.$transaction(ids.map((cid, position) => db.pagesCategory.update({ where: { id: cid }, data: { position } })));
    await this.changed({ databaseId });
  }

  // ─── Biblioteca media ──────────────────────────────────────────────────────────────────────────────────────

  /** Un folder al bibliotecii: subfolderele, fișierele (căutate după titlu sau nume), calea până la el. */
  async media(actor: GcsActor, query: { folderId: number | null; q?: string; page?: number; images?: boolean }) {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "view");
    const q = (query.q ?? "").trim().slice(0, 60);
    const folder = query.folderId ? await db.pagesMediaFolder.findUnique({ where: { id: query.folderId } }) : null;
    const folderId = folder?.id ?? null;
    const crumbs: { id: number; name: string }[] = [];
    for (let cur = folder; cur; cur = cur.parentId ? await db.pagesMediaFolder.findUnique({ where: { id: cur.parentId } }) : null) crumbs.unshift({ id: cur.id, name: cur.name });
    const where: Prisma.PagesMediaWhereInput = q ? { OR: [{ title: ci({ contains: q }) }, { alt: ci({ contains: q }) }] } : { folderId };
    const total = await db.pagesMedia.count({ where });
    const pages = Math.max(1, Math.ceil(total / MEDIA_PER_PAGE));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    const [folders, rows] = await Promise.all([
      q ? [] : db.pagesMediaFolder.findMany({ where: { parentId: folderId }, orderBy: { name: "asc" }, include: { _count: { select: { items: true, children: true } } } }),
      db.pagesMedia.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * MEDIA_PER_PAGE, take: MEDIA_PER_PAGE }),
    ]);
    const atts = new Map((await db.attachment.findMany({ where: { id: { in: rows.map((r) => r.attachmentId) } } })).map((a) => [a.id, a]));
    const items: GcsPagesMediaItem[] = rows.flatMap((r) => {
      const a = atts.get(r.attachmentId);
      if (!a) return [];
      const isImage = a.mime.startsWith("image/");
      if (query.images && !isImage) return [];
      return [{ id: r.id, folderId: r.folderId, attachmentId: a.id, url: `/files/${a.id}`, title: r.title, alt: r.alt, filename: a.filename, mime: a.mime, size: a.size, width: a.width, height: a.height, isImage, createdAt: r.createdAt.toISOString() }];
    });
    return {
      folder: folder ? { id: folder.id, name: folder.name, parentId: folder.parentId } : null,
      crumbs,
      folders: folders.map((f) => ({ id: f.id, name: f.name, items: f._count.items, children: f._count.children })),
      items,
      pagination: { page, pages, perPage: MEDIA_PER_PAGE, total },
    };
  }

  /** Toate folderele (pentru „Mută în” și selectorul din constructor), cu calea fiecăruia. */
  async mediaFolders(actor: GcsActor): Promise<{ id: number; path: string }[]> {
    await this.deps.acp.assert(actor, PAGES_ACP.media, "view");
    const rows = await this.deps.db.pagesMediaFolder.findMany({ select: { id: true, name: true, parentId: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const path = (id: number, depth = 0): string => {
      const r = byId.get(id)!;
      return r.parentId && depth < 10 && byId.has(r.parentId) ? `${path(r.parentId, depth + 1)} / ${r.name}` : r.name;
    };
    return rows.map((r) => ({ id: r.id, path: path(r.id) })).sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Adaugă în bibliotecă fișierele deja încărcate (atașamentele actorului, încă nelegate): fiecare primește un rând cu
   * titlul din numele fișierului și se leagă de tipul `pages.media` (public).
   */
  async addMedia(actor: GcsActor, folderId: number | null, attachmentIds: string[]): Promise<number[]> {
    const { db, acp, attachments } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "edit");
    if (folderId !== null && !(await db.pagesMediaFolder.findUnique({ where: { id: folderId }, select: { id: true } }))) throw new GcsValidationError({ folderId: "invalid_choice" });
    const rows = await db.attachment.findMany({ where: { id: { in: [...new Set(attachmentIds)] }, ownerId: actor.userId, contentType: null } });
    const ids: number[] = [];
    await db.$transaction(async (tx) => {
      for (const a of rows) {
        const title = a.filename.replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || a.filename;
        const m = await tx.pagesMedia.create({ data: { folderId, attachmentId: a.id, title, uploadedById: actor.userId } });
        await attachments.attach(tx, [a.id], { contentType: PAGES_MEDIA_TYPE, contentId: String(m.id), ownerId: actor.userId! });
        ids.push(m.id);
      }
      await writeAudit(tx, { actorId: actor.userId, action: "pages.media.upload", targetType: "pages_media", targetId: String(folderId ?? 0), before: null, after: { count: ids.length }, ip: actor.ip });
    });
    return ids;
  }

  async saveMedia(actor: GcsActor, id: number, input: { title: string; alt?: string; folderId?: number | null }): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "edit");
    const m = await db.pagesMedia.findUnique({ where: { id } });
    if (!m) throw new GcsNotFound();
    const title = text(input.title, 120);
    if (!title) throw new GcsValidationError({ title: "required" });
    if (input.folderId && !(await db.pagesMediaFolder.findUnique({ where: { id: input.folderId }, select: { id: true } }))) throw new GcsValidationError({ folderId: "invalid_choice" });
    await db.pagesMedia.update({ where: { id }, data: { title, alt: text(input.alt, 300), ...(input.folderId !== undefined ? { folderId: input.folderId } : {}) } });
  }

  /** Mută mai multe fișiere într-un folder (`null` = rădăcina). */
  async moveMedia(actor: GcsActor, ids: number[], folderId: number | null): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "edit");
    if (folderId !== null && !(await db.pagesMediaFolder.findUnique({ where: { id: folderId }, select: { id: true } }))) throw new GcsValidationError({ folderId: "invalid_choice" });
    await db.pagesMedia.updateMany({ where: { id: { in: ids } }, data: { folderId } });
  }

  /** Șterge fișiere din bibliotecă (și de pe disc); paginile care le foloseau rămân, fără imagine. */
  async deleteMedia(actor: GcsActor, ids: number[]): Promise<number> {
    const { db, acp, attachments } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "delete");
    const rows = await db.pagesMedia.findMany({ where: { id: { in: ids } }, select: { id: true, attachmentId: true } });
    if (rows.length === 0) return 0;
    await db.pagesMedia.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await attachments.removeAny(rows.map((r) => r.attachmentId));
    await writeAudit(db, { actorId: actor.userId, action: "pages.media.delete", targetType: "pages_media", targetId: rows.map((r) => r.id).join(","), before: { count: rows.length }, after: null, ip: actor.ip });
    await this.changed();
    return rows.length;
  }

  async saveFolder(actor: GcsActor, id: number | null, input: { name: string; parentId: number | null }): Promise<{ id: number }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "edit");
    const name = text(input.name, 60);
    if (!name) throw new GcsValidationError({ name: "required" });
    if (input.parentId !== null) {
      const parent = await db.pagesMediaFolder.findUnique({ where: { id: input.parentId }, select: { id: true } });
      if (!parent) throw new GcsValidationError({ parentId: "invalid_parent" });
      // Fără cicluri: părintele nu poate fi folderul însuși sau un subfolder al lui.
      for (let cur: number | null = input.parentId; cur !== null; ) {
        if (cur === id) throw new GcsValidationError({ parentId: "cycle" });
        cur = (await db.pagesMediaFolder.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
    if (id === null) return { id: (await db.pagesMediaFolder.create({ data: { name, parentId: input.parentId } })).id };
    const existing = await db.pagesMediaFolder.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new GcsNotFound();
    await db.pagesMediaFolder.update({ where: { id }, data: { name, parentId: input.parentId } });
    return { id };
  }

  /** Șterge un folder: fișierele și subfolderele lui urcă în folderul părinte. */
  async deleteFolder(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PAGES_ACP.media, "delete");
    const f = await db.pagesMediaFolder.findUnique({ where: { id } });
    if (!f) throw new GcsNotFound();
    await db.$transaction([
      db.pagesMedia.updateMany({ where: { folderId: id }, data: { folderId: f.parentId } }),
      db.pagesMediaFolder.updateMany({ where: { parentId: id }, data: { parentId: f.parentId } }),
      db.pagesMediaFolder.delete({ where: { id } }),
    ]);
  }
}
