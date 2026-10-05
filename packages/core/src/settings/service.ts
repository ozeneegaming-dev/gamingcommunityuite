import type { Prisma, PrismaClient } from "@gcs/db";
import { AUDIT_REDACTED, writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import { settingValueError, type GcsSettingDef } from "./registry";

const CACHE_TTL_SEC = 3600;
const CACHE_TAG = "settings";

/**
 * Setările site-ului (spec §5, §12.1). Valorile lipsă din baza de date iau valoarea implicită din modul.
 * Cache-ul are tag-ul `settings`, invalidat de evenimentul `settings.updated`.
 */
export class GcsSettingsService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      cache: GcsCache;
      bus: GcsEventBus;
      registry: GcsModuleRegistry;
    },
  ) {}

  private def(key: string): GcsSettingDef {
    const def = this.deps.registry.settingDef(key);
    if (!def) throw new GcsValidationError({ [key]: "unknown_setting" });
    return def;
  }

  async get<T>(key: string): Promise<T> {
    const def = this.def(key);
    const cacheKey = `setting:${key}`;
    // Valoarea e învelită în `{ v }`, ca un `null` salvat să nu se confunde cu lipsa din cache.
    const cached = await this.deps.cache.get<{ v: unknown }>(cacheKey);
    if (cached) return cached.v as T;

    const row = await this.deps.db.setting.findUnique({ where: { key } });
    const value = row ? row.value : def.default;
    await this.deps.cache.set(cacheKey, { v: value }, { ttlSec: CACHE_TTL_SEC, tags: [CACHE_TAG] });
    return value as T;
  }

  /** Toate setările unei secțiuni, cu valorile implicite completate. Secretele nu apar niciodată. */
  async getMany(section: string): Promise<Record<string, unknown>> {
    const cacheKey = `settings:section:${section}`;
    const cached = await this.deps.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const defs = this.deps.registry
      .settingDefs()
      .filter((d) => d.section === section && d.type !== "secret");
    const rows = await this.deps.db.setting.findMany({ where: { key: { in: defs.map((d) => d.key) } } });
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const result: Record<string, unknown> = {};
    for (const d of defs) result[d.key] = stored.has(d.key) ? stored.get(d.key) : d.default;

    await this.deps.cache.set(cacheKey, result, { ttlSec: CACHE_TTL_SEC, tags: [CACHE_TAG] });
    return result;
  }

  async set(key: string, value: unknown, actor: GcsActor): Promise<void> {
    const def = this.def(key);
    const error = settingValueError(def, value);
    if (error) throw new GcsValidationError({ [key]: error });

    const json = value as Prisma.InputJsonValue;
    await this.deps.db.$transaction(async (tx) => {
      const before = await tx.setting.findUnique({ where: { key } });
      await tx.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
      const secret = def.type === "secret";
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "settings.update",
        targetType: "setting",
        targetId: key,
        before: secret ? AUDIT_REDACTED : before ? before.value : def.default,
        after: secret ? AUDIT_REDACTED : value,
        ip: actor.ip,
      });
    });

    await this.deps.bus.emit({ name: "settings.updated", payload: { key }, tags: [CACHE_TAG] });
  }
}
