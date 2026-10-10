import { Prisma, type PrismaClient, type Theme } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsConflict, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";
import { compileThemeCss, CUSTOM_CSS_FILE, joinThemeCssFiles, sanitizeThemeCss } from "./css";
import { GcsThemeCssService } from "./files";
import { buildThemePackage, parseThemePackage, themePackageFiles, type GcsThemePackage } from "./package";
import { GcsTemplateService } from "../templates/service";
import {
  DEFAULT_THEME_SETTINGS,
  NOVA_THEME_SETTINGS,
  isThemeFileUrl,
  mergeThemeObjects,
  normalizeThemeSettings,
  themeSettingsErrors,
  type GcsDeepPartial,
  type GcsThemeSettings,
} from "./settings";

export const THEMES_ACP_SECTION = "appearance.themes";
const CACHE_TAG = "themes";
const CACHE_TTL = 3600;
const KEY_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MAX_CSS = 50_000;

/**
 * Draft-ul unei teme: un patch (în adâncime) peste setări, plus CSS-ul extra, logo-ul și favicon-ul.
 * `{ header: { height: 72 } }` schimbă doar înălțimea antetului.
 */
export type GcsThemeDraft = GcsDeepPartial<GcsThemeSettings> & {
  customCss?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
};

export type GcsThemeView = {
  key: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  settings: GcsThemeSettings;
  /** Fișierele CSS ale temei, în ordinea compilării (ACP → Aspect → CSS); `custom.css` e CSS-ul editorului vizual. */
  cssFiles: { name: string; content: string }[];
  logoUrl: string | null;
  faviconUrl: string | null;
  version: number;
  draft: GcsThemeDraft | null;
};

/** Partea de setări a unui draft (fără CSS-ul extra și imaginile din coloanele temei). */
function draftSettings(draft: GcsThemeDraft): GcsDeepPartial<GcsThemeSettings> {
  const { customCss: _css, logoUrl: _logo, faviconUrl: _favicon, ...settings } = draft;
  return settings;
}

/** Validează un patch de draft; întoarce erorile pe câmpuri (gol = valid). */
export function themeDraftErrors(patch: GcsThemeDraft): Record<string, string> {
  const errors = themeSettingsErrors(draftSettings(patch));
  if (patch.customCss !== undefined && (typeof patch.customCss !== "string" || patch.customCss.length > MAX_CSS)) errors.customCss = "too_long";
  if (patch.logoUrl !== undefined && !isThemeFileUrl(patch.logoUrl)) errors.logoUrl = "invalid";
  if (patch.faviconUrl !== undefined && !isThemeFileUrl(patch.faviconUrl)) errors.faviconUrl = "invalid";
  return errors;
}

/** Conținutul lui `custom.css` (CSS-ul din dialogul editorului vizual). */
export function themeCustomCss(theme: Pick<GcsThemeView, "cssFiles">): string {
  return theme.cssFiles.find((f) => f.name === CUSTOM_CSS_FILE)?.content ?? "";
}

/** Fișierele temei cu `custom.css` înlocuit (draft-ul editorului vizual); fără fișierul lui, `custom.css` se adaugă primul. */
function withCustomCss(files: GcsThemeView["cssFiles"], customCss: string): GcsThemeView["cssFiles"] {
  if (!files.some((f) => f.name === CUSTOM_CSS_FILE)) return [{ name: CUSTOM_CSS_FILE, content: customCss }, ...files];
  return files.map((f) => (f.name === CUSTOM_CSS_FILE ? { ...f, content: customCss } : f));
}

type ThemeRow = Theme & { cssFiles?: { name: string; content: string }[] };

function toView(t: ThemeRow): GcsThemeView {
  return {
    key: t.key,
    name: t.name,
    isDefault: t.isDefault,
    enabled: t.enabled,
    settings: normalizeThemeSettings(t.settings),
    cssFiles: (t.cssFiles ?? []).map((f) => ({ name: f.name, content: f.content })),
    logoUrl: t.logoUrl,
    faviconUrl: t.faviconUrl,
    version: t.version,
    draft: (t.draft ?? null) as GcsThemeDraft | null,
  };
}

