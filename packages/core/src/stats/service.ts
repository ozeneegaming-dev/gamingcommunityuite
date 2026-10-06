import type { PrismaClient } from "@gcs/db";
import type { GcsAppService } from "../apps/service";
import type { GcsCache } from "../cache";
import type { GcsModuleRegistry, GcsStatTile } from "../modules/registry";

const CACHE_TTL = 300;

export type GcsStatTileView = GcsStatTile & { module: string };

/**
 * Plăcile panoului de statistici (specul etapei 5): fiecare modul își dă plăcile (`GcsModule.stats`), cache-uite
 * 5 minute pe modul; plăcile aplicațiilor dezactivate lipsesc (filtrul se aplică la fiecare citire).
 */
export class GcsStatsService {
  constructor(private readonly deps: { db: PrismaClient; cache: GcsCache; registry: GcsModuleRegistry; apps: GcsAppService }) {}

  async tiles(): Promise<GcsStatTileView[]> {
    const { db, cache, registry, apps } = this.deps;
    const enabled = await apps.enabledFilter();
    const out: GcsStatTileView[] = [];
    for (const m of registry.all()) {
      if (!m.stats || !enabled(m.key)) continue;
      const key = `stats:tiles:${m.key}`;
      let tiles = await cache.get<GcsStatTile[]>(key);
      if (!tiles) {
        tiles = await m.stats({ db });
        await cache.set(key, tiles, { ttlSec: CACHE_TTL, tags: ["stats"] });
      }
      out.push(...tiles.map((t) => ({ ...t, module: m.key })));
    }
    return out;
  }
}
