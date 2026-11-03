import { writeAudit, type GcsAcpRoleService, type GcsActor, type GcsCache, type GcsKv } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";

/** Secțiunea ACP (ACP › Sistem › Cache): `view` = zonele, `edit` = golirea. */
export const CACHE_ACP_SECTION = "system.cache";

const KEY_PREFIX = "gcs:k:";
const TAG_PREFIX = "gcs:tag:";

/** O zonă a cache-ului: primul segment al cheii (`profile`, `settings`, `forums`…), cu numărul de chei. */
export type GcsCacheArea = { area: string; keys: number };

export type GcsCacheOverview = { driver: "redis" | "sql"; keys: number; tags: string[]; areas: GcsCacheArea[] };

/** Zona unei chei: textul de dinainte de primul `:` (sau toată cheia). */
export function cacheArea(key: string): string {
  const rest = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
  const i = rest.indexOf(":");
  return i > 0 ? rest.slice(0, i) : rest;
}

const AREA_RE = /^[a-z0-9_.-]{1,60}$/i;

/**
 * Cache-ul paginilor (`GcsCache`: Redis în VPS, tabela `gcs_kv` în Lite), văzut din ACP: câte chei are fiecare zonă și
 * golirea unei zone, a unui tag sau a tot cache-ului. Golirea doar obligă paginile să recitească din baza de date; nu
 * se pierde nimic. Fiecare golire intră în jurnalul ACP.
 */
export class GcsCacheAdminService {
  constructor(private readonly deps: { db: PrismaClient; kv: GcsKv; cache: GcsCache; acp: Pick<GcsAcpRoleService, "assert"> }) {}

  async overview(driver: "redis" | "sql"): Promise<GcsCacheOverview> {
    const [keys, tagKeys] = await Promise.all([this.deps.kv.keys(KEY_PREFIX), this.deps.kv.keys(TAG_PREFIX)]);
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(cacheArea(k), (counts.get(cacheArea(k)) ?? 0) + 1);
    return {
      driver,
      keys: keys.length,
      tags: tagKeys.map((k) => k.slice(TAG_PREFIX.length)).sort(),
      areas: [...counts].map(([area, n]) => ({ area, keys: n })).sort((a, b) => b.keys - a.keys || a.area.localeCompare(b.area)),
    };
  }

  private async audit(actor: GcsActor, targetId: string, removed: number): Promise<void> {
    await writeAudit(this.deps.db, { actorId: actor.userId ?? null, action: "system.cache_clear", targetType: "cache", targetId, after: { removed }, ip: actor.ip });
  }

  /** Golește o zonă (cheile `gcs:k:<zonă>` și `gcs:k:<zonă>:…`). Întoarce câte chei a șters. */
  async clearArea(actor: GcsActor, area: string): Promise<number> {
    await this.deps.acp.assert(actor, CACHE_ACP_SECTION, "edit");
    if (!AREA_RE.test(area)) throw new Error("invalid_area");
    const removed = (await this.deps.kv.del(`${KEY_PREFIX}${area}`)) + (await this.deps.kv.delPrefix(`${KEY_PREFIX}${area}:`));
    await this.audit(actor, area, removed);
    return removed;
  }

  /** Invalidează un tag (toate cheile legate de el, ca după o editare). */
  async clearTag(actor: GcsActor, tag: string): Promise<void> {
    await this.deps.acp.assert(actor, CACHE_ACP_SECTION, "edit");
    if (!AREA_RE.test(tag)) throw new Error("invalid_area");
    await this.deps.cache.invalidateTags([tag]);
    await this.audit(actor, `tag:${tag}`, 0);
  }

  /** Ultimele goliri (din jurnalul ACP): cine, când, ce zonă și câte chei. */
  async recentClears(limit = 8): Promise<{ at: Date; target: string; removed: number; actor: GcsUserRef | null }[]> {
    const { db } = this.deps;
    const rows = await db.auditLog.findMany({ where: { action: "system.cache_clear" }, orderBy: { createdAt: "desc" }, take: limit });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
    const users = ids.length > 0 ? await db.user.findMany({ where: { id: { in: ids } }, select: userRefSelect }) : [];
    const refs = new Map(users.map((u) => [u.id, toRef(u)] as const));
    return rows.map((r) => {
      const after = r.after as { removed?: unknown } | null;
      return { at: r.createdAt, target: r.targetId, removed: typeof after?.removed === "number" ? after.removed : 0, actor: r.actorId ? (refs.get(r.actorId) ?? null) : null };
    });
  }

  /** Golește tot cache-ul paginilor. Întoarce câte chei erau. */
  async clearAll(actor: GcsActor): Promise<number> {
    await this.deps.acp.assert(actor, CACHE_ACP_SECTION, "edit");
    const before = (await this.deps.kv.keys(KEY_PREFIX)).length;
    await this.deps.cache.clear();
    await this.audit(actor, "*", before);
    return before;
  }
}
