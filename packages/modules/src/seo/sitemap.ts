import type { GcsActor, GcsAppService, GcsCache, GcsPermissionService, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { communityRules, RULES_HREF } from "../community/rules";
import { normalizePrivacy } from "../profile/privacy";
import { legalDoc } from "../security/legal";
import { LEGAL_DOCS } from "../security/settings";
import { slugify } from "../forums/slug";
import { SEO_SETTINGS, SITEMAP_TYPES, sitemapTypeSetting, type GcsSitemapType } from "./settings";

/** Câte adrese are un fișier al sitemap-ului (protocolul permite 50 000; mai puține = interogări și răspunsuri mai mici). */
export const SITEMAP_CHUNK = 10_000;
/** Cât timp se păstrează un fișier generat (secunde); o setare, o permisiune sau un topic nou îl invalidează. */
export const SITEMAP_CACHE_TTL = 900;
const CACHE_TAGS = ["sitemap", "settings", "permissions", "forums-tree"];

export type GcsSitemapEntry = { path: string; lastModified?: Date | null };
export type GcsSitemapChunk = { type: GcsSitemapType; page: number };

/** Numele unui fișier al sitemap-ului (`topics-2.xml`) și invers. */
export const sitemapChunkName = (c: GcsSitemapChunk) => `${c.type}-${c.page}.xml`;
export function parseSitemapChunk(name: string): GcsSitemapChunk | null {
  const m = /^([a-z]+)-([1-9]\d{0,4})\.xml$/.exec(name);
  if (!m || !(SITEMAP_TYPES as readonly string[]).includes(m[1]!)) return null;
  return { type: m[1] as GcsSitemapType, page: Number(m[2]) };
}

/** Câte fișiere are un tip: adresele (cel mult `max`) împărțite în bucăți de `chunk`. */
export const sitemapChunkCount = (total: number, max: number, chunk = SITEMAP_CHUNK) => (total <= 0 || max <= 0 ? 0 : Math.ceil(Math.min(total, max) / chunk));

/** Fereastra unei bucăți (1, 2, …) în lista tipului, cu limita `max`; `null` dacă bucata e dincolo de limită. */
export function sitemapWindow(page: number, max: number, chunk = SITEMAP_CHUNK): { skip: number; take: number } | null {
  const skip = (page - 1) * chunk;
  if (page < 1 || skip >= max) return null;
  return { skip, take: Math.min(chunk, max - skip) };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Indexul sitemap-urilor (`/sitemap.xml`): un `<sitemap>` pe fișier. */
export function sitemapIndexXml(base: string, names: string[]): string {
  const items = names.map((n) => `<sitemap><loc>${xml(`${base}/sitemap/${n}`)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>\n`;
}

/** Un fișier al sitemap-ului: adresele absolute, cu data ultimei modificări a conținutului. */
export function sitemapUrlsetXml(base: string, entries: GcsSitemapEntry[]): string {
  const items = entries
    .map((e) => `<url><loc>${xml(`${base}${e.path}`)}</loc>${e.lastModified ? `<lastmod>${e.lastModified.toISOString()}</lastmod>` : ""}</url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>\n`;
}

type Deps = {
  db: PrismaClient;
  settings: Pick<GcsSettingsService, "get">;
  permissions: Pick<GcsPermissionService, "can" | "filterContainers">;
  apps: Pick<GcsAppService, "canAccess" | "landingFor">;
  cache?: GcsCache;
  /** Vizitatorul (grupul `guest`): ce văd motoarele de căutare. */
  guest: () => Promise<GcsActor>;
  /** Clanurile se văd (aplicația pornită + `clans.view`). */
  clansVisible?: (actor: GcsActor) => Promise<boolean>;
  /** Id-urile serverelor vizibile (aplicația pornită + `servers.view` + grupurile serverului). */
  serverIds?: (actor: GcsActor) => Promise<number[]>;
  /** Paginile aplicației Pagini (și înregistrările bazelor publice), cu aplicația pornită. */
  appPages?: (actor: GcsActor) => Promise<GcsSitemapEntry[]>;
  /** Mărimea unei bucăți (testele folosesc bucăți mici); implicit `SITEMAP_CHUNK`. */
  chunk?: number;
};

type OpenForum = { id: number; slug: string; lastPostAt: Date | null; ownTopicsOnly: boolean };

/**
 * Sitemap-ul (ACP → Promovare → SEO): un index cu fișiere pe tip de conținut (`pages`, `forums`, `topics`, `members`,
 * `clans`, `servers`), fiecare de cel mult `SITEMAP_CHUNK` adrese și cel mult `seo.sitemap_max_urls` pe tip. Doar ce vede
 * un vizitator: forumurile citibile de grupul `guest` (fără parolă), topicurile vizibile din ele (fără forumurile „doar
 * topicurile mele”), profilurile publice cu postări (dacă profilurile se indexează), clanurile aprobate și serverele
 * vizibile. Fișierele generate stau `SITEMAP_CACHE_TTL` secunde în cache.
 */
export class GcsSitemapService {
  constructor(private readonly deps: Deps) {}

  private get chunkSize(): number {
    return this.deps.chunk ?? SITEMAP_CHUNK;
  }

  async enabled(): Promise<boolean> {
    return (await this.deps.settings.get<boolean>(SEO_SETTINGS.sitemapEnabled).catch(() => true)) !== false;
  }

  private async maxUrls(): Promise<number> {
    const v = await this.deps.settings.get<number>(SEO_SETTINGS.sitemapMaxUrls).catch(() => 50_000);
    return Number.isInteger(v) && v > 0 ? v : 50_000;
  }

  /** Tipurile pornite în ACP (profilurile cer și `seo.index_profiles`). */
  async types(): Promise<GcsSitemapType[]> {
    const { settings } = this.deps;
    const on = await Promise.all(SITEMAP_TYPES.map(async (t) => (await settings.get<boolean>(sitemapTypeSetting(t)).catch(() => true)) !== false));
    const profiles = (await settings.get<boolean>(SEO_SETTINGS.indexProfiles).catch(() => true)) !== false;
    return SITEMAP_TYPES.filter((t, i) => on[i] && (t !== "members" || profiles));
  }

  /** Forumurile pe care un vizitator le poate citi, fără parolă (nodurile „Link” nu au pagină). */
  async openForums(guest: GcsActor): Promise<OpenForum[]> {
    const forums = await this.deps.db.forum.findMany({
      where: { type: { not: "LINK" }, passwordHash: null },
      orderBy: { id: "asc" },
      select: { id: true, slug: true, lastPostAt: true, ownTopicsOnly: true },
    });
    const readable = await this.deps.permissions.filterContainers(guest, "forums.read", forums.map((f) => ({ type: "forum", id: String(f.id) })));
    return forums.filter((f) => readable.has(String(f.id)));
  }

  /** Forumurile ale căror topicuri le vede oricine (fără „doar topicurile mele”). */
  private async topicForumIds(guest: GcsActor): Promise<number[]> {
    return (await this.openForums(guest)).filter((f) => !f.ownTopicsOnly).map((f) => f.id);
  }

  private async profilesVisible(guest: GcsActor): Promise<boolean> {
    return this.deps.permissions.can(guest, "core.view_public");
  }

  private membersWhere() {
    return { postsCount: { gt: 0 }, primaryGroup: { key: { notIn: ["banned", "guest"] } } };
  }

  private async clansOn(guest: GcsActor): Promise<boolean> {
    return (await this.deps.apps.canAccess(guest, "clans")) && (this.deps.clansVisible ? await this.deps.clansVisible(guest) : true);
  }

  private async serverIdsFor(guest: GcsActor): Promise<number[]> {
    if (!this.deps.serverIds || !(await this.deps.apps.canAccess(guest, "servers"))) return [];
    return this.deps.serverIds(guest);
  }

  /** Paginile publice: principala, indexul forumului (când pornirea e altă aplicație), regulile, termenii, listele. */
  private async pages(guest: GcsActor): Promise<GcsSitemapEntry[]> {
    const { settings, apps } = this.deps;
    const out: GcsSitemapEntry[] = [{ path: "/" }];
    if (await apps.landingFor(guest)) out.push({ path: "/forum" });
    const rules = await communityRules(settings).catch(() => null);
    if (rules) out.push({ path: RULES_HREF, lastModified: new Date(rules.updatedAt) });
    for (const kind of LEGAL_DOCS) {
      const doc = await legalDoc(settings, kind).catch(() => null);
      if (doc?.mode === "page") out.push({ path: doc.href, lastModified: new Date(doc.doc.updatedAt) });
    }
    if (await this.clansOn(guest)) out.push({ path: "/clans" });
    if ((await this.serverIdsFor(guest)).length > 0) out.push({ path: "/servers" });
    if (this.deps.appPages && (await this.deps.apps.canAccess(guest, "pages"))) out.push(...(await this.deps.appPages(guest)));
    return out.map((e) => (e.lastModified && Number.isNaN(e.lastModified.getTime()) ? { path: e.path } : e));
  }

  /** Câte adrese are fiecare tip (pentru index), fără limită. */
  private async count(type: GcsSitemapType, guest: GcsActor): Promise<number> {
    const { db } = this.deps;
    switch (type) {
      case "pages":
        return (await this.pages(guest)).length;
      case "forums":
        return (await this.openForums(guest)).length;
      case "topics": {
        const ids = await this.topicForumIds(guest);
        return ids.length === 0 ? 0 : db.topic.count({ where: { visibility: "VISIBLE", forumId: { in: ids } } });
      }
      case "members":
        return (await this.profilesVisible(guest)) ? db.user.count({ where: this.membersWhere() }) : 0;
      case "clans":
        return (await this.clansOn(guest)) ? db.clan.count({ where: { status: { not: "PENDING" } } }) : 0;
      case "servers":
        return (await this.serverIdsFor(guest)).length;
    }
  }

  /** Numele fișierelor din index (gol dacă sitemap-ul e oprit sau nu e nimic public). */
  async chunks(): Promise<string[]> {
    if (!(await this.enabled())) return [];
    const guest = await this.deps.guest();
    const max = await this.maxUrls();
    const names: string[] = [];
    for (const type of await this.types()) {
      const n = sitemapChunkCount(await this.count(type, guest), max, this.chunkSize);
      for (let page = 1; page <= n; page++) names.push(sitemapChunkName({ type, page }));
    }
    return names;
  }

  /** Adresele unui fișier (relative la site), sau `null` dacă fișierul nu există (tip oprit, bucată dincolo de limită). */
  async entries(chunk: GcsSitemapChunk): Promise<GcsSitemapEntry[] | null> {
    if (!(await this.enabled()) || !(await this.types()).includes(chunk.type)) return null;
    const window = sitemapWindow(chunk.page, await this.maxUrls(), this.chunkSize);
    if (!window) return null;
    const { db } = this.deps;
    const guest = await this.deps.guest();
    const slice = <T>(list: T[]) => list.slice(window.skip, window.skip + window.take);
    let out: GcsSitemapEntry[];
    switch (chunk.type) {
      case "pages":
        out = slice(await this.pages(guest));
        break;
      case "forums":
        out = slice(await this.openForums(guest)).map((f) => ({ path: `/forum/${f.id}-${f.slug}`, lastModified: f.lastPostAt }));
        break;
      case "topics": {
        const ids = await this.topicForumIds(guest);
        const rows = ids.length === 0 ? [] : await db.topic.findMany({ where: { visibility: "VISIBLE", forumId: { in: ids } }, orderBy: { id: "desc" }, ...window, select: { id: true, slug: true, lastPostAt: true } });
        out = rows.map((t) => ({ path: `/topic/${t.id}-${t.slug}`, lastModified: t.lastPostAt }));
        break;
      }
      case "members": {
        if (!(await this.profilesVisible(guest))) return [];
        const rows = await db.user.findMany({ where: this.membersWhere(), orderBy: { id: "asc" }, ...window, select: { id: true, name: true, privacy: true, updatedAt: true } });
        // Doar profilurile publice (confidențialitatea e JSON: se filtrează aici, pe aceeași fereastră).
        out = rows.filter((u) => normalizePrivacy(u.privacy).profile === "PUBLIC").map((u) => ({ path: `/members/${u.id}-${slugify(u.name)}`, lastModified: u.updatedAt }));
        break;
      }
      case "clans": {
        if (!(await this.clansOn(guest))) return [];
        const rows = await db.clan.findMany({ where: { status: { not: "PENDING" } }, orderBy: { id: "asc" }, ...window, select: { id: true, slug: true, updatedAt: true } });
        out = rows.map((c) => ({ path: `/clans/${c.id}-${c.slug}`, lastModified: c.updatedAt }));
        break;
      }
      case "servers": {
        const ids = slice(await this.serverIdsFor(guest));
        const rows = ids.length === 0 ? [] : await db.gameServer.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, slug: true } });
        out = rows.map((s) => ({ path: `/servers/${s.id}-${s.slug}` }));
        break;
      }
    }
    // O bucată de după ultima adresă nu există (prima, chiar goală, rămâne un fișier valid).
    return out.length === 0 && chunk.page > 1 ? null : out;
  }

  private async cached(key: string, build: () => Promise<string | null>): Promise<string | null> {
    const { cache } = this.deps;
    const hit = cache ? await cache.get<{ v: string | null }>(key).catch(() => null) : null;
    if (hit) return hit.v;
    const v = await build();
    await cache?.set(key, { v }, { ttlSec: SITEMAP_CACHE_TTL, tags: CACHE_TAGS }).catch(() => {});
    return v;
  }

  /** `/sitemap.xml` (indexul); `null` dacă sitemap-ul e oprit. */
  indexXml(base: string): Promise<string | null> {
    return this.cached(`sitemap:index:${base}`, async () => ((await this.enabled()) ? sitemapIndexXml(base, await this.chunks()) : null));
  }

  /** `/sitemap/<tip>-<n>.xml`; `null` = 404. */
  chunkXml(base: string, name: string): Promise<string | null> {
    const chunk = parseSitemapChunk(name);
    if (!chunk) return Promise.resolve(null);
    return this.cached(`sitemap:${name}:${base}`, async () => {
      const entries = await this.entries(chunk);
      return entries ? sitemapUrlsetXml(base, entries) : null;
    });
  }

  /**
   * Topicurile publice cu activitate după `since` (create sau cu răspunsuri noi), cele mai vechi primele, cel mult
   * `limit`: lista trimisă la IndexNow.
   */
  async changedTopics(since: Date, limit: number): Promise<{ path: string; at: Date }[]> {
    const ids = await this.topicForumIds(await this.deps.guest());
    if (ids.length === 0) return [];
    const rows = await this.deps.db.topic.findMany({
      where: { visibility: "VISIBLE", forumId: { in: ids }, lastPostAt: { gt: since } },
      orderBy: [{ lastPostAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, slug: true, lastPostAt: true },
    });
    return rows.map((t) => ({ path: `/topic/${t.id}-${t.slug}`, at: t.lastPostAt }));
  }
}
