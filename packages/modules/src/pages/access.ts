import type { GcsAcpRoleService, GcsActor, GcsCache, GcsPermissionService } from "@gcs/core";
import { jsonInts, type PrismaClient } from "@gcs/db";
import { fieldDefsOf, type GcsPagesFieldDef } from "./fields";
import { PAGES_ACP, PAGES_CACHE_TAG, groupsAllow } from "./shared";

const TREE_KEY = "pages:tree";
const DB_KEY = "pages:databases";
const TTL = 300;

/** Un nod din arborele ținut în cache (fără layout). */
export type GcsPagesTreeNode = {
  id: number;
  parentId: number | null;
  kind: "folder" | "page";
  title: string;
  slug: string;
  path: string;
  position: number;
  icon: string | null;
  contentType: "layout" | "database";
  databaseId: number | null;
  published: boolean;
  viewGroupIds: number[];
  updatedAt: string;
};

/** O bază de date ținută în cache: setările, câmpurile și pagina ei. */
export type GcsPagesDb = {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  recordLabel: string;
  fields: GcsPagesFieldDef[];
  listLayout: "list" | "grid" | "table";
  sort: string;
  perPage: number;
  comments: boolean;
  ratings: boolean;
  submissions: boolean;
  approval: boolean;
  authorEdit: boolean;
  searchable: boolean;
  inStream: boolean;
  viewGroupIds: number[];
  submitGroupIds: number[];
  commentGroupIds: number[];
  rateGroupIds: number[];
  recordsCount: number;
  /** Pagina bazei de date (fără ea, înregistrările nu au adresă și nu apar pe site). */
  nodeId: number | null;
  path: string | null;
};

/**
 * Accesul în aplicația Pagini: cine vede o pagină (`pages.view`, grupurile paginii și ale folderelor de deasupra,
 * publicarea), o bază de date (grupurile ei + pagina ei) și cine trimite, comentează, notează sau moderează. Arborele
 * și bazele de date stau în cache (tag `pages`), invalidate de orice salvare din ACP.
 */
