import type { GcsCache, GcsEventBus, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import { GcsImportMap } from "./engine/map";
import { matchLegacyPath, normalizePrefix, stripLegacyPrefix, type GcsLegacyTarget } from "./legacyUrls";
import type { GcsImportSchema } from "./types";

/** O regulă de redirect: harta unui import, schema sursei, prefixul căii vechi și postările pe pagină vechi. */
export type GcsRedirectRule = { mapKey: string; schema: GcsImportSchema; prefix: string; postsPerPage: number };
export type GcsRedirectConfig = { enabled: boolean; rules: GcsRedirectRule[] };

/** Cheia internă (în `settings`, fără definiție în ACP), citită de `proxy.ts` prin cache. */
export const IMPORT_REDIRECTS_SETTING = "import.redirects";
const CACHE_KEY = "import:redirects";
const CACHE_TAG = "import-redirects";

/**
 * Redirecturile 301 de la adresele site-ului vechi (specul importului, §8). Recunoașterea e pură (`matchLegacyPath`);
 * rezolvarea folosește harta id vechi → id nou și adresa GCS a entității.
 */
export class GcsLegacyRedirects {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; bus: GcsEventBus; settings: GcsSettingsService }) {}

  async config(): Promise<GcsRedirectConfig> {
    const cached = await this.deps.cache.get<GcsRedirectConfig>(CACHE_KEY);
    if (cached) return cached;
    const row = await this.deps.db.setting.findUnique({ where: { key: IMPORT_REDIRECTS_SETTING } });
    const value = (row?.value ?? null) as GcsRedirectConfig | null;
    const config: GcsRedirectConfig = value && Array.isArray(value.rules) ? { enabled: value.enabled === true, rules: value.rules } : { enabled: false, rules: [] };
    await this.deps.cache.set(CACHE_KEY, config, { ttlSec: 3600, tags: [CACHE_TAG] });
    return config;
  }

  async save(config: GcsRedirectConfig): Promise<void> {
    const value = { enabled: config.enabled, rules: config.rules.map((r) => ({ ...r, prefix: normalizePrefix(r.prefix) })) };
    await this.deps.db.setting.upsert({ where: { key: IMPORT_REDIRECTS_SETTING }, create: { key: IMPORT_REDIRECTS_SETTING, value }, update: { value } });
    await this.deps.bus.emit({ name: "settings.updated", payload: { key: IMPORT_REDIRECTS_SETTING }, tags: [CACHE_TAG] });
  }

  /** Adresa GCS pentru o adresă veche (cale + query string), sau `null` (nu e veche, nu e importată, e deja a GCS). */
  async resolve(pathname: string, search: string): Promise<string | null> {
    const config = await this.config();
    if (!config.enabled) return null;
    for (const rule of config.rules) {
      const rel = stripLegacyPrefix(pathname, rule.prefix);
      if (rel === null) continue;
      const target = matchLegacyPath(rule.schema, rel, search);
      if (!target) continue;
      const url = await this.target(rule, target);
      if (url) return url;
    }
    return null;
  }

  private async target(rule: GcsRedirectRule, target: GcsLegacyTarget): Promise<string | null> {
    const { db } = this.deps;
    const map = new GcsImportMap(db, rule.mapKey);
    // Fără prefix, `/topic/12-x` și `/forum/5-x` (schema core) arată ca adresele GCS: dacă id-ul GCS există cu
    // același slug, adresa e deja una nouă și nu se redirecționează.
    const collides = rule.schema === "core-schema" && rule.prefix === "" && (target.kind === "topic" || target.kind === "forum");
    switch (target.kind) {
      case "topic": {
        if (collides && (await this.isNative("topic", target))) return null;
        const id = Number(await map.one("topic", target.id));
        const topic = Number.isInteger(id) ? await db.topic.findUnique({ where: { id }, select: { id: true, slug: true } }) : null;
        if (!topic) return null;
        const base = `/topic/${topic.id}-${topic.slug}`;
        if (!target.page || target.page <= 1) return base;
        // Pagina veche → prima postare de pe ea → pagina GCS (alt număr de postări pe pagină).
        const perPage = await this.deps.settings.get<number>("forums.posts_per_page");
        const page = Math.floor(((target.page - 1) * rule.postsPerPage) / perPage) + 1;
        return page > 1 ? `${base}?page=${page}` : base;
      }
      case "forum": {
        if (collides && (await this.isNative("forum", target))) return null;
        const id = Number(await map.one("forum", target.id));
        const forum = Number.isInteger(id) ? await db.forum.findUnique({ where: { id }, select: { id: true, slug: true } }) : null;
        return forum ? `/forum/${forum.id}-${forum.slug}` : null;
      }
      case "member": {
        const id = await map.one("member", target.id);
        const user = id ? await db.user.findUnique({ where: { id }, select: { id: true, name: true } }) : null;
        return user ? `/members/${user.id}-${slugify(user.name)}` : null;
      }
      case "post": {
        const id = Number(await map.one("post", target.id));
        const post = Number.isInteger(id) ? await db.post.findUnique({ where: { id }, select: { id: true, topicId: true } }) : null;
        return post ? `/topic/${post.topicId}/post/${post.id}` : null;
      }
    }
  }

  /** O adresă cu forma GCS a unui topic sau forum care există cu același slug (sau fără slug). */
  private async isNative(kind: "topic" | "forum", target: GcsLegacyTarget): Promise<boolean> {
    const id = Number(target.id);
    const row =
      kind === "topic"
        ? await this.deps.db.topic.findUnique({ where: { id }, select: { slug: true } })
        : await this.deps.db.forum.findUnique({ where: { id }, select: { slug: true } });
    return row !== null && (!target.slug || target.slug === row.slug);
  }
}

/** Calea veche a unui topic, după schema sursei (pentru eșantionul din ACP). */
export function legacyTopicPath(rule: Pick<GcsRedirectRule, "schema" | "prefix">, sourceId: string, title: string): string {
  const slug = slugify(title);
  const path = rule.schema === "core-schema" ? `/topic/${sourceId}-${slug}/` : `/threads/${slug}.${sourceId}/`;
  return `${normalizePrefix(rule.prefix)}${path}`;
}
