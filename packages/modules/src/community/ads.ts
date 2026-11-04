import { GcsNotFound, GcsValidationError, sanitizeContentHtml, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsKv } from "@gcs/core";
import type { AdUnit, PrismaClient } from "@gcs/db";

/** Secțiunea ACP (ACP › Sistem › Promovare › Reclame). */
export const ADS_ACP_SECTION = "system.ads";
/** Afișările și click-urile (`imp:<id>` / `click:<id>`), în stocarea cheilor. */
export const ADS_STATS_KEY = "gcs:ads:stats";
/** Widget-ul care afișează o reclamă în zonele paginilor. */
export const AD_WIDGET = "core.ad";

export type GcsAdKind = "image" | "html";
export type GcsAdInput = { name: string; kind: GcsAdKind; imageUrl: string; linkUrl: string; alt: string; html: string; enabled: boolean; hideGroups: number[]; startsAt: Date | null; endsAt: Date | null };
export type GcsAdView = Omit<AdUnit, "hideGroups"> & { hideGroups: number[]; impressions: number; clicks: number; live: boolean };

const IMAGE_URL = /^(\/files\/[A-Za-z0-9_-]{1,40}|https:\/\/\S{4,500})$/;
const LINK_URL = /^https?:\/\/\S{3,1000}$/;

const groupsOf = (v: unknown): number[] => (Array.isArray(v) ? v.filter((g): g is number => Number.isInteger(g)) : []);
const isLive = (u: Pick<AdUnit, "enabled" | "startsAt" | "endsAt">, now: Date) => u.enabled && (!u.startsAt || u.startsAt <= now) && (!u.endsAt || u.endsAt > now);

/**
 * Reclamele: o imagine (încărcată sau https) cu link, ori un bloc HTML curățat (fără scripturi), cu grupurile care nu
 * le văd și programarea. Widget-ul „Reclamă” arată una anume sau, fără alegere, una la întâmplare dintre cele active;
 * afișările și click-urile (prin `/go/ad/<id>`) se numără în stocarea cheilor.
 */
export class GcsAdService {
  constructor(private readonly deps: { db: PrismaClient; kv: GcsKv; acp: Pick<GcsAcpRoleService, "assert"> }) {}

  private validate(input: GcsAdInput): Omit<GcsAdInput, "hideGroups"> & { hideGroups: number[] } {
    const name = input.name.trim();
    const errors: Record<string, string> = {};
    if (name.length < 2 || name.length > 80) errors.name = "length";
    if (input.kind === "image") {
      if (!IMAGE_URL.test(input.imageUrl)) errors.imageUrl = "invalid_url";
      if (input.linkUrl && !LINK_URL.test(input.linkUrl)) errors.linkUrl = "invalid_url";
    } else if (input.kind === "html") {
      if (input.html.trim().length < 3 || input.html.length > 20_000) errors.html = "length";
    } else errors.kind = "invalid_choice";
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) errors.endsAt = "invalid_range";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return {
      ...input,
      name,
      alt: input.alt.trim().slice(0, 200),
      // HTML-ul trece prin același sanitizer ca postările: fără scripturi, iframe-uri sau atribute de evenimente.
      html: input.kind === "html" ? sanitizeContentHtml(input.html) : "",
      imageUrl: input.kind === "image" ? input.imageUrl : "",
      linkUrl: input.kind === "image" ? input.linkUrl : "",
      hideGroups: [...new Set(input.hideGroups)],
    };
  }

  private async stats(): Promise<Record<string, string>> {
    return this.deps.kv.hgetall(ADS_STATS_KEY).catch(() => ({}));
  }

  async list(actor: GcsActor, now = new Date()): Promise<GcsAdView[]> {
    await this.deps.acp.assert(actor, ADS_ACP_SECTION, "view");
    const [rows, stats] = await Promise.all([this.deps.db.adUnit.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }), this.stats()]);
    return rows.map((r) => ({ ...r, hideGroups: groupsOf(r.hideGroups), impressions: Number(stats[`imp:${r.id}`] ?? 0), clicks: Number(stats[`click:${r.id}`] ?? 0), live: isLive(r, now) }));
  }

  /** Numele unităților (pentru câmpul widget-ului). */
  async names(): Promise<{ id: number; name: string }[]> {
    return this.deps.db.adUnit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  }

  async save(actor: GcsActor, id: number | null, input: GcsAdInput): Promise<{ id: number }> {
    await this.deps.acp.assert(actor, ADS_ACP_SECTION, "edit");
    const v = this.validate(input);
    const data = { name: v.name, kind: v.kind, imageUrl: v.imageUrl, linkUrl: v.linkUrl, alt: v.alt, html: v.html, enabled: v.enabled, hideGroups: v.hideGroups, startsAt: v.startsAt, endsAt: v.endsAt };
    const row = id === null ? await this.deps.db.adUnit.create({ data, select: { id: true } }) : await this.deps.db.adUnit.update({ where: { id }, data, select: { id: true } }).catch(() => null);
    if (!row) throw new GcsNotFound({ entity: "ad" });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: id === null ? "ads.create" : "ads.update", targetType: "ad", targetId: String(row.id), after: { name: v.name, kind: v.kind, enabled: v.enabled }, ip: actor.ip });
    return row;
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, ADS_ACP_SECTION, "delete");
    const { count } = await this.deps.db.adUnit.deleteMany({ where: { id } });
    if (count === 0) throw new GcsNotFound({ entity: "ad" });
    await this.deps.kv.hdel(ADS_STATS_KEY, [`imp:${id}`, `click:${id}`]).catch(() => {});
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "ads.delete", targetType: "ad", targetId: String(id), ip: actor.ip });
  }

  async resetStats(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, ADS_ACP_SECTION, "edit");
    await this.deps.kv.hdel(ADS_STATS_KEY, [`imp:${id}`, `click:${id}`]);
  }

  /**
   * Reclama de afișat pentru un vizitator: unitatea aleasă (`unitId`) sau una la întâmplare dintre cele active, dacă
   * grupurile lui nu sunt ascunse. Numără afișarea. `null` = nimic de arătat.
   */
  async pick(viewerGroupIds: number[], unitId: number | null, now = new Date()): Promise<Pick<AdUnit, "id" | "kind" | "imageUrl" | "linkUrl" | "alt" | "html"> | null> {
    const rows = await this.deps.db.adUnit.findMany({ where: { enabled: true, ...(unitId !== null ? { id: unitId } : {}) } });
    const shown = rows.filter((r) => isLive(r, now) && !groupsOf(r.hideGroups).some((g) => viewerGroupIds.includes(g)));
    if (shown.length === 0) return null;
    const ad = shown[Math.floor(Math.random() * shown.length)]!;
    await this.deps.kv.hincrby(ADS_STATS_KEY, `imp:${ad.id}`, 1).catch(() => 0);
    return { id: ad.id, kind: ad.kind, imageUrl: ad.imageUrl, linkUrl: ad.linkUrl, alt: ad.alt, html: ad.html };
  }

  /** Click-ul din `/go/ad/<id>`: numără și întoarce adresa reclamei (`null` = inexistentă sau fără link). */
  async click(id: number): Promise<string | null> {
    const ad = await this.deps.db.adUnit.findUnique({ where: { id }, select: { linkUrl: true, kind: true } });
    if (!ad || ad.kind !== "image" || !LINK_URL.test(ad.linkUrl)) return null;
    await this.deps.kv.hincrby(ADS_STATS_KEY, `click:${id}`, 1).catch(() => 0);
    return ad.linkUrl;
  }
}