/**
 * Temele (specul etapei 5 §5): paleta pentru dark și light, fonturile, raza, lățimea, logo-ul, favicon-ul și CSS-ul
 * extra. Editarea se face direct pe site: modificările stau în `draft` (le vede doar adminul, în previzualizare) până
 * la „Publică”, care crește `version` (URL-ul CSS-ului se schimbă, deci browserele îl iau imediat).
 */
export class GcsThemeService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; acp: GcsAcpRoleService }) {}

  async list(): Promise<GcsThemeView[]> {
    const cached = await this.deps.cache.get<GcsThemeView[]>("themes:all");
    // Cache-ul poate fi scris de o versiune mai veche (setări fără câmpurile noi): îl completăm cu valorile implicite.
    if (cached) return cached.map((v) => ({ ...v, settings: normalizeThemeSettings(v.settings), cssFiles: Array.isArray(v.cssFiles) ? v.cssFiles : [] }));
    const rows = await this.deps.db.theme.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { cssFiles: { select: { name: true, content: true }, orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    const views = rows.map(toView);
    await this.deps.cache.set("themes:all", views, { ttlSec: CACHE_TTL, tags: [CACHE_TAG] });
    return views;
  }

  async get(key: string): Promise<GcsThemeView | null> {
    return (await this.list()).find((t) => t.key === key) ?? null;
  }

  /** Tema activă pentru viewer: cea aleasă de el (dacă e activă), altfel cea implicită, altfel valorile implicite. */
  async active(preferred?: string | null): Promise<GcsThemeView> {
    const all = await this.list();
    const pick = (preferred && all.find((t) => t.key === preferred && t.enabled)) || all.find((t) => t.isDefault) || all[0];
    return (
      pick ?? {
        key: "default",
        name: "Default",
        isDefault: true,
        enabled: true,
        settings: DEFAULT_THEME_SETTINGS,
        cssFiles: [],
        logoUrl: null,
        faviconUrl: null,
        version: 0,
        draft: null,
      }
    );
  }

  /**
   * CSS-ul publicat al temei (sau al draft-ului, pentru previzualizarea adminului): CSS-ul generat din setări, apoi
   * fișierele CSS ale temei, în ordine.
   */
  css(theme: GcsThemeView, opts: { draft?: boolean } = {}): string {
    const shown = opts.draft ? this.withDraft(theme) : theme;
    return compileThemeCss(shown.settings, joinThemeCssFiles(shown.cssFiles));
  }

  /** Tema cu draft-ul aplicat (ce vede adminul în previzualizare); fără draft, tema publicată. */
  withDraft(theme: GcsThemeView): GcsThemeView {
    if (!theme.draft) return theme;
    const { customCss, ...merged } = this.merge(theme, theme.draft);
    return { ...theme, ...merged, cssFiles: withCustomCss(theme.cssFiles, customCss) };
  }

  private merge(theme: GcsThemeView, draft: GcsThemeDraft) {
    const settings = normalizeThemeSettings(mergeThemeObjects(theme.settings, draftSettings(draft)));
    return {
      settings,
      customCss: draft.customCss !== undefined ? sanitizeThemeCss(draft.customCss) : themeCustomCss(theme),
      logoUrl: draft.logoUrl !== undefined ? draft.logoUrl : theme.logoUrl,
      faviconUrl: draft.faviconUrl !== undefined ? draft.faviconUrl : theme.faviconUrl,
    };
  }

  private async changed(): Promise<void> {
    await this.deps.bus.emit({ name: "themes.updated", payload: {}, tags: [CACHE_TAG] });
  }

  /** Salvează modificări în draft (vizibile doar în previzualizare). */
  async saveDraft(actor: GcsActor, key: string, patch: GcsThemeDraft): Promise<GcsThemeDraft> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    const theme = await db.theme.findUnique({ where: { key } });
    if (!theme) throw new GcsNotFound();
    const errors = themeDraftErrors(patch);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const prev = (theme.draft ?? {}) as GcsThemeDraft;
    const next: GcsThemeDraft = {
      ...mergeThemeObjects(prev, patch),
      ...(patch.customCss !== undefined ? { customCss: sanitizeThemeCss(patch.customCss) } : {}),
    };
    await db.theme.update({ where: { key }, data: { draft: next as Prisma.InputJsonValue } });
    await this.changed();
    return next;
  }

  /** Renunță la draft (tema publicată rămâne neschimbată); cu jurnal, dacă exista un draft. */
  async discardDraft(actor: GcsActor, key: string): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    const row = await db.theme.findUnique({ where: { key }, select: { draft: true } });
    if (!row?.draft) return;
    await db.$transaction(async (tx) => {
      await tx.theme.update({ where: { key }, data: { draft: Prisma.DbNull } });
      await writeAudit(tx, { actorId: actor.userId, action: "theme.discard", targetType: "theme", targetId: key, before: { draft: row.draft }, ip: actor.ip });
    });
    await this.changed();
  }

  /**
   * Mută draft-ul în temă și crește versiunea (cu jurnal). CSS-ul din dialogul editorului vizual devine o versiune
   * nouă a fișierului `custom.css` (aceeași sursă ca ACP → Aspect → CSS).
   */
  async publish(actor: GcsActor, key: string): Promise<GcsThemeView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    const withFiles = { cssFiles: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] } };
    const row = await db.theme.findUnique({ where: { key }, include: withFiles });
    if (!row) throw new GcsNotFound();
    const theme = toView(row);
    if (!theme.draft) throw new GcsConflict({ reason: "no_draft" });
    const merged = this.merge(theme, theme.draft);
    const cssChanged = theme.draft.customCss !== undefined && merged.customCss !== themeCustomCss(theme);
    const authorName = cssChanged && actor.userId ? ((await db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? "") : "";
    await db.$transaction(async (tx) => {
      await tx.theme.update({
        where: { key },
        data: {
          settings: merged.settings as unknown as Prisma.InputJsonValue,
          logoUrl: merged.logoUrl,
          faviconUrl: merged.faviconUrl,
          draft: Prisma.DbNull,
          version: { increment: 1 },
        },
      });
      if (cssChanged) await GcsThemeCssService.writeCustomCss(tx, row.id, merged.customCss, { authorId: actor.userId, authorName, action: "publish" });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "theme.publish",
        targetType: "theme",
        targetId: key,
        before: { settings: theme.settings, customCss: themeCustomCss(theme), logoUrl: theme.logoUrl, faviconUrl: theme.faviconUrl },
        after: merged,
        ip: actor.ip,
      });
    });
    await this.changed();
    return toView(await db.theme.findUniqueOrThrow({ where: { key }, include: withFiles }));
  }

  async create(actor: GcsActor, input: { key: string; name: string; from?: string }): Promise<GcsThemeView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    if (!KEY_RE.test(input.key)) throw new GcsValidationError({ key: "invalid_key" });
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) throw new GcsValidationError({ name: "invalid_length" });
    if (await db.theme.findUnique({ where: { key: input.key } })) throw new GcsValidationError({ key: "taken" });
    const source = input.from ? await db.theme.findUnique({ where: { key: input.from } }) : null;
    const authorName = actor.userId ? ((await db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? "") : "";
    const row = await db.$transaction(async (tx) => {
      const r = await tx.theme.create({
        data: {
          key: input.key,
          name,
          settings: (source?.settings ?? DEFAULT_THEME_SETTINGS) as unknown as Prisma.InputJsonValue,
          logoUrl: source?.logoUrl ?? null,
          faviconUrl: source?.faviconUrl ?? null,
        },
      });
      // Tema nouă pornește cu fișierele CSS și șabloanele modificate ale temei sursă (altfel doar cu `custom.css`).
      if (source) {
        await GcsThemeCssService.copy(tx, source.id, r.id, { authorId: actor.userId, authorName });
        await GcsTemplateService.copy(tx, source.id, r.id);
      } else {
        await GcsThemeCssService.seed(tx, r.id, "", { authorId: actor.userId, authorName });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "theme.create", targetType: "theme", targetId: input.key, after: { name, from: input.from ?? null }, ip: actor.ip });
      return r;
    });
    await this.changed();
    return toView(row);
  }

  /** Pachetul unei teme (ACP → Aspect → Teme → Exportă): setările și fișierele CSS publicate, fără imaginile site-ului. */
  async exportPackage(actor: GcsActor, key: string): Promise<GcsThemePackage> {
    await this.deps.acp.assert(actor, THEMES_ACP_SECTION, "view");
    const theme = await this.get(key);
    if (!theme) throw new GcsNotFound();
    return buildThemePackage(theme);
  }

  /**
   * Importă un pachet de temă (ACP → Aspect → Teme → Importă) ca temă nouă, inactivă și neimplicită (adminul o verifică
   * în editorul vizual, apoi o pornește). Cheia ocupată primește un sufix (`-2`, `-3`…); CSS-ul trece prin sanitizare.
   */
  async importPackage(actor: GcsActor, raw: unknown): Promise<GcsThemeView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    const parsed = parseThemePackage(raw);
    if (!parsed.ok) throw new GcsValidationError(parsed.errors);
    const pkg = parsed.value;
    const taken = new Set((await db.theme.findMany({ select: { key: true } })).map((t) => t.key));
    const key = [pkg.key, ...Array.from({ length: 98 }, (_, i) => `${pkg.key.slice(0, 29)}-${i + 2}`)].find((k) => !taken.has(k));
    if (!key) throw new GcsValidationError({ key: "taken" });
    // Valorile lipsă vin din designul pachetului (`preset`), ca la orice temă salvată.
    const settings = normalizeThemeSettings(pkg.settings);
    const authorName = actor.userId ? ((await db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? "") : "";
    const row = await db.$transaction(async (tx) => {
      const r = await tx.theme.create({ data: { key, name: pkg.name, enabled: false, settings: settings as unknown as Prisma.InputJsonValue } });
      for (const [position, f] of themePackageFiles(pkg).entries()) {
        const content = sanitizeThemeCss(f.content);
        const file = await tx.themeCssFile.create({ data: { themeId: r.id, name: f.name, position, content } });
        await tx.themeCssVersion.create({ data: { fileId: file.id, content, action: "import", authorId: actor.userId, authorName } });
      }
      await writeAudit(tx, { actorId: actor.userId, action: "theme.import", targetType: "theme", targetId: key, after: { name: pkg.name, files: pkg.cssFiles.map((f) => f.name) }, ip: actor.ip });
      return r;
    });
    await this.changed();
    return toView({ ...row, cssFiles: themePackageFiles(pkg).map((f) => ({ name: f.name, content: sanitizeThemeCss(f.content) })) });
  }

  async update(actor: GcsActor, key: string, patch: { name?: string; enabled?: boolean; isDefault?: boolean }): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    const theme = await db.theme.findUnique({ where: { key } });
    if (!theme) throw new GcsNotFound();
    if (patch.name !== undefined && (patch.name.trim().length < 1 || patch.name.trim().length > 40)) throw new GcsValidationError({ name: "invalid_length" });
    // Tema implicită rămâne activă; o temă dezactivată nu poate fi implicită.
    if (patch.enabled === false && (patch.isDefault ?? theme.isDefault)) throw new GcsValidationError({ enabled: "default_theme" });
    await db.$transaction(async (tx) => {
      if (patch.isDefault) await tx.theme.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.theme.update({
        where: { key },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.isDefault ? { isDefault: true, enabled: true } : {}),
        },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "theme.update", targetType: "theme", targetId: key, after: patch, ip: actor.ip });
    });
    await this.changed();
  }

  async remove(actor: GcsActor, key: string): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "delete");
    const theme = await db.theme.findUnique({ where: { key } });
    if (!theme) throw new GcsNotFound();
    if (theme.isDefault) throw new GcsValidationError({ key: "default_theme" });
    await db.$transaction(async (tx) => {
      await tx.theme.delete({ where: { key } });
      await writeAudit(tx, { actorId: actor.userId, action: "theme.delete", targetType: "theme", targetId: key, before: toView(theme), ip: actor.ip });
    });
    await this.changed();
  }

  /**
   * Temele incluse (seed; idempotent, specul 2026-10-10-tema-nova §3):
   * - o instalare nouă primește „GCS Nova” (implicită) și „Clasic” (aspectul de până acum, cheia `default`);
   * - o instalare existentă primește Nova o singură dată (marcajul `theme:nova`): tema e creată, devine implicită, iar
   *   vechea temă implicită „Default” e redenumită „Clasic” (un nume ales de admin rămâne). Membrii care și-au ales o
   *   temă (cookie-ul `gcs-skin`) o păstrează. Dacă adminul alege apoi altă temă implicită, seed-ul n-o mai schimbă.
   */
  static async seedDefault(tx: Prisma.TransactionClient): Promise<void> {
    const state = await tx.systemState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const marked = state.seedMarks.includes(NOVA_SEED_MARK);
    const count = await tx.theme.count();
    if (count === 0) {
      await GcsThemeService.createBuiltIn(tx, NOVA_THEME_KEY, NOVA_THEME_NAME, NOVA_THEME_SETTINGS, true);
      await GcsThemeService.createBuiltIn(tx, CLASSIC_THEME_KEY, CLASSIC_THEME_NAME, DEFAULT_THEME_SETTINGS, false);
    } else if (!marked) {
      const taken = new Set((await tx.theme.findMany({ select: { key: true } })).map((t) => t.key));
      const key = [NOVA_THEME_KEY, `gcs-${NOVA_THEME_KEY}`].find((k) => !taken.has(k));
      if (key) {
        await tx.theme.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await GcsThemeService.createBuiltIn(tx, key, NOVA_THEME_NAME, NOVA_THEME_SETTINGS, true);
      }
      await tx.theme.updateMany({ where: { key: CLASSIC_THEME_KEY, name: LEGACY_THEME_NAME }, data: { name: CLASSIC_THEME_NAME } });
    }
    if (!marked) await tx.systemState.update({ where: { id: 1 }, data: { seedMarks: { push: NOVA_SEED_MARK } } });
  }

  private static async createBuiltIn(tx: Prisma.TransactionClient, key: string, name: string, settings: GcsThemeSettings, isDefault: boolean): Promise<void> {
    const theme = await tx.theme.create({ data: { key, name, isDefault, settings: settings as unknown as Prisma.InputJsonValue } });
    await GcsThemeCssService.seed(tx, theme.id, "", { authorId: null, authorName: "" });
  }
}

/** Tema Nova inclusă (designul `nova`) și tema clasică (aspectul de până acum, cheia veche a temei implicite). */
export const NOVA_THEME_KEY = "nova";
export const NOVA_THEME_NAME = "GCS Nova";
export const CLASSIC_THEME_KEY = "default";
export const CLASSIC_THEME_NAME = "Clasic";
/** Numele vechii teme implicite (redenumită „Clasic” la actualizare, dacă adminul nu i-a dat alt nume). */
const LEGACY_THEME_NAME = "Default";
/** Marcajul actualizării care aduce Nova pe instalările existente (`system_state.seedMarks`). */
export const NOVA_SEED_MARK = "theme:nova";
