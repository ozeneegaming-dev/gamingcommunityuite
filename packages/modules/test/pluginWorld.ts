import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeUsername, seedDefaults, type GcsActor } from "@gcs/core";
import { testDbUrl, truncateAll } from "@gcs/db/test/helpers";
import { generateSigningKey, packPlugin } from "@gcs/plugin-sdk/pack";
import { inject } from "vitest";
import { closeGcsServices, createGcsServices, type GcsServices } from "../src/services";

/** Cheia de semnare a testelor (de încredere prin `GCS_PLUGIN_TRUSTED_KEYS`). */
export const TEST_SIGNING = generateSigningKey();
export const TEST_SIGN = { keyId: "test", privateKey: TEST_SIGNING.privateKeyPem };

/**
 * Serviciile complete (ca în web și worker) pentru testele pluginurilor: bază și Redis de test, folder propriu pentru
 * fișierele pluginurilor, cheia de test de încredere și pragul de dezactivare automată la 2 eșecuri.
 */
export async function createPluginServices(): Promise<{ services: GcsServices; configDir: string }> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "gcs-plugins-"));
  process.env.DATABASE_URL = testDbUrl();
  const redis = new URL(inject("redisUrl"));
  redis.pathname = `/${process.env.VITEST_POOL_ID ?? "1"}`;
  process.env.REDIS_URL = redis.toString();
  process.env.GCS_PLUGIN_TRUSTED_KEYS = `test=${TEST_SIGNING.publicKeyBase64}`;
  process.env.GCS_PLUGINS_MAX_FAILURES = "2";
  return { services: createGcsServices({ configDir }), configDir };
}

export async function closePluginServices(services: GcsServices, configDir: string, keys: string[]): Promise<void> {
  await dropPluginData(services, keys);
  await closeGcsServices(services);
  await rm(configDir, { recursive: true, force: true }).catch(() => {});
}

/** Rolurile și schemele pluginurilor sunt în afara tabelelor golite de `truncateAll`: le ștergem explicit. */
export async function dropPluginData(services: GcsServices, keys: string[]): Promise<void> {
  const { GcsPluginDatabase } = await import("@gcs/core");
  const database = new GcsPluginDatabase({ databaseUrl: process.env.DATABASE_URL });
  // Ediția Lite pe MySQL: pluginurile n-au bază proprie (nimic de șters).
  if (database.onMysql) return database.close();
  for (const key of keys) await database.drop(key, database.roleName(key)).catch(() => {});
  await database.close();
  void services;
}

/** Un site gol: tabelele golite, Redis gol, pluginurile descărcate, seed-ul și câțiva actori. */
export async function resetPluginWorld(services: GcsServices, keys: string[]) {
  const { db, kv, registry } = services;
  await truncateAll(db);
  await kv.flushAll();
  await services.plugins.reconcile();
  await dropPluginData(services, keys);
  await seedDefaults(db, registry);
  const groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id])) as Record<string, number>;
  let n = 0;
  const actor = async (name: string, group: string): Promise<GcsActor> => {
    const user = await db.user.create({
      data: { name, nameNormalized: normalizeUsername(name), email: `${name.toLowerCase()}${++n}@mail.test`, primaryGroupId: groups[group]! },
    });
    return { userId: user.id, groupIds: [groups[group]!], primaryGroupId: groups[group]!, isBanned: false, ip: "203.0.113.9" };
  };
  const guest: GcsActor = { userId: null, groupIds: [groups.guest!], primaryGroupId: groups.guest!, isBanned: false, ip: "203.0.113.10" };
  return { groups, root: await actor("Root", "root_admin"), member: await actor("Membru", "member"), guest };
}

/** Instalează un plugin de test (semnat) ca Root Admin și așteaptă încărcarea lui. */
export async function installTestPlugin(services: GcsServices, root: GcsActor, files: Map<string, Buffer | string>, opts: { signed?: boolean } = {}): Promise<string> {
  const zip = packPlugin(files, opts.signed === false ? {} : { sign: TEST_SIGN });
  const { id, report } = await services.pluginAdmin.stage(root, { fileName: "test.zip", data: zip });
  if (!report.ok) throw new Error(`pachet invalid: ${JSON.stringify(report.checks.filter((c) => c.level === "error"))}`);
  const { key } = await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: report.manifest!.key });
  return key;
}

/** Fișierele unui plugin de test: manifestul (cu valorile date) și codul server. */
export function pluginFiles(manifest: Record<string, unknown>, server: string, extra: Record<string, string> = {}): Map<string, Buffer | string> {
  return new Map<string, Buffer | string>([
    ["plugin.json", JSON.stringify({ name: "Test", version: "1.0.0", author: "GCS", ...manifest })],
    ["server.mjs", server],
    ...Object.entries(extra),
  ]);
}
