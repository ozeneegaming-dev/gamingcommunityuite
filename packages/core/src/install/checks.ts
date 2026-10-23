import { mkdir, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import Redis from "ioredis";
import pg from "pg";

export type GcsCheckId = "postgres" | "extensions" | "redis" | "minio" | "disk" | "config_writable";
export type GcsCheckResult = { id: GcsCheckId; ok: boolean; detail: string; fixKey?: string };

export type GcsCheckEnv = {
  databaseUrl?: string | undefined;
  redisUrl?: string | undefined;
  /** Endpoint-ul MinIO/S3 (ex. `http://minio:9000`). */
  s3Endpoint?: string | undefined;
  configDir: string;
  /** Ediția Lite (shared hosting) nu are Redis și MinIO: verificările lor lipsesc. */
  edition?: "vps" | "lite";
};

const TIMEOUT_MS = 3000;
const MIN_FREE_BYTES = 2 * 1024 ** 3;
const REQUIRED_EXTENSIONS = ["unaccent", "pg_trgm"];

const result = (id: GcsCheckId, ok: boolean, detail: string): GcsCheckResult =>
  ok ? { id, ok, detail } : { id, ok, detail, fixKey: `install.fix.${id}` };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function checkPostgres(url: string | undefined, timeoutMs: number): Promise<GcsCheckResult[]> {
  if (!url) return [result("postgres", false, "DATABASE_URL lipsește"), result("extensions", false, "—")];
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  client.on("error", () => {});
  try {
    await client.connect();
    const version = (await client.query<{ server_version: string }>("SHOW server_version")).rows[0]?.server_version ?? "?";
    const available = await client.query<{ name: string }>(
      "SELECT name FROM pg_available_extensions WHERE name = ANY($1::text[])",
      [REQUIRED_EXTENSIONS],
    );
    const missing = REQUIRED_EXTENSIONS.filter((e) => !available.rows.some((r) => r.name === e));
    return [
      result("postgres", true, `PostgreSQL ${version}`),
      result("extensions", missing.length === 0, missing.length === 0 ? REQUIRED_EXTENSIONS.join(", ") : `lipsesc: ${missing.join(", ")}`),
    ];
  } catch (error) {
    return [result("postgres", false, message(error)), result("extensions", false, "—")];
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkRedis(url: string | undefined, timeoutMs: number): Promise<GcsCheckResult> {
  if (!url) return result("redis", false, "REDIS_URL lipsește");
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  try {
    await redis.connect();
    const pong = await redis.ping();
    return result("redis", pong === "PONG", pong);
  } catch (error) {
    return result("redis", false, message(error));
  } finally {
    redis.disconnect();
  }
}

async function checkMinio(endpoint: string | undefined, timeoutMs: number): Promise<GcsCheckResult> {
  if (!endpoint) return result("minio", false, "S3_ENDPOINT lipsește");
  try {
    const res = await fetch(new URL("/minio/health/live", endpoint), { signal: AbortSignal.timeout(timeoutMs) });
    return result("minio", res.ok, `HTTP ${res.status}`);
  } catch (error) {
    return result("minio", false, message(error));
  }
}

async function checkDisk(dir: string): Promise<GcsCheckResult> {
  for (const candidate of [dir, path.dirname(dir), process.cwd()]) {
    try {
      const fs = await statfs(candidate);
      const free = fs.bavail * fs.bsize;
      const gb = (free / 1024 ** 3).toFixed(1);
      return result("disk", free >= MIN_FREE_BYTES, `${gb} GB liberi`);
    } catch {
      // Încercăm un folder părinte (configDir poate să nu existe încă).
    }
  }
  return result("disk", false, "spațiul liber nu poate fi citit");
}

async function checkConfigWritable(dir: string): Promise<GcsCheckResult> {
  const probe = path.join(dir, `.write-test-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return result("config_writable", true, dir);
  } catch (error) {
    return result("config_writable", false, message(error));
  }
}

/**
 * Verificările de sistem din pasul 2 al instalării (spec §17.1): PostgreSQL și extensiile cerute, Redis,
 * MinIO, spațiul pe disc (≥ 2 GB) și folderul de configurare. O verificare eșuată are `fixKey`,
 * cheia textului care explică remedierea.
 */
export async function runChecks(env: GcsCheckEnv & { timeoutMs?: number }): Promise<GcsCheckResult[]> {
  const timeoutMs = env.timeoutMs ?? TIMEOUT_MS;
  if (env.edition === "lite") {
    const [postgres, disk, config] = await Promise.all([checkPostgres(env.databaseUrl, timeoutMs), checkDisk(env.configDir), checkConfigWritable(env.configDir)]);
    return [...postgres, disk, config];
  }
  const [postgres, redis, minio, disk, config] = await Promise.all([
    checkPostgres(env.databaseUrl, timeoutMs),
    checkRedis(env.redisUrl, timeoutMs),
    checkMinio(env.s3Endpoint, timeoutMs),
    checkDisk(env.configDir),
    checkConfigWritable(env.configDir),
  ]);
  return [...postgres, redis, minio, disk, config];
}
