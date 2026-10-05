import "server-only";
import {
  GcsAcpDashboardService,
  GcsAcpRoleService,
  GcsAcpSearch,
  GcsActorResolver,
  GcsBanService,
  GcsCache,
  GcsEventBus,
  GcsGroupService,
  GcsMemberDirectory,
  GcsModuleRegistry,
  GcsPermissionService,
  GcsRedisRateLimiter,
  GcsSettingsService,
  GcsWarningService,
} from "@gcs/core";
import { PrismaClient } from "@gcs/db";
import { readFileSync } from "node:fs";
import path from "node:path";
import { coreModule, forumsModule } from "@gcs/modules";
import Redis from "ioredis";
import { revalidateTag } from "next/cache";
import { gcsConfigDir } from "./config";

export type GcsServices = {
  db: PrismaClient;
  redis: Redis;
  cache: GcsCache;
  bus: GcsEventBus;
  registry: GcsModuleRegistry;
  settings: GcsSettingsService;
  permissions: GcsPermissionService;
  acp: GcsAcpRoleService;
  acpDashboard: GcsAcpDashboardService;
  acpSearch: GcsAcpSearch;
  groups: GcsGroupService;
  members: GcsMemberDirectory;
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

/**
 * Variabilele scrise de installer în `.env.runtime` (ex. `DATABASE_URL` pentru o bază externă aleasă în wizard)
 * au prioritate față de mediul containerului.
 */
function loadRuntimeEnv(): void {
  let content: string;
  try {
    content = readFileSync(path.join(gcsConfigDir(), ".env.runtime"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = /^(DATABASE_URL|GCS_SECRET)=(.*)$/.exec(line);
    if (m) process.env[m[1]!] = m[2]!.startsWith('"') ? (JSON.parse(m[2]!) as string) : m[2]!;
  }
}

function createServices(): GcsServices {
  loadRuntimeEnv();
  const databaseUrl = process.env.DATABASE_URL;
  const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 2 });
  // Erorile de conexiune sunt raportate de /api/health; nu trebuie să oprească procesul.
  redis.on("error", () => {});

  const registry = new GcsModuleRegistry();
  registry.register(coreModule);
  registry.register(forumsModule);
  // Permisiunea de test folosită de E2E (ruta /_test/container/…); există doar cu GCS_TEST_ROUTES=1.
  if (process.env.GCS_TEST_ROUTES === "1") {
    registry.register({
      key: "e2e",
      settings: [],
      acpMenu: [],
      eventListeners: [],
      permissions: [
        { key: "core.test_view", scope: "container", containerType: "test", labelKey: "permissions.core.test_view", default: {} },
      ],
    });
  }

  const cache = new GcsCache(redis);
  const bus = new GcsEventBus({ cache, revalidate });
  for (const m of registry.all()) {
    for (const listener of m.eventListeners) bus.on(listener.event, listener.handler);
  }

  const settings = new GcsSettingsService({ db, cache, bus, registry });
  const permissions = new GcsPermissionService({ db, cache, bus, registry });
  const acp = new GcsAcpRoleService({ db, registry });
  const acpDashboard = new GcsAcpDashboardService({ db, acp });
  const acpSearch = new GcsAcpSearch({ db, registry, acp });
  const groups = new GcsGroupService({ db, bus, permissions, acp });
  const members = new GcsMemberDirectory({ db });
  const bans = new GcsBanService({ db, cache, bus, acp });
  const warnings = new GcsWarningService({ db, bus, acp, bans });
  const actors = new GcsActorResolver({ db, cache });
  const rateLimiter = new GcsRedisRateLimiter(redis);

  return { db, redis, cache, bus, registry, settings, permissions, acp, acpDashboard, acpSearch, groups, members, bans, warnings, actors, rateLimiter };
}

// Un singur set de servicii pe proces (în dev, Next.js reîncarcă modulele).
const globalForServices = globalThis as unknown as { gcsServices?: GcsServices };

export function services(): GcsServices {
  globalForServices.gcsServices ??= createServices();
  return globalForServices.gcsServices;
}

/**
 * Recreează serviciile la următorul apel (ex. după instalare, când baza de date s-a schimbat).
 * Instanța Better Auth, care le folosește, se recreează și ea.
 */
export async function resetServices(): Promise<void> {
  const current = globalForServices.gcsServices;
  globalForServices.gcsServices = undefined;
  (globalThis as unknown as { gcsAuth?: unknown }).gcsAuth = undefined;
  if (current) {
    await current.db.$disconnect().catch(() => {});
    current.redis.disconnect();
  }
}