export class GcsPagesAccess {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; permissions: GcsPermissionService; acp: GcsAcpRoleService }) {}

  async tree(): Promise<GcsPagesTreeNode[]> {
    const cached = await this.deps.cache.get<GcsPagesTreeNode[]>(TREE_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.pagesNode.findMany({
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, parentId: true, kind: true, title: true, slug: true, path: true, position: true, icon: true, contentType: true, databaseId: true, published: true, viewGroupIds: true, updatedAt: true },
    });
    const tree = rows.map((n) => ({
      ...n,
      kind: n.kind === "folder" ? ("folder" as const) : ("page" as const),
      contentType: n.contentType === "database" ? ("database" as const) : ("layout" as const),
      viewGroupIds: jsonInts(n.viewGroupIds),
      updatedAt: n.updatedAt.toISOString(),
    }));
    await this.deps.cache.set(TREE_KEY, tree, { ttlSec: TTL, tags: [PAGES_CACHE_TAG] });
    return tree;
  }

  async databases(): Promise<GcsPagesDb[]> {
    const cached = await this.deps.cache.get<GcsPagesDb[]>(DB_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.pagesDatabase.findMany({ include: { node: { select: { id: true, path: true } } } });
    const list: GcsPagesDb[] = rows.map((d) => ({
      id: d.id,
      key: d.key,
      name: d.name,
      description: d.description,
      icon: d.icon,
      recordLabel: d.recordLabel,
      fields: fieldDefsOf(d.fields),
      listLayout: d.listLayout === "grid" || d.listLayout === "table" ? d.listLayout : "list",
      sort: d.sort,
      perPage: d.perPage,
      comments: d.comments,
      ratings: d.ratings,
      submissions: d.submissions,
      approval: d.approval,
      authorEdit: d.authorEdit,
      searchable: d.searchable,
      inStream: d.inStream,
      viewGroupIds: jsonInts(d.viewGroupIds),
      submitGroupIds: jsonInts(d.submitGroupIds),
      commentGroupIds: jsonInts(d.commentGroupIds),
      rateGroupIds: jsonInts(d.rateGroupIds),
      recordsCount: d.recordsCount,
      nodeId: d.node?.id ?? null,
      path: d.node?.path ?? null,
    }));
    await this.deps.cache.set(DB_KEY, list, { ttlSec: TTL, tags: [PAGES_CACHE_TAG] });
    return list;
  }

  async database(id: number): Promise<GcsPagesDb | null> {
    return (await this.databases()).find((d) => d.id === id) ?? null;
  }

  /** Strămoșii unui nod (de la rădăcină), apoi nodul. */
  chain(tree: GcsPagesTreeNode[], node: GcsPagesTreeNode): GcsPagesTreeNode[] {
    const byId = new Map(tree.map((n) => [n.id, n]));
    const out = [node];
    for (let cur = node.parentId === null ? undefined : byId.get(node.parentId); cur && out.length < 10; cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) out.unshift(cur);
    return out;
  }

  /** Editorii paginilor (ACP › Pagini) văd și paginile nepublicate, cu banda „Ciornă”. */
  async isEditor(actor: GcsActor): Promise<boolean> {
    return actor.userId !== null && (await this.deps.acp.can(actor, PAGES_ACP.pages, "view"));
  }

  async isModerator(actor: GcsActor): Promise<boolean> {
    return actor.userId !== null && (await this.deps.permissions.can(actor, "pages.moderate"));
  }

  async canUseApp(actor: GcsActor): Promise<boolean> {
    return this.deps.permissions.can(actor, "pages.view");
  }

  /**
   * Nodul e vizibil actorului: `pages.view`, grupurile lui și ale tuturor folderelor de deasupra, publicat (sau actorul e
   * editor). `editor` se poate da gata calculat (listele).
   */
  async canViewNode(actor: GcsActor, node: GcsPagesTreeNode, ctx: { tree?: GcsPagesTreeNode[]; editor?: boolean; app?: boolean } = {}): Promise<boolean> {
    if (!(ctx.app ?? (await this.canUseApp(actor)))) return false;
    const tree = ctx.tree ?? (await this.tree());
    const editor = ctx.editor ?? (await this.isEditor(actor));
    return this.chain(tree, node).every((n) => (n.published || editor) && groupsAllow(actor, n.viewGroupIds));
  }

  /** Baza de date e vizibilă: grupurile ei și pagina ei (fără pagină, doar editorii o văd). */
  async canViewDatabase(actor: GcsActor, d: GcsPagesDb, ctx: { tree?: GcsPagesTreeNode[]; editor?: boolean; app?: boolean } = {}): Promise<boolean> {
    if (!(ctx.app ?? (await this.canUseApp(actor))) || !groupsAllow(actor, d.viewGroupIds)) return false;
    const tree = ctx.tree ?? (await this.tree());
    const node = d.nodeId === null ? null : tree.find((n) => n.id === d.nodeId);
    if (!node) return ctx.editor ?? (await this.isEditor(actor));
    return this.canViewNode(actor, node, { ...ctx, tree, app: true });
  }

  /** Bazele de date vizibile actorului (căutarea, fluxul, widget-urile). */
  async visibleDatabases(actor: GcsActor): Promise<GcsPagesDb[]> {
    if (!(await this.canUseApp(actor))) return [];
    const [tree, list, editor] = await Promise.all([this.tree(), this.databases(), this.isEditor(actor)]);
    const out: GcsPagesDb[] = [];
    for (const d of list) if (d.path !== null && (await this.canViewDatabase(actor, d, { tree, editor, app: true }))) out.push(d);
    return out;
  }

  /** Poate trimite înregistrări: trimiterile pornite, `pages.submit` și grupurile bazei; staff-ul paginilor oricând. */
  async canSubmit(actor: GcsActor, d: GcsPagesDb): Promise<boolean> {
    if (!actor.userId || actor.isBanned) return false;
    if (await this.isStaff(actor)) return true;
    return d.submissions && groupsAllow(actor, d.submitGroupIds) && (await this.deps.permissions.can(actor, "pages.submit"));
  }

  async canComment(actor: GcsActor, d: GcsPagesDb): Promise<boolean> {
    if (!actor.userId || actor.isBanned || !d.comments) return false;
    return groupsAllow(actor, d.commentGroupIds) && (await this.deps.permissions.can(actor, "pages.comment"));
  }

  async canRate(actor: GcsActor, d: GcsPagesDb): Promise<boolean> {
    if (!actor.userId || actor.isBanned || !d.ratings) return false;
    return groupsAllow(actor, d.rateGroupIds) && (await this.deps.permissions.can(actor, "pages.rate"));
  }

  /** Moderatorii paginilor sau cei cu ACP › Pagini › Înregistrări (editare). */
  async isStaff(actor: GcsActor): Promise<boolean> {
    if (!actor.userId) return false;
    return (await this.isModerator(actor)) || (await this.deps.acp.can(actor, PAGES_ACP.records, "edit"));
  }

  async skipsApproval(actor: GcsActor): Promise<boolean> {
    return (await this.isStaff(actor)) || (await this.deps.permissions.can(actor, "pages.skip_approval"));
  }

  /** Membrii care moderează paginile (anunțați la trimiterile în așteptare): grupurile cu `pages.moderate` + Root Admin. */
  async moderatorIds(limit = 200): Promise<string[]> {
    const { db, permissions } = this.deps;
    const groups = await db.group.findMany({ where: { key: { not: "banned" } }, select: { id: true, key: true } });
    const allowed: number[] = [];
    for (const g of groups) {
      const actor: GcsActor = { userId: "-", groupIds: [g.id], primaryGroupId: g.id, isBanned: false, ip: "" };
      if (g.key === "root_admin" || (await permissions.groupValue<boolean>(actor, "pages.moderate")) === true) allowed.push(g.id);
    }
    if (allowed.length === 0) return [];
    const users = await db.user.findMany({
      where: { OR: [{ primaryGroupId: { in: allowed } }, { groups: { some: { groupId: { in: allowed } } } }] },
      select: { id: true },
      take: limit,
    });
    return users.map((u) => u.id);
  }
}
