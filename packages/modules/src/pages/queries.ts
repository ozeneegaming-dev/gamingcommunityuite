import type { GcsActor, GcsContentRatingService, GcsRatingView, GcsSettingsService } from "@gcs/core";
import { Prisma, type PagesRecordStatus, type PrismaClient } from "@gcs/db";
import type { GcsContentHit, GcsContentSearchInput, GcsContentStreamEntry } from "../community/contentSources";
import { toRef, userRefSelect, type GcsPagination, type GcsUserRef } from "../forums/queries";
import { parseRef, slugify } from "../forums/slug";
import type { GcsPagesAccess, GcsPagesDb, GcsPagesTreeNode } from "./access";
import { fieldValuesOf, type GcsPagesFieldDef, type GcsPagesFieldType, type GcsPagesFieldValue } from "./fields";
import { layoutOf, type GcsPagesLayout } from "./layout";
import { readPagesOptions } from "./options";
import { PAGES_RECORD_TYPE, RESERVED_SEGMENTS, categoryHref, groupsAllow, pageHref, plainText, recordHref, searchNormalize } from "./shared";

const EXCERPT = 220;
const FILTER_SCAN = 5000;

export type GcsPagesCrumb = { title: string; href: string };

/** Valoarea unui câmp pregătită de afișat: valoarea brută, textul (opțiunile, serverul, fișierul) și linkul, dacă are. */
export type GcsPagesFieldView = { key: string; label: string; type: GcsPagesFieldType; value: GcsPagesFieldValue; display: string; url: string | null; size: number | null; badge: string | null; position: "top" | "bottom" };

export type GcsPagesCategoryView = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  href: string;
  description: string;
  icon: string | null;
  color: string | null;
  image: string | null;
  private: boolean;
  recordsCount: number;
};

export type GcsPagesRecordCard = {
  id: number;
  title: string;
  slug: string;
  href: string;
  excerpt: string;
  image: string | null;
  author: GcsUserRef | null;
  category: GcsPagesCategoryView | null;
  status: PagesRecordStatus;
  featured: boolean;
  pinned: boolean;
  isNew: boolean;
  publishedAt: string | null;
  updatedAt: string;
  views: number;
  comments: number;
  rating: { avg: number; count: number };
  /** Câmpurile marcate „apare pe card”. */
  fields: GcsPagesFieldView[];
};

export type GcsPagesListQuery = {
  categoryId?: number | null;
  page?: number;
  sort?: string;
  /** Filtrele pe câmpuri (cheia câmpului → valoarea aleasă). */
  filters?: Record<string, string>;
  q?: string;
  /** Staff-ul: înregistrările în așteptare / ascunse în loc de cele publicate. */
  status?: "pending" | "hidden" | "mine";
  /** Doar înregistrările recomandate (pagina bazei în modul „recomandate”). */
  featured?: boolean;
  limit?: number;
};

export type GcsPagesNodeView = {
  node: GcsPagesTreeNode & { showTitle: boolean; seoTitle: string | null; seoDescription: string | null; seoImage: string | null; noindex: boolean };
  layout: GcsPagesLayout;
  /** Pagina „HTML manual”: HTML-ul curățat la salvare. */
  html: string;
  crumbs: GcsPagesCrumb[];
  editor: boolean;
};

