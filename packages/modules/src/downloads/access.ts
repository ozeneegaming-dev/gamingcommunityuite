import type { GcsActor, GcsAppService, GcsCache, GcsMemberGrant, GcsMemberGrantsContext, GcsPermissionService } from "@gcs/core";
import { jsonInts, type PrismaClient } from "@gcs/db";
import { activeClanRoles } from "../clans/queries";
import { categoryOptions, type GcsCategoryOptions } from "./options";
import { DOWNLOADS_CACHE_TAG, DOWNLOADS_CONTAINER } from "./text";

/** Acțiunile pe o categorie (matricea pe container, spec §6.2): vede categoria, vede fișierele, încarcă, descarcă… */
export const DOWNLOAD_CATEGORY_ACTIONS = ["downloads.see", "downloads.view", "downloads.upload", "downloads.download", "downloads.comment", "downloads.review"] as const;
export type GcsDownloadAction = (typeof DOWNLOAD_CATEGORY_ACTIONS)[number];

/** O categorie, așa cum stă în cache (toate, cu opțiunile normalizate). */
export type GcsCategoryRow = {
  id: number;
  parentId: number | null;
  position: number;
  name: string;
  slug: string;
  descriptionHtml: string;
  icon: string;
  iconId: string | null;
  coverId: string | null;
  enabled: boolean;
  vipOnly: boolean;
  clanId: number | null;
  options: GcsCategoryOptions;
  fieldIds: number[];
  filesCount: number;
  lastFileAt: string | null;
};

/** Drepturile actorului într-o categorie, cu cele de grup ale aplicației. */
export type GcsCategoryRights = Record<"see" | "view" | "upload" | "download" | "comment" | "review", boolean> & {
  /** Acces la fișierele / categoriile VIP (`downloads.vip_files`). */
  vip: boolean;
  /** Staff-ul Descărcărilor pe site (aprobă, editează, ascunde, mută, șterge). */
  moderate: boolean;
  /** Trimiterile lui nu trec prin coada de aprobare. */
  skipApproval: boolean;
};

const CATEGORIES_KEY = "downloads:categories:v1";

const container = (id: number) => ({ type: DOWNLOADS_CONTAINER, id: String(id) });

/**
 * Drepturile în Descărcări: aplicația (pornită, accesul grupului), matricea pe categorii (cu moștenirea părintelui și
 * drepturile date membrilor unui clan pe categoria clanului), VIP-ul și staff-ul. Categoriile stau în cache (tag-ul
 * `downloads`), cu opțiunile lor deja normalizate.
 */
export class GcsDownloadAccess {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; permissions: GcsPermissionService; apps: GcsAppService }) {}

  appEnabled(): Promise<boolean> {
    return this.deps.apps.enabled("downloads");
  }

  /** Aplicația e pornită și grupul actorului are acces la ea. */
  canUseApp(actor: GcsActor): Promise<boolean> {
    return this.deps.apps.canAccess(actor, "downloads");
  }

  async categories(): Promise<GcsCategoryRow[]> {
    const cached = await this.deps.cache.get<GcsCategoryRow[]>(CATEGORIES_KEY);
    if (cached) return cached;
    const rows = await this.deps.db.downloadCategory.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const list: GcsCategoryRow[] = rows.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      position: c.position,
      name: c.name,
      slug: c.slug,
      descriptionHtml: c.descriptionHtml,
      icon: c.icon,
      iconId: c.iconId,
      coverId: c.coverId,
      enabled: c.enabled,
      vipOnly: c.vipOnly,
      clanId: c.clanId,
      options: categoryOptions(c.options),
      fieldIds: jsonInts(c.fieldIds),
      filesCount: c.filesCount,
      lastFileAt: c.lastFileAt?.toISOString() ?? null,
    }));
    await this.deps.cache.set(CATEGORIES_KEY, list, { ttlSec: 3600, tags: [DOWNLOADS_CACHE_TAG] });
    return list;
  }

  async category(id: number): Promise<GcsCategoryRow | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    return (await this.categories()).find((c) => c.id === id) ?? null;
  }

  /** Categoria e VIP, ea sau un părinte al ei. */
  async vipCategory(id: number): Promise<boolean> {
    const all = await this.categories();
    let current = all.find((c) => c.id === id);
    for (let depth = 0; current && depth < 32; depth++) {
      if (current.vipOnly) return true;
      current = current.parentId === null ? undefined : all.find((c) => c.id === current!.parentId);
    }
    return false;
  }

  async isModerator(actor: GcsActor): Promise<boolean> {
    return actor.userId !== null && (await this.deps.permissions.can(actor, "downloads.moderate"));
  }

  async rights(actor: GcsActor, categoryId: number): Promise<GcsCategoryRights> {
    const { permissions } = this.deps;
    const ref = container(categoryId);
    const [see, view, upload, download, comment, review, vip, moderate, skipApproval] = await Promise.all([
      ...DOWNLOAD_CATEGORY_ACTIONS.map((a) => permissions.can(actor, a, ref)),
      permissions.can(actor, "downloads.vip_files"),
      this.isModerator(actor),
      permissions.can(actor, "downloads.skip_approval"),
    ]);
    const cat = await this.category(categoryId);
    const open = Boolean(cat && (cat.enabled || moderate));
    const member = actor.userId !== null;
    return {
      see: open && (see || moderate),
      view: open && (view || moderate),
      upload: open && member && (upload || moderate),
      download: open && member && (download || moderate),
      comment: open && member && (comment || moderate),
      review: open && member && review,
      vip: member && (vip || moderate),
      moderate,
      skipApproval: member && (skipApproval || moderate),
    };
  }

  /** Id-urile categoriilor pe care actorul are acțiunea (o singură citire a permisiunilor). */
  async allowed(actor: GcsActor, action: GcsDownloadAction): Promise<Set<number>> {
    const all = await this.categories();
    const moderate = await this.isModerator(actor);
    if (moderate) return new Set(all.map((c) => c.id));
    const ids = await this.deps.permissions.filterContainers(actor, action, all.filter((c) => c.enabled).map((c) => container(c.id)));
    return new Set([...ids].map(Number));
  }
}

/**
 * Categoria unui clan (ideea Clanuri v2): membrii clanului activ primesc toate acțiunile pe ea, peste matricea
 * grupurilor. Apartenența vine din interfața publică a Clanurilor (`activeClanRoles`); nimic cu Descărcările sau
 * Clanurile oprite. Clanurile își invalidează singure drepturile membrilor la orice schimbare de apartenență.
 */
export async function downloadMemberGrants({ db }: GcsMemberGrantsContext, userId: string): Promise<GcsMemberGrant[]> {
  const apps = await db.app.findMany({ where: { key: { in: ["downloads", "clans"] } }, select: { key: true, enabled: true } });
  if (apps.some((a) => !a.enabled)) return [];
  const clans = await activeClanRoles(db, userId);
  if (clans.length === 0) return [];
  const categories = await db.downloadCategory.findMany({ where: { clanId: { in: clans.map((c) => c.clanId) } }, select: { id: true } });
  return categories.map((c) => ({ type: DOWNLOADS_CONTAINER, id: String(c.id), actions: [...DOWNLOAD_CATEGORY_ACTIONS], powers: [] }));
}
