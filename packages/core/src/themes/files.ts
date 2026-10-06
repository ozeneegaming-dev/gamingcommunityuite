import { Prisma, type PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import { GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";
import { CUSTOM_CSS_FILE, sanitizeThemeCssReport, type GcsCssRemoval } from "./css";

export const CSS_ACP_SECTION = "appearance.css";
export const CSS_FILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}\.css$/;
export const MAX_CSS_FILE = 50_000;
export const MAX_CSS_FILES = 30;
const HISTORY_LIMIT = 100;
const CACHE_TAG = "themes";

export type GcsCssFileView = { id: number; name: string; position: number; content: string; updatedAt: string; locked: boolean };
export type GcsCssVersionView = { id: number; action: string; authorName: string; createdAt: string; content: string };
export type GcsCssSaveResult = { file: GcsCssFileView; removed: GcsCssRemoval[]; changed: boolean };
type Author = { authorId: string | null; authorName: string };

const view = (f: { id: number; name: string; position: number; content: string; updatedAt: Date }): GcsCssFileView => ({
  id: f.id,
  name: f.name,
  position: f.position,
  content: f.content,
  updatedAt: f.updatedAt.toISOString(),
  locked: f.name === CUSTOM_CSS_FILE,
});

/**
 * Fișierele CSS ale temelor (ACP → Aspect → CSS): mai multe fișiere pe temă, compilate în ordine după CSS-ul generat
 * din setări, cu istoric pe fiecare fișier (prima versiune = originalul). Conținutul salvat e deja sanitizat
 * (`sanitizeThemeCssReport`), iar raportul spune adminului ce s-a scos. Orice modificare crește versiunea temei,
 * deci URL-ul CSS-ului public se schimbă.
 */
export class GcsThemeCssService {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus; acp: GcsAcpRoleService }) {}

  async files(themeKey: string): Promise<GcsCssFileView[]> {
    const theme = await this.theme(themeKey);
    const rows = await this.deps.db.themeCssFile.findMany({ where: { themeId: theme.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    return rows.map(view);
  }

  /** Istoricul unui fișier, cel mai nou primul, plus originalul (prima versiune). */
  async history(themeKey: string, fileId: number): Promise<{ versions: GcsCssVersionView[]; original: GcsCssVersionView | null }> {
    const file = await this.file(themeKey, fileId);
    const [rows, first] = await Promise.all([
      this.deps.db.themeCssVersion.findMany({ where: { fileId: file.id }, orderBy: { id: "desc" }, take: HISTORY_LIMIT }),
      this.deps.db.themeCssVersion.findFirst({ where: { fileId: file.id }, orderBy: { id: "asc" } }),
    ]);
    const toView = (v: { id: number; action: string; authorName: string; createdAt: Date; content: string }): GcsCssVersionView => ({
      id: v.id,
      action: v.action,
      authorName: v.authorName,
      createdAt: v.createdAt.toISOString(),
      content: v.content,
    });
    return { versions: rows.map(toView), original: first ? toView(first) : null };
  }

  async create(actor: GcsActor, themeKey: string, name: string): Promise<GcsCssFileView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CSS_ACP_SECTION, "edit");
    const theme = await this.theme(themeKey);
    const clean = name.trim().toLowerCase();
    if (!CSS_FILE_NAME_RE.test(clean)) throw new GcsValidationError({ name: "invalid_css_name" });
    const count = await db.themeCssFile.count({ where: { themeId: theme.id } });
    if (count >= MAX_CSS_FILES) throw new GcsValidationError({ name: "too_many_files" });
    if (await db.themeCssFile.findUnique({ where: { themeId_name: { themeId: theme.id, name: clean } } })) throw new GcsValidationError({ name: "taken" });
    const author = await this.author(actor);
    const last = await db.themeCssFile.aggregate({ where: { themeId: theme.id }, _max: { position: true } });
    const file = await db.$transaction(async (tx) => {
      const f = await tx.themeCssFile.create({ data: { themeId: theme.id, name: clean, position: (last._max.position ?? -1) + 1 } });
      await tx.themeCssVersion.create({ data: { fileId: f.id, content: "", action: "create", ...author } });
      await this.bump(tx, theme.id);
      await writeAudit(tx, { actorId: actor.userId, action: "theme.css.create", targetType: "theme_css", targetId: `${themeKey}/${clean}`, ip: actor.ip });
      return f;
    });
    await this.changed();
    return view(file);
  }

  async rename(actor: GcsActor, themeKey: string, fileId: number, name: string): Promise<GcsCssFileView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CSS_ACP_SECTION, "edit");
    const file = await this.file(themeKey, fileId);
    const clean = name.trim().toLowerCase();
    if (file.name === CUSTOM_CSS_FILE) throw new GcsValidationError({ name: "locked_file" });
    if (!CSS_FILE_NAME_RE.test(clean) || clean === CUSTOM_CSS_FILE) throw new GcsValidationError({ name: "invalid_css_name" });
    if (clean === file.name) return view(file);
    if (await db.themeCssFile.findUnique({ where: { themeId_name: { themeId: file.themeId, name: clean } } })) throw new GcsValidationError({ name: "taken" });
    const updated = await db.$transaction(async (tx) => {
      const f = await tx.themeCssFile.update({ where: { id: file.id }, data: { name: clean } });
      await this.bump(tx, file.themeId);
      await writeAudit(tx, { actorId: actor.userId, action: "theme.css.rename", targetType: "theme_css", targetId: `${themeKey}/${clean}`, before: { name: file.name }, after: { name: clean }, ip: actor.ip });
      return f;
    });
    await this.changed();
    return view(updated);
  }

  async remove(actor: GcsActor, themeKey: string, fileId: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CSS_ACP_SECTION, "delete");
    const file = await this.file(themeKey, fileId);
    if (file.name === CUSTOM_CSS_FILE) throw new GcsValidationError({ name: "locked_file" });
    await db.$transaction(async (tx) => {
      await tx.themeCssFile.delete({ where: { id: file.id } });
      await this.bump(tx, file.themeId);
      await writeAudit(tx, { actorId: actor.userId, action: "theme.css.delete", targetType: "theme_css", targetId: `${themeKey}/${file.name}`, before: { content: file.content }, ip: actor.ip });
    });
    await this.changed();
  }

  /** Mută un fișier cu o poziție mai sus (`-1`) sau mai jos (`1`) în ordinea compilării. */
  async move(actor: GcsActor, themeKey: string, fileId: number, direction: -1 | 1): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CSS_ACP_SECTION, "edit");
    const file = await this.file(themeKey, fileId);
    const files = await db.themeCssFile.findMany({ where: { themeId: file.themeId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    const index = files.findIndex((f) => f.id === file.id);
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const order = [...files];
    [order[index], order[target]] = [order[target]!, order[index]!];
    await db.$transaction(async (tx) => {
      for (const [i, f] of order.entries()) await tx.themeCssFile.update({ where: { id: f.id }, data: { position: i } });
      await this.bump(tx, file.themeId);
      await writeAudit(tx, { actorId: actor.userId, action: "theme.css.reorder", targetType: "theme", targetId: themeKey, after: { order: order.map((f) => f.name) }, ip: actor.ip });
    });
    await this.changed();
  }

  /**
   * Salvează un fișier: conținutul e sanitizat (raportul spune ce s-a scos), devine o versiune nouă (dacă diferă) și
   * intră imediat în CSS-ul public al temei. Salvarea lui `custom.css` șterge și CSS-ul din draft-ul editorului vizual,
   * ca publicarea acelui draft să nu suprascrie fișierul cu o copie veche.
   */
  async save(actor: GcsActor, themeKey: string, fileId: number, content: string, action: "save" | "restore" | "import" = "save"): Promise<GcsCssSaveResult> {
    const { db, acp } = this.deps;
    await acp.assert(actor, CSS_ACP_SECTION, "edit");
    if (typeof content !== "string") throw new GcsValidationError({ content: "invalid_type" });
    if (content.length > MAX_CSS_FILE) throw new GcsValidationError({ content: "too_long" });
    const file = await this.file(themeKey, fileId);
    const { css, removed } = sanitizeThemeCssReport(content);
    if (css === file.content) return { file: view(file), removed, changed: false };
    const author = await this.author(actor);
    const updated = await db.$transaction(async (tx) => {
      const f = await tx.themeCssFile.update({ where: { id: file.id }, data: { content: css } });
      await tx.themeCssVersion.create({ data: { fileId: file.id, content: css, action, ...author } });
      if (file.name === CUSTOM_CSS_FILE) await GcsThemeCssService.dropDraftCss(tx, file.themeId);
      await this.bump(tx, file.themeId);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: `theme.css.${action}`,
        targetType: "theme_css",
        targetId: `${themeKey}/${file.name}`,
        before: { content: file.content },
        after: { content: css },
        ip: actor.ip,
      });
      return f;
    });
    await this.changed();
    return { file: view(updated), removed, changed: true };
  }

  /** Restaurează o versiune din istoricul unui fișier (devine o versiune nouă, `restore`). */
  async restore(actor: GcsActor, themeKey: string, fileId: number, versionId: number): Promise<GcsCssSaveResult> {
    await this.deps.acp.assert(actor, CSS_ACP_SECTION, "edit");
    const file = await this.file(themeKey, fileId);
    const version = await this.deps.db.themeCssVersion.findFirst({ where: { id: versionId, fileId: file.id } });
    if (!version) throw new GcsNotFound();
    return this.save(actor, themeKey, file.id, version.content, "restore");
  }

  // ─── Pentru serviciul temelor (în tranzacția lui) ─────────────────────────

  /** `custom.css` gol (sau cu conținutul dat) pentru o temă nouă, cu prima versiune. */
  static async seed(tx: Prisma.TransactionClient, themeId: number, content: string, author: Author): Promise<void> {
    const f = await tx.themeCssFile.create({ data: { themeId, name: CUSTOM_CSS_FILE, position: 0, content } });
    await tx.themeCssVersion.create({ data: { fileId: f.id, content, action: "create", ...author } });
  }

  /** Copiază fișierele unei teme într-o temă nouă (fiecare cu o primă versiune). */
  static async copy(tx: Prisma.TransactionClient, fromThemeId: number, toThemeId: number, author: Author): Promise<void> {
    const files = await tx.themeCssFile.findMany({ where: { themeId: fromThemeId }, orderBy: [{ position: "asc" }, { id: "asc" }] });
    if (!files.some((f) => f.name === CUSTOM_CSS_FILE)) await GcsThemeCssService.seed(tx, toThemeId, "", author);
    for (const f of files) {
      const copy = await tx.themeCssFile.create({ data: { themeId: toThemeId, name: f.name, position: f.position, content: f.content } });
      await tx.themeCssVersion.create({ data: { fileId: copy.id, content: f.content, action: "create", ...author } });
    }
  }

  /** Publicarea editorului vizual: `custom.css` primește CSS-ul din draft, ca versiune nouă (`publish`). */
  static async writeCustomCss(tx: Prisma.TransactionClient, themeId: number, content: string, opts: Author & { action: string }): Promise<void> {
    const existing = await tx.themeCssFile.findUnique({ where: { themeId_name: { themeId, name: CUSTOM_CSS_FILE } } });
    const author = { authorId: opts.authorId, authorName: opts.authorName };
    if (!existing) {
      const f = await tx.themeCssFile.create({ data: { themeId, name: CUSTOM_CSS_FILE, position: -1, content } });
      await tx.themeCssVersion.create({ data: { fileId: f.id, content, action: opts.action, ...author } });
      return;
    }
    await tx.themeCssFile.update({ where: { id: existing.id }, data: { content } });
    await tx.themeCssVersion.create({ data: { fileId: existing.id, content, action: opts.action, ...author } });
  }

  /** Scoate `customCss` din draft-ul editorului vizual (restul draft-ului rămâne). */
  private static async dropDraftCss(tx: Prisma.TransactionClient, themeId: number): Promise<void> {
    const theme = await tx.theme.findUnique({ where: { id: themeId }, select: { draft: true } });
    const draft = theme?.draft;
    if (!draft || typeof draft !== "object" || Array.isArray(draft) || !("customCss" in draft)) return;
    const { customCss: _drop, ...rest } = draft as Record<string, unknown>;
    await tx.theme.update({ where: { id: themeId }, data: { draft: Object.keys(rest).length > 0 ? (rest as Prisma.InputJsonValue) : Prisma.DbNull } });
  }

  private async bump(tx: Prisma.TransactionClient, themeId: number): Promise<void> {
    await tx.theme.update({ where: { id: themeId }, data: { version: { increment: 1 } } });
  }

  private async theme(themeKey: string): Promise<{ id: number }> {
    const theme = await this.deps.db.theme.findUnique({ where: { key: themeKey }, select: { id: true } });
    if (!theme) throw new GcsNotFound();
    return theme;
  }

  private async file(themeKey: string, fileId: number) {
    const file = await this.deps.db.themeCssFile.findFirst({ where: { id: fileId, theme: { key: themeKey } } });
    if (!file) throw new GcsNotFound();
    return file;
  }

  private async author(actor: GcsActor): Promise<Author> {
    if (!actor.userId) return { authorId: null, authorName: "" };
    const user = await this.deps.db.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    return { authorId: actor.userId, authorName: user?.name ?? "" };
  }

  private async changed(): Promise<void> {
    await this.deps.bus.emit({ name: "themes.updated", payload: {}, tags: [CACHE_TAG] });
  }
}
