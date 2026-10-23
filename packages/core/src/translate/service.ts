import { createHash } from "node:crypto";
import type { PrismaClient } from "@gcs/db";
import type { GcsRateLimiter } from "../auth/rateLimit";
import type { GcsCache } from "../cache";
import { sanitizeContentHtml } from "../content/renderer";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../errors";
import type { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import type { GcsSettingsService } from "../settings/service";
import { GcsDeepLProvider, GcsLibreTranslateProvider, type GcsTranslateProvider } from "./providers";

export const TRANSLATE_LOCALES = ["ro", "en", "de", "es", "fr", "ru"] as const;
const RATE = { window: 60, max: 30 };
const CACHE_TTL = 30 * 86_400;
const MAX_CHARS = 20_000;

/** Ce știe un modul despre conținutul lui: cine îl vede și HTML-ul lui (deja sanitizat). */
export type GcsTranslatableContent = {
  canView: (actor: GcsActor, id: string) => Promise<boolean>;
  html: (id: string) => Promise<string | null>;
};

/**
 * Butonul „Traduce” (specul etapei 5 §5): traduce HTML-ul unui conținut în limba cerută, prin providerul ales în ACP
 * (LibreTranslate propriu sau DeepL). Verifică accesul la conținut, are limită de cereri și cache (Redis + bază), iar
 * rezultatul e re-sanitizat cu regulile renderer-ului.
 */
export class GcsTranslationService {
  private readonly contents = new Map<string, GcsTranslatableContent>();

  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      settings: GcsSettingsService;
      permissions: GcsPermissionService;
      rateLimiter: GcsRateLimiter;
      /** Doar pentru teste: providerul, în locul celui din setări. */
      provider?: GcsTranslateProvider | null;
    },
  ) {}

  registerContent(type: string, content: GcsTranslatableContent): void {
    this.contents.set(type, content);
  }

  /** Providerul din setări; `null` dacă traducerea e oprită sau neconfigurată. */
  async provider(): Promise<GcsTranslateProvider | null> {
    if (this.deps.provider !== undefined) return this.deps.provider;
    const { settings } = this.deps;
    const kind = await settings.get<string>("i18n.translate_provider");
    if (kind === "deepl") {
      const key = await settings.get<string>("i18n.deepl_key");
      return key ? new GcsDeepLProvider(key) : null;
    }
    if (kind === "libretranslate") {
      const url = await settings.get<string>("i18n.libretranslate_url");
      return url ? new GcsLibreTranslateProvider(url) : null;
    }
    return null;
  }

  /** Starea serviciului (ACP → Limbi și traducere): oprit, funcțional (o traducere de probă) sau eroare. */
  async status(): Promise<"off" | "ok" | "error"> {
    const provider = await this.provider();
    if (!provider) return "off";
    try {
      const out = await Promise.race([
        provider.translateHtml("<p>Salut</p>", "en"),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000).unref?.()),
      ]);
      return typeof out === "string" && out.length > 0 ? "ok" : "error";
    } catch {
      return "error";
    }
  }

  /** Dacă actorul vede butonul „Traduce” (provider configurat + permisiunea `core.translate`). */
  async available(actor: GcsActor): Promise<boolean> {
    return (await this.provider()) !== null && (await this.deps.permissions.can(actor, "core.translate"));
  }

  async translate(actor: GcsActor, ref: { contentType: string; contentId: string }, target: string): Promise<{ html: string; cached: boolean }> {
    const { db, cache, permissions, rateLimiter } = this.deps;
    if (!TRANSLATE_LOCALES.includes(target as (typeof TRANSLATE_LOCALES)[number])) throw new GcsValidationError({ target: "invalid" });
    const content = this.contents.get(ref.contentType);
    if (!content) throw new GcsNotFound();
    if (!(await permissions.can(actor, "core.translate"))) throw new GcsForbidden({ permission: "core.translate" });
    const provider = await this.provider();
    if (!provider) throw new GcsForbidden({ reason: "translation_disabled" });
    if (!(await content.canView(actor, ref.contentId))) throw new GcsNotFound();
    const html = await content.html(ref.contentId);
    if (html === null) throw new GcsNotFound();
    if (html.length > MAX_CHARS) throw new GcsValidationError({ content: "too_long" });

    const hash = createHash("sha256").update(`${provider.name}\n${target}\n${html}`).digest("hex");
    const key = `translate:${hash}`;
    const hit = await cache.get<string>(key);
    if (hit !== null) return { html: hit, cached: true };
    const stored = await db.translationCache.findUnique({ where: { hash } });
    if (stored) {
      await cache.set(key, stored.text, { ttlSec: CACHE_TTL, tags: [] });
      return { html: stored.text, cached: true };
    }

    // Limita se aplică doar cererilor care ajung la provider.
    const limit = await rateLimiter.consume(`translate:${actor.userId ?? actor.ip}`, RATE);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    const translated = sanitizeContentHtml(await provider.translateHtml(html, target));
    await db.translationCache.upsert({ where: { hash }, create: { hash, target, text: translated, provider: provider.name }, update: {} });
    await cache.set(key, translated, { ttlSec: CACHE_TTL, tags: [] });
    return { html: translated, cached: false };
  }

  /** Șterge traducerile mai vechi de `days` zile (job zilnic). */
  async cleanup(days = 90, now = new Date()): Promise<number> {
    const { count } = await this.deps.db.translationCache.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - days * 86_400_000) } } });
    return count;
  }
}
