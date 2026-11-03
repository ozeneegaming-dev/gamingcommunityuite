import { GcsConflict, GcsNotFound, GcsValidationError, normalizeTag, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsEventBus, type GcsSettingDef, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";

/** Secțiunea ACP (ACP › Sistem › Descoperire › Etichete). */
export const TAGS_ACP_SECTION = "system.tags";
export const TAGS_SETTING = "tags.config";
export const TAGS_PER_PAGE = 40;

export type GcsTagsConfig = {
  /** Etichetele pe tot site-ul (fiecare forum le mai poate opri în opțiunile lui). */
  enabled: boolean;
  /** `open` = membrii creează etichete noi; `closed` = doar cele create din ACP. */
  mode: "open" | "closed";
};
export const DEFAULT_TAGS: GcsTagsConfig = { enabled: true, mode: "open" };
export function tagsConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsTagsConfig>;
  return typeof c.enabled === "boolean" && (c.mode === "open" || c.mode === "closed") ? null : "invalid";
}
export const tagsSetting: GcsSettingDef = { key: TAGS_SETTING, type: "json", default: DEFAULT_TAGS, section: "tags", labelKey: "settings.tags.config", validate: tagsConfigError };

export async function loadTagsConfig(settings: Pick<GcsSettingsService, "get">): Promise<GcsTagsConfig> {
  const v = await settings.get<GcsTagsConfig | null>(TAGS_SETTING).catch(() => null);
  return v && tagsConfigError(v) === null ? v : DEFAULT_TAGS;
}

export type GcsTagRow = { id: number; name: string; slug: string; topics: number };

/**
 * Etichetele din ACP: lista cu numărul de topicuri (căutare, ordonare), crearea (pentru lista închisă), redenumirea,
 * unirea a două etichete (topicurile trec pe ținta unirii) și ștergerea. Fiecare schimbare golește cache-ul topicurilor
 * și al paginilor de etichete și intră în jurnal.
 */
export class GcsTagsAdmin {
  constructor(private readonly deps: { db: PrismaClient; acp: Pick<GcsAcpRoleService, "assert">; settings: Pick<GcsSettingsService, "get" | "set">; bus: Pick<GcsEventBus, "emit"> }) {}

  config(): Promise<GcsTagsConfig> {
    return loadTagsConfig(this.deps.settings);
  }

  async saveConfig(actor: GcsActor, value: GcsTagsConfig): Promise<void> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "edit");
    await this.deps.settings.set(TAGS_SETTING, value, actor);
  }

  async list(actor: GcsActor, opts: { q?: string; sort?: "used" | "name"; page: number }): Promise<{ items: GcsTagRow[]; total: number; page: number; pages: number; unused: number }> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "view");
    const { db } = this.deps;
    const q = opts.q ? normalizeTag(opts.q) ?? opts.q.trim().toLowerCase() : "";
    const where: Prisma.TagWhereInput = q ? { OR: [{ slug: { contains: q } }, { name: { contains: opts.q!.trim() } }] } : {};
    const [total, unused] = await Promise.all([db.tag.count({ where }), db.tag.count({ where: { topics: { none: {} } } })]);
    const pages = Math.max(1, Math.ceil(total / TAGS_PER_PAGE));
    const page = Math.min(Math.max(1, opts.page), pages);
    const rows = await db.tag.findMany({
      where,
      orderBy: opts.sort === "name" ? [{ slug: "asc" }] : [{ topics: { _count: "desc" } }, { slug: "asc" }],
      skip: (page - 1) * TAGS_PER_PAGE,
      take: TAGS_PER_PAGE,
      select: { id: true, name: true, slug: true, _count: { select: { topics: true } } },
    });
    return { items: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, topics: r._count.topics })), total, page, pages, unused };
  }

  private async changed(actor: GcsActor, action: string, targetId: string, after?: unknown): Promise<void> {
    await writeAudit(this.deps.db, { actorId: actor.userId, action, targetType: "tag", targetId, ...(after !== undefined ? { after } : {}), ip: actor.ip });
    await this.deps.bus.emit({ name: "tags.updated", payload: { tagId: targetId }, tags: ["tags", "forums-tree"] }).catch(() => {});
  }

  /** O etichetă nouă (numele afișat; adresa se face din el). */
  async create(actor: GcsActor, name: string): Promise<{ id: number }> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "edit");
    const slug = normalizeTag(name);
    if (!slug) throw new GcsValidationError({ name: "invalid" });
    if (await this.deps.db.tag.findUnique({ where: { slug } })) throw new GcsConflict({ reason: "tag_exists" });
    const row = await this.deps.db.tag.create({ data: { name: name.trim().slice(0, 40) || slug, slug }, select: { id: true } });
    await this.changed(actor, "tags.create", String(row.id), { slug });
    return row;
  }

  /** Redenumirea: numele afișat și adresa (unică). */
  async rename(actor: GcsActor, id: number, name: string): Promise<void> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "edit");
    const slug = normalizeTag(name);
    if (!slug) throw new GcsValidationError({ name: "invalid" });
    const { db } = this.deps;
    const other = await db.tag.findUnique({ where: { slug } });
    if (other && other.id !== id) throw new GcsConflict({ reason: "tag_exists" });
    const { count } = await db.tag.updateMany({ where: { id }, data: { name: name.trim().slice(0, 40) || slug, slug } });
    if (count === 0) throw new GcsNotFound({ entity: "tag" });
    await this.changed(actor, "tags.rename", String(id), { slug });
  }

  /** Unește eticheta `id` în `intoId`: topicurile ei primesc ținta (fără dubluri), apoi `id` dispare. */
  async merge(actor: GcsActor, id: number, intoId: number): Promise<number> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "edit");
    if (id === intoId) throw new GcsValidationError({ intoId: "invalid_choice" });
    const { db } = this.deps;
    const [from, into] = await Promise.all([db.tag.findUnique({ where: { id } }), db.tag.findUnique({ where: { id: intoId } })]);
    if (!from || !into) throw new GcsNotFound({ entity: "tag" });
    const moved = await db.$transaction(async (tx) => {
      const links = await tx.topicTag.findMany({ where: { tagId: id }, select: { topicId: true } });
      if (links.length > 0) await tx.topicTag.createMany({ data: links.map((l) => ({ topicId: l.topicId, tagId: intoId })), skipDuplicates: true });
      await tx.tag.delete({ where: { id } });
      return links.length;
    });
    await this.changed(actor, "tags.merge", String(id), { into: into.slug, topics: moved });
    return moved;
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "delete");
    const { count } = await this.deps.db.tag.deleteMany({ where: { id } });
    if (count === 0) throw new GcsNotFound({ entity: "tag" });
    await this.changed(actor, "tags.delete", String(id));
  }

  /** Șterge toate etichetele nefolosite de niciun topic. */
  async pruneUnused(actor: GcsActor): Promise<number> {
    await this.deps.acp.assert(actor, TAGS_ACP_SECTION, "delete");
    const { count } = await this.deps.db.tag.deleteMany({ where: { topics: { none: {} } } });
    if (count > 0) await this.changed(actor, "tags.prune", "*", { count });
    return count;
  }
}
