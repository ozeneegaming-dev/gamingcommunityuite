import { Prisma, type PrismaClient, type Theme } from "@gcs/db";
import type { GcsAcpRoleService } from "../acp/roles";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsConflict, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsActor } from "../permissions/types";
import { compileThemeCss, sanitizeThemeCss } from "./css";
import {
  DEFAULT_THEME_SETTINGS,
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
  customCss: string;
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

function toView(t: Theme): GcsThemeView {
  return {
    key: t.key,
    name: t.name,
    isDefault: t.isDefault,
    enabled: t.enabled,
    settings: normalizeThemeSettings(t.settings),
    customCss: t.customCss,
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
    if (cached) return cached.map((v) => ({ ...v, settings: normalizeThemeSettings(v.settings) }));
    const rows = await this.deps.db.theme.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
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
        customCss: "",
        logoUrl: null,
        faviconUrl: null,
        version: 0,
        draft: null,
      }
    );
  }

  /** CSS-ul publicat al temei (sau al draft-ului, pentru previzualizarea adminului). */
  css(theme: GcsThemeView, opts: { draft?: boolean } = {}): string {
    if (opts.draft && theme.draft) {
      const merged = this.merge(theme, theme.draft);
      return compileThemeCss(merged.settings, merged.customCss);
    }
    return compileThemeCss(theme.settings, theme.customCss);
  }

  /** Tema cu draft-ul aplicat (ce vede adminul în previzualizare); fără draft, tema publicată. */
  withDraft(theme: GcsThemeView): GcsThemeView {
    return theme.draft ? { ...theme, ...this.merge(theme, theme.draft) } : theme;
  }

  private merge(theme: GcsThemeView, draft: GcsThemeDraft) {
    const settings = normalizeThemeSettings(mergeThemeObjects(theme.settings, draftSettings(draft)));
    return {
      settings,
      customCss: draft.customCss !== undefined ? sanitizeThemeCss(draft.customCss) : theme.customCss,
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

  /** Mută draft-ul în temă și crește versiunea (cu jurnal). */
  async publish(actor: GcsActor, key: string): Promise<GcsThemeView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    const row = await db.theme.findUnique({ where: { key } });
    if (!row) throw new GcsNotFound();
    const theme = toView(row);
    if (!theme.draft) throw new GcsConflict({ reason: "no_draft" });
    const merged = this.merge(theme, theme.draft);
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.theme.update({
        where: { key },
        data: {
          settings: merged.settings as unknown as Prisma.InputJsonValue,
          customCss: merged.customCss,
          logoUrl: merged.logoUrl,
          faviconUrl: merged.faviconUrl,
          draft: Prisma.DbNull,
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "theme.publish",
        targetType: "theme",
        targetId: key,
        before: { settings: theme.settings, customCss: theme.customCss, logoUrl: theme.logoUrl, faviconUrl: theme.faviconUrl },
        after: merged,
        ip: actor.ip,
      });
      return u;
    });
    await this.changed();
    return toView(updated);
  }

  async create(actor: GcsActor, input: { key: string; name: string; from?: string }): Promise<GcsThemeView> {
    const { db, acp } = this.deps;
    await acp.assert(actor, THEMES_ACP_SECTION, "edit");
    if (!KEY_RE.test(input.key)) throw new GcsValidationError({ key: "invalid_key" });
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) throw new GcsValidationError({ name: "invalid_length" });
    if (await db.theme.findUnique({ where: { key: input.key } })) throw new GcsValidationError({ key: "taken" });
    const source = input.from ? await db.theme.findUnique({ where: { key: input.from } }) : null;
    const row = await db.$transaction(async (tx) => {
      const r = await tx.theme.create({
        data: {
          key: input.key,
          name,
          settings: (source?.settings ?? DEFAULT_THEME_SETTINGS) as unknown as Prisma.InputJsonValue,
          customCss: source?.customCss ?? "",
          logoUrl: source?.logoUrl ?? null,
          faviconUrl: source?.faviconUrl ?? null,
        },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "theme.create", targetType: "theme", targetId: input.key, after: { name, from: input.from ?? null }, ip: actor.ip });
      return r;
    });
    await this.changed();
    return toView(row);
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

  /** Tema implicită, dacă nu există încă nicio temă (seed; idempotent). */
  static async seedDefault(tx: Prisma.TransactionClient): Promise<void> {
    if ((await tx.theme.count()) > 0) return;
    await tx.theme.create({ data: { key: "default", name: "Default", isDefault: true, settings: DEFAULT_THEME_SETTINGS as unknown as Prisma.InputJsonValue } });
  }
}
