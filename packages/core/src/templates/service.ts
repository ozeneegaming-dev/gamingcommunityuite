import type { Prisma, PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";
import { DEFAULT_TEMPLATES, defaultTemplate, type GcsTemplateDef } from "./defaults";
import { GcsTemplateError, TEMPLATE_MAX_SOURCE } from "./parser";
import { renderTemplate, templateSyntaxError, type GcsTemplateRenderOptions } from "./render";
import { sanitizeTemplateHtml } from "./sanitize";

export const TEMPLATES_ACP_SECTION = "appearance.templates";
const CACHE_TAG = "templates";
const CACHE_TTL = 3600;
const HISTORY_LIMIT = 100;

/** Suprascrierile unei teme, după cheie (ce citește site-ul la randare). */
export type GcsTemplateOverrides = Record<string, { source: string; baseVersion: number }>;

/** `default` = șablonul din cod; `modified` = suprascris; `review` = suprascris, dar originalul s-a schimbat de atunci. */
export type GcsTemplateStatus = "default" | "modified" | "review";

export type GcsTemplateEntry = { def: GcsTemplateDef; status: GcsTemplateStatus; updatedAt: string | null };

export type GcsTemplateVersionView = { id: number; action: string; authorName: string; createdAt: string; source: string };

export type GcsTemplateDetail = {
  def: GcsTemplateDef;
  status: GcsTemplateStatus;
  override: { source: string; baseVersion: number; baseSource: string; updatedAt: string } | null;
  versions: GcsTemplateVersionView[];
};

/** Eroarea de sintaxă a unui șablon, ca eroare de validare cu poziția în parametri (pentru editor). */
export function templateValidationError(error: GcsTemplateError): GcsValidationError {
  return new GcsValidationError(
    { source: "template_syntax" },
    { error: error.code, line: String(error.line), column: String(error.column), detail: error.detail, ...(error.template ? { template: error.template } : {}) },
  );
}

const statusOf = (def: GcsTemplateDef, override: { baseVersion: number } | undefined): GcsTemplateStatus =>
  !override ? "default" : override.baseVersion < def.version ? "review" : "modified";

/**
 * Șabloanele editabile (specul etapei 6, §3): cele implicite stau în cod, iar fiecare temă își poate suprascrie
 * oricare dintre ele (ACP → Aspect → Șabloane), cu istoric, diferențe și revenire la original. Site-ul citește
 * suprascrierile din cache (eticheta `templates`), invalidat la orice modificare.
 */
export class GcsTemplateService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; acp: GcsAcpRoleService }) {}

  catalog(): GcsTemplateDef[] {
    return DEFAULT_TEMPLATES;
  }

  /** Suprascrierile unei teme (o temă inexistentă = niciuna). */
  async overrides(themeKey: string): Promise<GcsTemplateOverrides> {
    const cacheKey = `templates:theme:${themeKey}`;
    const cached = await this.deps.cache.get<GcsTemplateOverrides>(cacheKey);
    if (cached) return cached;
    const rows = await this.deps.db.themeTemplate.findMany({ where: { theme: { key: themeKey } }, select: { key: true, source: true, baseVersion: true } });
    const map: GcsTemplateOverrides = {};
    for (const r of rows) if (defaultTemplate(r.key)) map[r.key] = { source: r.source, baseVersion: r.baseVersion };
    await this.deps.cache.set(cacheKey, map, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return map;
  }

  /** Arborele din editor: fiecare șablon cu starea lui pe tema dată. */
  async tree(themeKey: string): Promise<GcsTemplateEntry[]> {
    const rows = await this.deps.db.themeTemplate.findMany({ where: { theme: { key: themeKey } }, select: { key: true, baseVersion: true, updatedAt: true } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return DEFAULT_TEMPLATES.map((def) => {
      const o = byKey.get(def.key);
      return { def, status: statusOf(def, o), updatedAt: o ? o.updatedAt.toISOString() : null };
    });
  }

  async detail(themeKey: string, key: string): Promise<GcsTemplateDetail> {
    const def = defaultTemplate(key);
    if (!def) throw new GcsNotFound();
    const theme = await this.theme(themeKey);
    const [override, versions] = await Promise.all([
      this.deps.db.themeTemplate.findUnique({ where: { themeId_key: { themeId: theme.id, key } } }),
      this.deps.db.themeTemplateVersion.findMany({ where: { themeId: theme.id, key }, orderBy: { id: "desc" }, take: HISTORY_LIMIT }),
    ]);
    return {
      def,
      status: statusOf(def, override ?? undefined),
      override: override ? { source: override.source, baseVersion: override.baseVersion, baseSource: override.baseSource, updatedAt: override.updatedAt.toISOString() } : null,
      versions: versions.map((v) => ({ id: v.id, action: v.action, authorName: v.authorName, createdAt: v.createdAt.toISOString(), source: v.source })),
    };
  }

  /**
   * Validează sursa unui șablon (mărime, sintaxă, includeri cunoscute). Aruncă `GcsValidationError` cu rândul și
   * coloana erorii în parametri.
   */
  validate(key: string, source: string): void {
    const def = defaultTemplate(key);
    if (!def) throw new GcsNotFound();
    if (typeof source !== "string") throw new GcsValidationError({ source: "invalid_type" });
    if (source.length > TEMPLATE_MAX_SOURCE) throw new GcsValidationError({ source: "too_long" });
    const error = templateSyntaxError(source);
    if (error) throw templateValidationError(error);
  }

  /**
   * Randează un șablon pentru o temă: suprascrierea (dacă `source` lipsește) sau sursa dată (previzualizarea), cu
   * includerile rezolvate tot pe tema respectivă. Rezultatul e sanitizat după modul șablonului.
   */
  async render(
    themeKey: string,
    key: string,
    data: Record<string, unknown>,
    opts: GcsTemplateRenderOptions & { source?: string } = {},
  ): Promise<string | null> {
    const def = defaultTemplate(key);
    if (!def) throw new GcsNotFound();
    const overrides = await this.overrides(themeKey);
    const source = opts.source ?? overrides[key]?.source;
    if (source === undefined) return null;
    const html = renderTemplate(source, data, { include: (name) => this.sourceFor(overrides, name), ...opts, name: opts.name ?? key });
    return sanitizeTemplateHtml(html, def.mode);
  }

  /** Sursa unui șablon pentru includeri: suprascrierea temei sau cea implicită. */
  sourceFor(overrides: GcsTemplateOverrides, key: string): string | null {
    return overrides[key]?.source ?? defaultTemplate(key)?.source ?? null;
  }

  async save(actor: GcsActor, themeKey: string, key: string, source: string, action: "save" | "restore" | "import" = "save"): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, TEMPLATES_ACP_SECTION, "edit");
    this.validate(key, source);
    const def = defaultTemplate(key)!;
    const theme = await this.theme(themeKey);
    const authorName = await this.authorName(actor);
    const before = await db.themeTemplate.findUnique({ where: { themeId_key: { themeId: theme.id, key } }, select: { source: true } });
    await db.$transaction(async (tx) => {
      await tx.themeTemplate.upsert({
        where: { themeId_key: { themeId: theme.id, key } },
        create: { themeId: theme.id, key, source, baseVersion: def.version, baseSource: def.source },
        update: { source, baseVersion: def.version, baseSource: def.source },
      });
      await tx.themeTemplateVersion.create({ data: { themeId: theme.id, key, source, action, authorId: actor.userId, authorName } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: `theme.template.${action}`,
        targetType: "theme_template",
        targetId: `${themeKey}:${key}`,
        before: before ? { source: before.source } : null,
        after: { source },
        ip: actor.ip,
      });
    });
    await this.changed();
  }

  /** „Revino la original”: suprascrierea dispare (istoricul rămâne, cu o intrare `revert`). */
  async revert(actor: GcsActor, themeKey: string, key: string): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, TEMPLATES_ACP_SECTION, "edit");
    const def = defaultTemplate(key);
    if (!def) throw new GcsNotFound();
    const theme = await this.theme(themeKey);
    const row = await db.themeTemplate.findUnique({ where: { themeId_key: { themeId: theme.id, key } } });
    if (!row) return;
    const authorName = await this.authorName(actor);
    await db.$transaction(async (tx) => {
      await tx.themeTemplate.delete({ where: { id: row.id } });
      await tx.themeTemplateVersion.create({ data: { themeId: theme.id, key, source: def.source, action: "revert", authorId: actor.userId, authorName } });
      await writeAudit(tx, { actorId: actor.userId, action: "theme.template.revert", targetType: "theme_template", targetId: `${themeKey}:${key}`, before: { source: row.source }, ip: actor.ip });
    });
    await this.changed();
  }

  /** Restaurează o versiune din istoric (devine suprascrierea curentă, cu o intrare `restore`). */
  async restore(actor: GcsActor, themeKey: string, versionId: number): Promise<string> {
    await this.deps.acp.assert(actor, TEMPLATES_ACP_SECTION, "edit");
    const theme = await this.theme(themeKey);
    const version = await this.deps.db.themeTemplateVersion.findFirst({ where: { id: versionId, themeId: theme.id } });
    if (!version) throw new GcsNotFound();
    await this.save(actor, themeKey, version.key, version.source, "restore");
    return version.key;
  }

  /** „Marchează ca revizuit”: suprascrierea rămâne, dar se aliniază la versiunea curentă a originalului. */
  async markReviewed(actor: GcsActor, themeKey: string, key: string): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, TEMPLATES_ACP_SECTION, "edit");
    const def = defaultTemplate(key);
    if (!def) throw new GcsNotFound();
    const theme = await this.theme(themeKey);
    const updated = await db.themeTemplate.updateMany({ where: { themeId: theme.id, key }, data: { baseVersion: def.version, baseSource: def.source } });
    if (updated.count === 0) throw new GcsNotFound();
    await writeAudit(db, { actorId: actor.userId, action: "theme.template.reviewed", targetType: "theme_template", targetId: `${themeKey}:${key}`, ip: actor.ip });
    await this.changed();
  }

  /** Copiază suprascrierile unei teme în alta (tema nouă pornită din una existentă). */
  static async copy(tx: Prisma.TransactionClient, fromThemeId: number, toThemeId: number): Promise<void> {
    const rows = await tx.themeTemplate.findMany({ where: { themeId: fromThemeId } });
    if (rows.length === 0) return;
    await tx.themeTemplate.createMany({ data: rows.map((r) => ({ themeId: toThemeId, key: r.key, source: r.source, baseVersion: r.baseVersion, baseSource: r.baseSource })) });
  }

  private async theme(themeKey: string): Promise<{ id: number }> {
    const theme = await this.deps.db.theme.findUnique({ where: { key: themeKey }, select: { id: true } });
    if (!theme) throw new GcsNotFound();
    return theme;
  }

  private async authorName(actor: GcsActor): Promise<string> {
    if (!actor.userId) return "";
    const user = await this.deps.db.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    return user?.name ?? "";
  }

  private async changed(): Promise<void> {
    await this.deps.bus.emit({ name: "templates.updated", payload: {}, tags: [CACHE_TAG] });
  }
}
