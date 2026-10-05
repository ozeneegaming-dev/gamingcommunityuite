/**
 * Rulează testele E2E (modul ES: top-level await) pe o instanță completă, pornită și oprită automat:
 * PostgreSQL (embedded sau `TEST_PG_URL`), Redis (`redis-memory-server` sau `TEST_REDIS_URL`),
 * migrații + seed, apoi aplicația Next.js pe portul 3100 și, la final, Playwright.
 *
 * Folosire: `pnpm --filter @gcs/web test:e2e [argumente playwright]`, ex. `test:e2e auth`.
 * Codul de ieșire e cel al Playwright. La final, toate procesele pornite sunt oprite curat.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedDefaults, GcsModuleRegistry } from "@gcs/core";
import { coreModule } from "@gcs/modules";
import { PrismaClient } from "@gcs/db";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const dbDir = path.resolve(webDir, "../../packages/db");
const prismaCli = path.join(dbDir, "node_modules/prisma/build/index.js");
const schemaPath = path.join(dbDir, "prisma/schema.prisma");
const nextBin = path.join(webDir, "node_modules/next/dist/bin/next");
const playwrightBin = path.join(webDir, "node_modules/@playwright/test/cli.js");
const PORT = Number(process.env.GCS_E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

const cleanups: (() => Promise<void> | void)[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Oprește un proces cu tot cu copiii lui (pe Windows, `next` pornește procese copil). */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Procesul s-a oprit între timp.
    }
  } else {
    child.kill("SIGTERM");
  }
}

async function startPostgres(): Promise<string> {
  if (process.env.TEST_PG_URL) return process.env.TEST_PG_URL;
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const root = path.join(webDir, ".e2e");
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(root)) {
    try {
      rmSync(path.join(root, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Încă blocat; se șterge data viitoare.
    }
  }
  const databaseDir = path.join(root, `pg-${process.pid}`);
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off"],
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  cleanups.push(() => {
    const bin = (server as unknown as { process?: ChildProcess }).process?.spawnfile;
    try {
      if (!bin) throw new Error("binar necunoscut");
      const pgCtl = path.join(path.dirname(bin), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
      execFileSync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w", "-t", "30"], { stdio: "ignore" });
    } catch {
      void server.stop();
    }
  });
  return `postgresql://postgres:postgres@localhost:${port}/postgres`;
}

async function startRedis(): Promise<string> {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  process.env.REDISMS_DOWNLOAD_DIR ??= path.join(os.tmpdir(), "redis-memory-server");
  const { RedisMemoryServer } = await import("redis-memory-server");
  const server = await RedisMemoryServer.create();
  cleanups.push(async () => {
    await server.stop();
  });
  return `redis://${await server.getHost()}:${await server.getPort()}`;
}

async function prepareDatabase(baseUrl: string): Promise<string> {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "redline_e2e" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "redline_e2e"`);
  await admin.end();
  const url = new URL(baseUrl);
  url.pathname = "/redline_e2e";
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const registry = new GcsModuleRegistry();
  registry.register(coreModule);
  await seedDefaults(db, registry);
  await db.$disconnect();
  return url.toString();
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Încă pornește.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Aplicația nu a pornit în ${timeoutMs / 1000}s (${BASE_URL}/api/health)`);
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv, stdio: "inherit" | "ignore" | "pipe"): ChildProcess {
  return spawn(process.execPath, [bin, ...args], { cwd: webDir, env, stdio });
}

async function main(): Promise<number> {
  const [pgUrl, redisUrl] = await Promise.all([startPostgres(), startRedis()]);
  const databaseUrl = await prepareDatabase(pgUrl);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    GCS_BASE_URL: BASE_URL,
    NEXT_TELEMETRY_DISABLED: "1",
  };

  // `next start` (după `pnpm build`) e mai rapid și mai aproape de producție; implicit, `next dev`.
  const mode = process.env.GCS_E2E_MODE === "start" ? "start" : "dev";
  const nextArgs = mode === "start" ? ["start", "-p", String(PORT)] : ["dev", "-p", String(PORT)];
  const next = run(nextBin, nextArgs, env, process.env.GCS_E2E_VERBOSE ? "inherit" : "ignore");
  cleanups.push(() => killTree(next));
  await waitForHealth(180_000);

  const playwright = run(playwrightBin, ["test", ...process.argv.slice(2)], { ...env, GCS_E2E_BASE_URL: BASE_URL }, "inherit");
  return new Promise((resolve) => playwright.on("exit", (code) => resolve(code ?? 1)));
}

async function cleanup(): Promise<void> {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch (error) {
      console.warn("[gcs e2e] curățarea a eșuat", error);
    }
  }
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error("[gcs e2e]", error);
} finally {
  await cleanup();
}
process.exit(exitCode);