const SORTS: Record<string, Prisma.PagesRecordOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: "desc" }, { id: "desc" }],
  updated: [{ updatedAt: "desc" }, { id: "desc" }],
  title: [{ title: "asc" }, { id: "asc" }],
  rating: [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { id: "desc" }],
  views: [{ views: "desc" }, { id: "desc" }],
  comments: [{ commentsCount: "desc" }, { id: "desc" }],
  featured: [{ featured: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
};
export const PAGES_LIST_SORTS = Object.keys(SORTS);

const recordSelect = {
  id: true,
  databaseId: true,
  categoryId: true,
  authorId: true,
  title: true,
  slug: true,
  contentHtml: true,
  imageId: true,
  fields: true,
  status: true,
  featured: true,
  pinned: true,
  views: true,
  commentsCount: true,
  ratingAvg: true,
  ratingCount: true,
  publishedAt: true,
  updatedAt: true,
  createdAt: true,
} satisfies Prisma.PagesRecordSelect;
type RecordRow = Prisma.PagesRecordGetPayload<{ select: typeof recordSelect }>;

/**
 * Citirile publice ale aplicației Pagini: adresa unei pagini (cu restul căii sub o bază de date), pagina cu layout-ul
 * ei, cuprinsul, listele de înregistrări (categorii, filtre pe câmpuri, căutare, ordine), înregistrarea cu câmpurile,
 * comentariile, notele, căutarea și fluxul (sursa de conținut) și harta site-ului.
 */
export class GcsPagesQueries {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      settings: GcsSettingsService;
      access: GcsPagesAccess;
      ratings: Pick<GcsContentRatingService, "view">;
    },
  ) {}

  // ─── Paginile ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Adresa `/pages/<segmente>` → nodul (cea mai lungă cale potrivită) și restul segmentelor. Restul e permis doar sub o
   * pagină de bază de date (înregistrare, categorie, trimitere). Fără segmente: pagina de pornire aleasă, dacă e
   * vizibilă; altfel `null` (cuprinsul). Un nod invizibil arată ca inexistent.
   */
  async resolve(actor: GcsActor, segments: string[]): Promise<{ node: GcsPagesTreeNode; rest: string[] } | "directory" | null> {
    const { access, settings } = this.deps;
    if (!(await access.canUseApp(actor))) return null;
    const tree = await access.tree();
    const clean = segments.map((s) => decodeURIComponent(s).toLowerCase()).filter(Boolean);
    if (clean.length === 0) {
      // Pagina de pornire a grupului principal, apoi cea aleasă pentru toți, apoi cuprinsul.
      const homeId = await settings.get<number>("pages.home_page");
      const candidates = [...tree.filter((n) => n.kind === "page" && n.homeGroupIds.includes(actor.primaryGroupId)), ...tree.filter((n) => n.id === homeId && n.kind === "page")];
      for (const home of candidates) if (await access.canViewNode(actor, home, { tree, app: true })) return { node: home, rest: [] };
      return "directory";
    }
    const byPath = new Map(tree.map((n) => [n.path, n]));
    for (let i = clean.length; i >= 1; i--) {
      const node = byPath.get(clean.slice(0, i).join("/"));
      if (!node) continue;
      const rest = clean.slice(i);
      if (rest.length > 0 && node.contentType !== "database") return null;
      if (!(await access.canViewNode(actor, node, { tree, app: true }))) return null;
      return { node, rest };
    }
    return null;
  }

  /** Firimiturile unui nod (folderele de deasupra și nodul). */
  async crumbs(node: GcsPagesTreeNode): Promise<GcsPagesCrumb[]> {
    const tree = await this.deps.access.tree();
    return this.deps.access.chain(tree, node).map((n) => ({ title: n.title, href: pageHref(n.path) }));
  }

  /** Pagina cu layout-ul, SEO și firimiturile (nodul e deja verificat de `resolve`). */
  async pageView(actor: GcsActor, node: GcsPagesTreeNode): Promise<GcsPagesNodeView | null> {
    const { db, access } = this.deps;
    const row = await db.pagesNode.findUnique({ where: { id: node.id }, select: { layout: true, html: true, showTitle: true, seoTitle: true, seoDescription: true, seoImageId: true, noindex: true } });
    if (!row) return null;
    return {
      node: { ...node, showTitle: row.showTitle, seoTitle: row.seoTitle, seoDescription: row.seoDescription, seoImage: row.seoImageId ? `/files/${row.seoImageId}` : null, noindex: row.noindex },
      layout: layoutOf(row.layout),
      html: node.contentType === "html" ? row.html : "",
      crumbs: await this.crumbs(node),
      editor: await access.isEditor(actor),
    };
  }

  /**
   * Cuprinsul: paginile și folderele vizibile de sub un folder (`null` = rădăcina), cu copiii folderelor (un nivel),
   * dacă setarea o cere. Paginile din baze de date au numărul înregistrărilor.
   */
  async directory(actor: GcsActor, folderId: number | null) {
    const { access, settings } = this.deps;
    if (!(await access.canUseApp(actor))) return [];
    const [tree, editor, withFolders, dbs] = await Promise.all([access.tree(), access.isEditor(actor), settings.get<boolean>("pages.directory_folders"), access.databases()]);
    const counts = new Map(dbs.map((d) => [d.id, d.recordsCount]));
    const visible = async (n: GcsPagesTreeNode) => access.canViewNode(actor, n, { tree, editor, app: true });
    type Entry = { id: number; kind: "folder" | "page"; title: string; href: string; icon: string | null; published: boolean; records: number | null; updatedAt: string };
    const entry = (n: GcsPagesTreeNode): Entry => ({ id: n.id, kind: n.kind, title: n.title, href: pageHref(n.path), icon: n.icon, published: n.published, records: n.databaseId ? (counts.get(n.databaseId) ?? 0) : null, updatedAt: n.updatedAt });
    const out: (Entry & { children: Entry[] | null })[] = [];
    for (const n of tree.filter((x) => x.parentId === folderId)) {
      if (n.kind === "folder" && folderId === null && !withFolders) continue;
      if (!(await visible(n))) continue;
      const children: Entry[] | null = n.kind === "folder" ? [] : null;
      if (children) for (const c of tree.filter((x) => x.parentId === n.id)) if (await visible(c)) children.push(entry(c));
      out.push({ ...entry(n), children });
    }
    return out;
  }

  /** Paginile vizibile ale unui folder (blocul „Pagini” și widget-ul de linkuri). */
  async folderPages(actor: GcsActor, folderId: number | null): Promise<{ title: string; href: string; icon: string | null }[]> {
    return (await this.directory(actor, folderId)).filter((e) => e.kind === "page").map((e) => ({ title: e.title, href: e.href, icon: e.icon }));
  }

  // ─── Bazele de date ────────────────────────────────────────────────────────────────────────────────────────

  async databaseFor(actor: GcsActor, databaseId: number): Promise<GcsPagesDb | null> {
    const d = await this.deps.access.database(databaseId);
    return d && (await this.deps.access.canViewDatabase(actor, d)) ? d : null;
  }

  /** Categoriile vizibile actorului (grupurile proprii ale categoriei; staff-ul le vede pe toate). */
  async categories(actor: GcsActor, d: GcsPagesDb): Promise<GcsPagesCategoryView[]> {
    if (!d.useCategories) return [];
    const staff = await this.deps.access.isStaff(actor);
    const rows = await this.deps.db.pagesCategory.findMany({ where: { databaseId: d.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows
      .filter((c) => staff || groupsAllow(actor, c.viewGroupIds))
      .map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        slug: c.slug,
        href: d.path ? categoryHref(d.path, c.slug) : "#",
        description: c.description,
        icon: c.icon,
        color: c.color,
        image: c.imageId ? `/files/${c.imageId}` : null,
        private: c.private,
        recordsCount: c.recordsCount,
      }));
  }

  /**
   * Regula categoriilor pentru actor: înregistrările din categoriile pe care nu le vede lipsesc, iar într-o categorie
   * privată membrul își vede doar propriile înregistrări (staff-ul vede tot). `strict`: categoriile private lipsesc
   * de tot (căutarea, fluxul, blocurile).
   */
  private async categoryWhere(actor: GcsActor, databaseIds: number[], strict = false): Promise<Prisma.PagesRecordWhereInput> {
    if (databaseIds.length === 0 || (await this.deps.access.isStaff(actor))) return {};
    const cats = await this.deps.db.pagesCategory.findMany({ where: { databaseId: { in: databaseIds } }, select: { id: true, viewGroupIds: true, private: true } });
    const blocked = cats.filter((c) => !groupsAllow(actor, c.viewGroupIds)).map((c) => c.id);
    const priv = cats.filter((c) => c.private && !blocked.includes(c.id)).map((c) => c.id);
    const closed = [...blocked, ...priv];
    if (closed.length === 0) return {};
    const or: Prisma.PagesRecordWhereInput[] = [{ categoryId: null }, { categoryId: { notIn: closed } }];
    if (!strict && actor.userId && priv.length > 0) or.push({ categoryId: { in: priv }, authorId: actor.userId });
    return { OR: or };
  }

  /** Valorile câmpurilor pregătite de afișat (fișierele cu numele și mărimea, serverele cu numele și linkul). */
  private async fieldViews(defs: GcsPagesFieldDef[], rows: { fields: unknown }[], onlyListed: boolean): Promise<GcsPagesFieldView[][]> {
    const { db } = this.deps;
    const shown = onlyListed ? defs.filter((d) => d.listed) : defs;
    const values = rows.map((r) => fieldValuesOf(shown, r.fields));
    const fileIds = new Set<string>();
    const serverIds = new Set<number>();
    const memberIds = new Set<string>();
    for (const v of values)
      for (const d of shown) {
        const x = v[d.key];
        if ((d.type === "file" || d.type === "image") && typeof x === "string") fileIds.add(x);
        if (d.type === "server" && typeof x === "number") serverIds.add(x);
        if (d.type === "member" && typeof x === "string") memberIds.add(x);
      }
    const [files, servers, members] = await Promise.all([
      fileIds.size ? db.attachment.findMany({ where: { id: { in: [...fileIds] } }, select: { id: true, filename: true, size: true } }) : [],
      serverIds.size ? db.gameServer.findMany({ where: { id: { in: [...serverIds] } }, select: { id: true, name: true, slug: true } }) : [],
      memberIds.size ? db.user.findMany({ where: { id: { in: [...memberIds] } }, select: { id: true, name: true } }) : [],
    ]);
    const memberMap = new Map(members.map((u) => [u.id, u]));
    const fileMap = new Map(files.map((f) => [f.id, f]));
    const serverMap = new Map(servers.map((s) => [s.id, s]));
    return values.map((v) =>
      shown.flatMap((d): GcsPagesFieldView[] => {
        const x = v[d.key];
        if (x === undefined || (d.type === "checkbox" && x !== true && !onlyListed)) return d.type === "checkbox" && x === false ? [{ key: d.key, label: d.label, type: d.type, value: false, display: "", url: null, size: null, badge: d.badge, position: d.position }] : [];
        const base = { key: d.key, label: d.label, type: d.type, value: x, url: null as string | null, size: null as number | null, badge: d.badge, position: d.position };
        switch (d.type) {
          case "file":
          case "image": {
            const f = typeof x === "string" ? fileMap.get(x) : undefined;
            return f ? [{ ...base, display: f.filename, url: `/files/${f.id}`, size: f.size }] : [];
          }
          case "server": {
            const s = typeof x === "number" ? serverMap.get(x) : undefined;
            return s ? [{ ...base, display: s.name, url: `/servers/${s.id}-${s.slug}` }] : [];
          }
          case "member": {
            const u = typeof x === "string" ? memberMap.get(x) : undefined;
            return u ? [{ ...base, display: u.name, url: `/members/${u.id}-${slugify(u.name)}` }] : [];
          }
          case "youtube":
            return [{ ...base, display: String(x), url: `https://www.youtube-nocookie.com/embed/${String(x)}` }];
          case "url":
            return [{ ...base, display: String(x).replace(/^https?:\/\//, ""), url: String(x) }];
          case "multiselect":
            return [{ ...base, display: Array.isArray(x) ? x.join(", ") : String(x) }];
          default:
            return [{ ...base, display: Array.isArray(x) ? x.join(", ") : String(x) }];
        }
      }),
    );
  }

  /** Cardurile înregistrărilor (cu autorii, categoriile, notele și câmpurile de pe card). */
  private async cards(d: GcsPagesDb, rows: RecordRow[]): Promise<GcsPagesRecordCard[]> {
    const { db, settings } = this.deps;
    const authorIds = [...new Set(rows.map((r) => r.authorId).filter((id): id is string => id !== null))];
    const catIds = [...new Set(rows.map((r) => r.categoryId).filter((id): id is number => id !== null))];
    const [authors, cats, fields, newDays] = await Promise.all([
      authorIds.length ? db.user.findMany({ where: { id: { in: authorIds } }, select: userRefSelect }) : [],
      catIds.length ? db.pagesCategory.findMany({ where: { id: { in: catIds } } }) : [],
      this.fieldViews(d.fields, rows, true),
      settings.get<number>("pages.new_days"),
    ]);
    const authorMap = new Map(authors.map((u) => [u.id, toRef(u)]));
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const since = Date.now() - newDays * 86_400_000;
    const path = d.path ?? "";
    return rows.map((r, i) => {
      const c = r.categoryId ? catMap.get(r.categoryId) : undefined;
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        href: recordHref(path, r),
        excerpt: plainText(r.contentHtml, EXCERPT),
        image: r.imageId ? `/files/${r.imageId}` : null,
        author: r.authorId ? (authorMap.get(r.authorId) ?? null) : null,
        category: c
          ? { id: c.id, parentId: c.parentId, name: c.name, slug: c.slug, href: categoryHref(path, c.slug), description: c.description, icon: c.icon, color: c.color, image: c.imageId ? `/files/${c.imageId}` : null, private: c.private, recordsCount: c.recordsCount }
          : null,
        status: r.status,
        featured: r.featured,
        pinned: r.pinned,
        isNew: newDays > 0 && r.publishedAt !== null && r.publishedAt.getTime() > since,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
        views: r.views,
        comments: r.commentsCount,
        rating: { avg: r.ratingAvg, count: r.ratingCount },
        fields: fields[i] ?? [],
      };
    });
  }

  /** Condiția căutării: fiecare cuvânt (fără diacritice) în textul căutabil. */
  private static words(q: string): Prisma.PagesRecordWhereInput[] {
    return searchNormalize(q)
      .split(" ")
      .filter((w) => w.length >= 2)
      .slice(0, 8)
      .map((w) => ({ searchText: { contains: w } }));
  }

  /**
   * Lista înregistrărilor unei baze de date: fixatele întâi, apoi ordinea aleasă; categoria, căutarea, filtrele pe
   * câmpuri (aplicate peste cel mult 5000 de înregistrări). Staff-ul poate vedea și cozile (în așteptare, ascunse);
   * membrul, propriile trimiteri (`mine`).
   */
  async list(actor: GcsActor, d: GcsPagesDb, query: GcsPagesListQuery = {}): Promise<{ records: GcsPagesRecordCard[]; pagination: GcsPagination; sort: string }> {
    const { db, access, settings } = this.deps;
    const staff = await access.isStaff(actor);
    const statusWhere: Prisma.PagesRecordWhereInput =
      query.status === "pending" && staff
        ? { status: "PENDING" }
        : query.status === "hidden" && staff
          ? { status: "HIDDEN" }
          : query.status === "mine" && actor.userId
            ? { authorId: actor.userId }
            : { status: "PUBLISHED" };
    // Categoria aleasă cuprinde și subcategoriile ei.
    let categoryIds: number[] | null = null;
    if (query.categoryId) {
      const all = await db.pagesCategory.findMany({ where: { databaseId: d.id }, select: { id: true, parentId: true } });
      categoryIds = [query.categoryId];
      for (let i = 0; i < categoryIds.length && i < 200; i++) for (const c of all) if (c.parentId === categoryIds[i] && !categoryIds.includes(c.id)) categoryIds.push(c.id);
    }
    const where: Prisma.PagesRecordWhereInput = {
      databaseId: d.id,
      ...statusWhere,
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      AND: [await this.categoryWhere(actor, [d.id]), ...(query.q ? GcsPagesQueries.words(query.q) : [])],
      ...(query.featured ? { featured: true } : {}),
    };
    const sort = query.sort && SORTS[query.sort] ? query.sort : SORTS[d.sort] ? d.sort : "newest";
    const orderBy: Prisma.PagesRecordOrderByWithRelationInput[] = [{ pinned: "desc" }, ...SORTS[sort]!];
    const perPage = query.limit ?? (d.perPage || (await settings.get<number>("pages.records_per_page")));
    const filters = Object.entries(query.filters ?? {}).filter(([k, v]) => v !== "" && d.fields.some((f) => f.key === k && f.filter));

    let total: number;
    let rows: RecordRow[];
    let page = Math.max(1, query.page ?? 1);
    if (filters.length > 0) {
      const all = await db.pagesRecord.findMany({ where, orderBy, take: FILTER_SCAN, select: { id: true, fields: true } });
      const defs = new Map(d.fields.map((f) => [f.key, f]));
      const ok = all.filter((r) => {
        const values = fieldValuesOf(d.fields, r.fields);
        return filters.every(([k, want]) => {
          const v = values[k];
          const def = defs.get(k)!;
          if (def.type === "checkbox") return (v === true) === (want === "1");
          return Array.isArray(v) ? v.includes(want) : String(v ?? "") === want;
        });
      });
      total = ok.length;
      page = Math.min(page, Math.max(1, Math.ceil(total / perPage)));
      const ids = ok.slice((page - 1) * perPage, page * perPage).map((r) => r.id);
      const byId = new Map((await db.pagesRecord.findMany({ where: { id: { in: ids } }, select: recordSelect })).map((r) => [r.id, r]));
      rows = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    } else {
      total = await db.pagesRecord.count({ where });
      page = Math.min(page, Math.max(1, Math.ceil(total / perPage)));
      rows = await db.pagesRecord.findMany({ where, orderBy, skip: (page - 1) * perPage, take: perPage, select: recordSelect });
    }
    return { records: await this.cards(d, rows), pagination: { page, pages: Math.max(1, Math.ceil(total / perPage)), perPage, total }, sort };
  }

  /** Cele mai noi / recomandate / bine notate înregistrări ale unei baze (blocul din constructor, widget-ul). */
  async latest(actor: GcsActor, databaseId: number, opts: { limit: number; sort: string; categoryId?: number | null }): Promise<{ db: GcsPagesDb; records: GcsPagesRecordCard[] } | null> {
    const d = await this.databaseFor(actor, databaseId);
    if (!d || d.path === null) return null;
    const { records } = await this.list(actor, d, { sort: opts.sort, categoryId: opts.categoryId ?? null, limit: Math.min(Math.max(opts.limit, 1), 50) });
    return { db: d, records };
  }

  /**
   * O înregistrare din baza dată, după referința din adresă (`<id>-<slug>`): publicată (sau a autorului / staff-ului),
   * cu toate câmpurile, autorul, categoria, nota și ce poate face viewer-ul.
   */
  async record(actor: GcsActor, d: GcsPagesDb, ref: string) {
    const { db, access, ratings } = this.deps;
    const parsed = parseRef(ref);
    if (!parsed) return null;
    const row = await db.pagesRecord.findFirst({ where: { id: parsed.id, databaseId: d.id }, select: { ...recordSelect, contentJson: true, rejectReason: true, topicId: true, editedById: true, editedAt: true } });
    if (!row) return null;
    const staff = await access.isStaff(actor);
    const own = actor.userId !== null && row.authorId === actor.userId;
    if (row.status !== "PUBLISHED" && !staff && !(own && row.status !== "HIDDEN")) return null;
    if (!(await this.categoryAllowsRow(actor, row))) return null;
    const [[card], [fields], rating, canComment, canRate, wiki, editor, revisions] = await Promise.all([
      this.cards(d, [row]),
      this.fieldViews(d.fields, [row], false),
      d.ratings ? ratings.view(actor, PAGES_RECORD_TYPE, String(row.id)) : Promise.resolve(null as GcsRatingView | null),
      access.canComment(actor, d),
      access.canRate(actor, d),
      d.wiki && row.status === "PUBLISHED" ? access.canSubmit(actor, d) : Promise.resolve(false),
      row.editedById ? db.user.findUnique({ where: { id: row.editedById }, select: userRefSelect }) : Promise.resolve(null),
      staff && d.revisions ? db.pagesRecordRevision.count({ where: { recordId: row.id } }) : Promise.resolve(0),
    ]);
    return {
      record: {
        ...card!,
        contentHtml: row.contentHtml,
        contentJson: row.contentJson,
        rejectReason: row.rejectReason,
        createdAt: row.createdAt.toISOString(),
        authorId: row.authorId,
        topicId: row.topicId,
        editedAt: row.editedAt?.toISOString() ?? null,
        editedBy: editor ? toRef(editor) : null,
      },
      fields: fields ?? [],
      rating,
      revisions,
      canonicalSlug: row.slug,
      can: {
        edit: staff || wiki || (own && d.authorEdit && row.status !== "HIDDEN"),
        moderate: staff,
        delete: staff || (own && (row.status === "PENDING" || row.status === "REJECTED")),
        comment: canComment && row.status === "PUBLISHED",
        rate: canRate && !own && row.status === "PUBLISHED",
      },
    };
  }

  /** Comentariile unei înregistrări, paginate (staff-ul vede și pe cele ascunse). */
  async comments(actor: GcsActor, recordId: number, page = 1) {
    const { db, access } = this.deps;
    const opts = await readPagesOptions(this.deps.settings);
    const staff = await access.isStaff(actor);
    // Staff-ul vede tot; ceilalți, comentariile vizibile și propriile comentarii în așteptare.
    const where: Prisma.PagesCommentWhereInput = { recordId, ...(staff ? {} : { hidden: false, OR: [{ pending: false }, ...(actor.userId ? [{ authorId: actor.userId }] : [])] }) };
    const total = await db.pagesComment.count({ where });
    const pages = Math.max(1, Math.ceil(total / opts.commentsPerPage));
    const p = Math.min(Math.max(1, page), pages);
    const rows = await db.pagesComment.findMany({ where, orderBy: [{ createdAt: opts.commentOrder === "newest" ? "desc" : "asc" }, { id: "asc" }], skip: (p - 1) * opts.commentsPerPage, take: opts.commentsPerPage });
    const authorIds = [...new Set(rows.map((r) => r.authorId).filter((id): id is string => id !== null))];
    const authors = new Map((authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: userRefSelect }) : []).map((u) => [u.id, toRef(u)]));
    return {
      comments: rows.map((c) => ({
        id: c.id,
        author: c.authorId ? (authors.get(c.authorId) ?? null) : null,
        html: c.contentHtml,
        json: c.contentJson,
        hidden: c.hidden,
        pending: c.pending,
        createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt?.toISOString() ?? null,
        canEdit: staff || (actor.userId !== null && c.authorId === actor.userId),
      })),
      pagination: { page: p, pages, perPage: opts.commentsPerPage, total },
      staff,
    };
  }

  /** Categoria înregistrării o lasă pe actor să o vadă (grupurile categoriei; categoria privată = doar autorul). */
  private async categoryAllowsRow(actor: GcsActor, row: { categoryId: number | null; authorId: string | null }): Promise<boolean> {
    if (row.categoryId === null || (await this.deps.access.isStaff(actor))) return true;
    const c = await this.deps.db.pagesCategory.findUnique({ where: { id: row.categoryId }, select: { viewGroupIds: true, private: true } });
    if (!c) return true;
    return groupsAllow(actor, c.viewGroupIds) && (!c.private || (actor.userId !== null && row.authorId === actor.userId));
  }

  /** Actorul vede înregistrarea (atașamentele, notificările, notele): publicată într-o bază vizibilă, sau a lui / staff. */
  async canViewRecord(actor: GcsActor, recordId: number): Promise<boolean> {
    const { db, access } = this.deps;
    const r = Number.isSafeInteger(recordId) ? await db.pagesRecord.findUnique({ where: { id: recordId }, select: { databaseId: true, status: true, authorId: true, categoryId: true } }) : null;
    if (!r) return false;
    const d = await access.database(r.databaseId);
    if (!d || !(await access.canViewDatabase(actor, d)) || !(await this.categoryAllowsRow(actor, r))) return false;
    if (r.status === "PUBLISHED") return true;
    return (actor.userId !== null && r.authorId === actor.userId) || (await access.isStaff(actor));
  }

  /** Adresa unei înregistrări (notificările), sau `null` dacă baza ei nu are pagină. */
  async recordLink(recordId: number): Promise<{ title: string; href: string; databaseId: number } | null> {
    const r = await this.deps.db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, slug: true, title: true, databaseId: true } });
    if (!r) return null;
    const d = await this.deps.access.database(r.databaseId);
    return d?.path ? { title: r.title, href: recordHref(d.path, r), databaseId: r.databaseId } : null;
  }

  /** Ce înseamnă restul căii de sub o pagină de bază de date. */
  static route(rest: string[]): { kind: "list" } | { kind: "category"; slug: string } | { kind: "submit" } | { kind: "record"; ref: string; edit: boolean } | null {
    if (rest.length === 0) return { kind: "list" };
    if (rest[0] === "c" && rest.length === 2) return { kind: "category", slug: rest[1]! };
    if (rest[0] === "submit" && rest.length === 1) return { kind: "submit" };
    if (rest.length <= 2 && !RESERVED_SEGMENTS.has(rest[0]!) && parseRef(rest[0]!) && (rest.length === 1 || rest[1] === "edit")) return { kind: "record", ref: rest[0]!, edit: rest.length === 2 };
    return null;
  }

  // ─── Sursa de conținut: căutarea și fluxul ─────────────────────────────────────────────────────────────────

  /** Căutarea site-ului, tabul „Baze de date”: înregistrările publicate din bazele vizibile și căutabile. */
  async search(actor: GcsActor, input: GcsContentSearchInput): Promise<{ hits: GcsContentHit[]; total: number }> {
    const { db, access } = this.deps;
    const dbs = (await access.visibleDatabases(actor)).filter((d) => d.searchable);
    const words = GcsPagesQueries.words(input.q);
    if (dbs.length === 0 || words.length === 0) return { hits: [], total: 0 };
    const where: Prisma.PagesRecordWhereInput = { databaseId: { in: dbs.map((d) => d.id) }, status: "PUBLISHED", AND: [...words, await this.categoryWhere(actor, dbs.map((d) => d.id), true)] };
    const [total, rows] = await Promise.all([
      db.pagesRecord.count({ where }),
      db.pagesRecord.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.perPage, take: input.perPage, select: recordSelect }),
    ]);
    const byDb = new Map(dbs.map((d) => [d.id, d]));
    const authors = await this.authors(rows.map((r) => r.authorId));
    return {
      total,
      hits: rows.map((r) => {
        const d = byDb.get(r.databaseId)!;
        return {
          key: `pr-${r.id}`,
          title: r.title,
          href: recordHref(d.path!, r),
          snippet: plainText(r.contentHtml, EXCERPT),
          author: r.authorId ? (authors.get(r.authorId) ?? null) : null,
          at: (r.publishedAt ?? r.createdAt).toISOString(),
          context: { label: d.name, href: pageHref(d.path!) },
          image: r.imageId ? `/files/${r.imageId}` : null,
        };
      }),
    };
  }

  /** Fluxul de activitate: înregistrările publicate recent în bazele vizibile, cu fluxul pornit. */
  async stream(viewer: GcsActor, query: { until: Date | null; limit: number }): Promise<GcsContentStreamEntry[]> {
    const { db, access } = this.deps;
    const dbs = (await access.visibleDatabases(viewer)).filter((d) => d.inStream);
    if (dbs.length === 0) return [];
    const rows = await db.pagesRecord.findMany({
      where: { databaseId: { in: dbs.map((d) => d.id) }, status: "PUBLISHED", publishedAt: query.until ? { lte: query.until } : { not: null }, ...(await this.categoryWhere(viewer, dbs.map((d) => d.id), true)) },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: query.limit,
      select: recordSelect,
    });
    const byDb = new Map(dbs.map((d) => [d.id, d]));
    const authors = await this.authors(rows.map((r) => r.authorId));
    return rows.map((r) => {
      const d = byDb.get(r.databaseId)!;
      return {
        id: r.id,
        at: r.publishedAt!,
        user: r.authorId ? (authors.get(r.authorId) ?? null) : null,
        title: r.title,
        href: recordHref(d.path!, r),
        snippet: plainText(r.contentHtml, 180),
        context: { label: d.name, href: pageHref(d.path!) },
      };
    });
  }

  private async authors(ids: (string | null)[]): Promise<Map<string, GcsUserRef>> {
    const list = [...new Set(ids.filter((id): id is string => id !== null))];
    if (list.length === 0) return new Map();
    return new Map((await this.deps.db.user.findMany({ where: { id: { in: list } }, select: userRefSelect })).map((u) => [u.id, toRef(u)]));
  }

  /** Blocurile reutilizabile, după id (randarea paginilor și a widget-ului „Bloc”). */
  async blocks(ids: number[]): Promise<Map<number, { id: number; key: string; name: string; kind: string; html: string }>> {
    const list = [...new Set(ids)].filter((i) => Number.isSafeInteger(i));
    if (list.length === 0) return new Map();
    const rows = await this.deps.db.pagesBlock.findMany({ where: { id: { in: list } }, select: { id: true, key: true, name: true, kind: true, html: true } });
    return new Map(rows.map((b) => [b.id, b]));
  }

  async blockByKey(key: string) {
    return this.deps.db.pagesBlock.findUnique({ where: { key }, select: { id: true, key: true, name: true, kind: true, html: true } });
  }

  /** Reviziile unei înregistrări (staff-ul), cele mai noi primele. */
  async revisions(actor: GcsActor, recordId: number) {
    const { db, access } = this.deps;
    if (!(await access.isStaff(actor))) return [];
    const rows = await db.pagesRecordRevision.findMany({ where: { recordId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    const authors = await this.authors(rows.map((r) => r.actorId));
    return rows.map((r) => ({ id: r.id, title: r.title, html: r.contentHtml, at: r.createdAt.toISOString(), actor: r.actorId ? (authors.get(r.actorId) ?? null) : null }));
  }

  /** Fluxul RSS al unei baze de date: doar dacă e pornit și baza e vizibilă vizitatorilor; ultimele 30 de înregistrări. */
  async rss(guest: GcsActor, databaseKey: string): Promise<{ db: GcsPagesDb; items: { title: string; href: string; description: string; at: Date; author: string | null }[] } | null> {
    const { db, access } = this.deps;
    const d = (await access.visibleDatabases(guest)).find((x) => x.key === databaseKey);
    if (!d || !d.rss) return null;
    const rows = await db.pagesRecord.findMany({
      where: { databaseId: d.id, status: "PUBLISHED", ...(await this.categoryWhere(guest, [d.id], true)) },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 30,
      select: recordSelect,
    });
    const authors = await this.authors(rows.map((r) => r.authorId));
    return { db: d, items: rows.map((r) => ({ title: r.title, href: recordHref(d.path!, r), description: plainText(r.contentHtml, 500), at: r.publishedAt ?? r.createdAt, author: r.authorId ? (authors.get(r.authorId)?.name ?? null) : null })) };
  }

  /** Harta site-ului: paginile publice (fără `noindex`) și înregistrările bazelor publice. */
  async sitemap(guest: GcsActor): Promise<{ path: string; lastModified?: Date }[]> {
    const { db, access } = this.deps;
    if (!(await access.canUseApp(guest))) return [];
    const tree = await access.tree();
    const noindex = new Set((await db.pagesNode.findMany({ where: { noindex: true }, select: { id: true } })).map((n) => n.id));
    const out: { path: string; lastModified?: Date }[] = [{ path: "/pages" }];
    for (const n of tree) if (n.kind === "page" && !noindex.has(n.id) && (await access.canViewNode(guest, n, { tree, editor: false, app: true }))) out.push({ path: pageHref(n.path), lastModified: new Date(n.updatedAt) });
    const dbs = await access.visibleDatabases(guest);
    for (const d of dbs) {
      if (d.nodeId !== null && noindex.has(d.nodeId)) continue;
      const rows = await db.pagesRecord.findMany({ where: { databaseId: d.id, status: "PUBLISHED" }, orderBy: { id: "desc" }, take: 5000, select: { id: true, slug: true, updatedAt: true } });
      for (const r of rows) out.push({ path: recordHref(d.path!, r), lastModified: r.updatedAt });
    }
    return out;
  }
}
