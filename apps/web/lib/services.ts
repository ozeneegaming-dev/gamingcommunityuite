import "server-only";
import {
  GcsAcpRoleService,
  GcsActorResolver,
  GcsBanService,
  GcsCache,
  GcsEventBus,
  GcsGroupService,
  GcsModuleRegistry,
  GcsPermissionService,
  GcsRedisRateLimiter,
  GcsSettingsService,
  GcsWarningService,
} from "@gcs/core";
import { db } from "@gcs/db";
import { coreModule } from "@gcs/modules";
import Redis from "ioredis";
import { revalidateTag } from "next/cache";

export type GcsServices = {
  db: typeof db;
  redis: Redis;
  cache: GcsCache;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  settings: GcsSettingsService;
  permissions: GcsPermissionService;
  acp: GcsAcpRoleService;
  groups: GcsGroupService;
  bans: GcsBanService;
  warnings: GcsWarningService;
  actors: GcsActorResolver;
  rateLimiter: GcsRedisRateLimiter;
};

/** Revalidează paginile Next.js cache-uite; în afara unui request (ex. scripturi) nu e disponibil. */
function revalidate(tag: string): void {
  try {
    revalidateTag(tag, "max");
  } catch {
    // Apelat în afara contextului Next.js: nu există pagini de revalidat.
  }
}

function createServices(): GcsServices {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 2 });
  // Erorile de conexiune sunt raportate de /api/health; nu trebuie să oprească procesul.
  redis.on("error", () => {});

  const registry = new GcsModuleRegistry();
  registry.register(coreModule);

  const cache = new GcsCache(redis);
  const bus = new GcsEventBus({ cache, revalidate });
  for (const m of registry.all()) {
    for (const listener of m.eventListeners) bus.on(listener.event, listener.handler);
  }

  const settings = new GcsSettingsService({ db, cache, bus, registry });
  const permissions = new GcsPermissionService({ db, cache, bus, registry });
  const acp = new GcsAcpRoleService({ db, registry });
  const groups = new GcsGroupService({ db, bus, permissions, acp });
  const bans = new GcsBanService({ db, cache, bus, acp });
  const warnings = new GcsWarningService({ db, bus, acp, bans });
  const actors = new GcsActorResolver({ db, cache });
  const rateLimiter = new GcsRedisRateLimiter(redis);

  return { db, redis, cache, bus, registry, settings, permissions, acp, groups, bans, warnings, actors, rateLimiter };
}

// Un singur set de servicii pe proces (în dev, Next.js reîncarcă modulele).
const globalForServices = globalThis as unknown as { gcsServices?: GcsServices };

export function services(): GcsServices {
  globalForServices.gcsServices ??= createServices();
  return globalForServices.gcsServices;
}
