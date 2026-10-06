/**
 * Rulează testele E2E (modul ES: top-level await) pe o instanță completă, pornită și oprită automat:
 * PostgreSQL (embedded sau `TEST_PG_URL`), Redis (`redis-memory-server` sau `TEST_REDIS_URL`),
 * migrații + seed, apoi aplicația Next.js pe portul 3100 (build de producție + `next start`), `gcs-worker` și `gcs-realtime`
 * pentru fiecare instanță și, la final, Playwright.
 *
 * Folosire: `pnpm --filter @gcs/web test:e2e [argumente playwright]`, ex. `test:e2e auth`.
 * Codul de ieșire e cel al Playwright. La final, toate procesele pornite sunt oprite curat.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureInstallCode, seedDefaults } from "@gcs/core";
import { createRegistry } from "@gcs/modules";
import { PrismaClient } from "@gcs/db";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const dbDir = path.resolve(webDir, "../../packages/db");
const prismaCli = path.join(dbDir, "node_modules/prisma/build/index.js");
const schemaPath = path.join(dbDir, "prisma/schema.prisma");
const nextBin = path.join(webDir, "node_modules/next/dist/bin/next");
const playwrightBin = path.join(webDir, "node_modules/@playwright/test/cli.js");
const workerDir = path.resolve(webDir, "../worker");
const realtimeDir = path.resolve(webDir, "../realtime");
const PORT = Number(process.env.GCS_E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
/** A doua instanță, proaspătă și neinstalată, pentru testele installer-ului (`install.spec.ts`). */
const INSTALL_PORT = PORT + 1;
const INSTALL_URL = `http://localhost:${INSTALL_PORT}`;

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
  // Pe Windows, `postgres.exe` nu pornește direct dintr-un proces cu drepturi de administrator; `pg_ctl` renunță
  // singur la ele, deci pornim prin el (cu `stdio: "ignore"`: serverul moștenește handle-urile).
  const embedded = createRequire(import.meta.url).resolve("embedded-postgres");
  const binaries = createRequire(embedded).resolve(`@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`);
  const { pg_ctl: pgCtl } = (await import(pathToFileURL(binaries).href)) as { pg_ctl: string };
  if (process.platform === "win32") {
    execFileSync(pgCtl, ["start", "-D", databaseDir, "-o", `-p ${port} -c fsync=off -c synchronous_commit=off`, "-w", "-t", "60", "-l", path.join(databaseDir, "server.log")], {
      stdio: "ignore",
    });
  } else {
    await server.start();
  }
  cleanups.push(() => {
    try {
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
  await seedDefaults(db, createRegistry());
  await db.$disconnect();
  return url.toString();
}

/** O bază goală (fără migrații): installer-ul o pregătește singur. */
async function emptyDatabase(baseUrl: string, name: string): Promise<string> {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function waitForHealth(timeoutMs: number, baseUrl = BASE_URL): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Încă pornește.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Aplicația nu a pornit în ${timeoutMs / 1000}s (${baseUrl}/api/health)`);
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv, stdio: "inherit" | "ignore" | "pipe"): ChildProcess {
  return spawn(process.execPath, [bin, ...args], { cwd: webDir, env, stdio });
}

/** `gcs-worker` (din sursele TypeScript, cu tsx), cu același mediu ca instanța web pe care o deservește. */
function startWorker(env: NodeJS.ProcessEnv): void {
  const worker = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: workerDir,
    env,
    stdio: process.env.GCS_E2E_VERBOSE ? "inherit" : "ignore",
  });
  cleanups.push(() => killTree(worker));
}

/** `gcs-realtime` pe un port liber; întoarce adresa pentru browser (`GCS_REALTIME_URL`). */
async function startRealtime(env: NodeJS.ProcessEnv): Promise<string> {
  const port = await freePort();
  const realtime = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: realtimeDir,
    env: { ...env, PORT: String(port) },
    stdio: process.env.GCS_E2E_VERBOSE ? "inherit" : "ignore",
  });
  cleanups.push(() => killTree(realtime));
  return `http://localhost:${port}`;
}

async function main(): Promise<number> {
  const [pgUrl, redisUrl] = await Promise.all([startPostgres(), startRedis()]);
  const databaseUrl = await prepareDatabase(pgUrl);
  // Un folder de configurare „deja instalat”: testele (în afară de cele ale installer-ului) pornesc de pe un site instalat.
  const configDir = path.join(webDir, ".e2e", `config-${process.pid}`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "installed.lock"), new Date().toISOString());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    GCS_BASE_URL: BASE_URL,
    GCS_CONFIG_DIR: configDir,
    // În producție Better Auth cere un secret propriu; pentru teste e unul de unică folosință.
    GCS_SECRET: process.env.GCS_SECRET ?? "gcs-e2e-secret-0123456789abcdef0123456789abcdef",
    GCS_TEST_ROUTES: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  env.GCS_REALTIME_URL = await startRealtime(env);

  // Implicit: build de producție + `next start` (stabil, ca în producție). `GCS_E2E_MODE=dev` folosește `next dev`;
  // `GCS_E2E_SKIP_BUILD=1` refolosește un build existent.
  const mode = process.env.GCS_E2E_MODE === "dev" ? "dev" : "start";
  if (mode === "start" && process.env.GCS_E2E_SKIP_BUILD !== "1") {
    console.log("[gcs e2e] next build…");
    execFileSync(process.execPath, [nextBin, "build"], { cwd: webDir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "inherit" });
  }
  const nextArgs = mode === "start" ? ["start", "-p", String(PORT)] : ["dev", "-p", String(PORT)];
  const next = run(nextBin, nextArgs, env, process.env.GCS_E2E_VERBOSE ? "inherit" : "ignore");
  cleanups.push(() => killTree(next));
  startWorker(env);

  // Instanța pentru installer: altă bază (goală), alt folder de configurare (neinstalat), altă bază Redis.
  // Doar cu build de producție: două `next dev` nu pot rula în același proiect.
  const installEnv: Record<string, string> = {};
  if (mode === "start") {
    const installConfigDir = path.join(webDir, ".e2e", `install-config-${process.pid}`);
    mkdirSync(installConfigDir, { recursive: true });
    const code = await ensureInstallCode(installConfigDir);
    const installRedis = new URL(redisUrl);
    installRedis.pathname = "/2";
    const installInstanceEnv = {
      ...env,
      DATABASE_URL: await emptyDatabase(pgUrl, "redline_e2e_install"),
      REDIS_URL: installRedis.toString(),
      GCS_CONFIG_DIR: installConfigDir,
      GCS_BASE_URL: INSTALL_URL,
    };
    installInstanceEnv.GCS_REALTIME_URL = await startRealtime(installInstanceEnv);
    const installServer = run(nextBin, ["start", "-p", String(INSTALL_PORT)], installInstanceEnv, process.env.GCS_E2E_VERBOSE ? "inherit" : "ignore");
    cleanups.push(() => killTree(installServer));
    // Worker-ul așteaptă `installed.lock`, apoi pornește singur (ca în Docker, pe un site proaspăt).
    startWorker(installInstanceEnv);
    Object.assign(installEnv, { GCS_E2E_INSTALL_URL: INSTALL_URL, GCS_E2E_INSTALL_CODE: code ?? "" });
    await waitForHealth(180_000, INSTALL_URL);
  }
  await waitForHealth(180_000);

  const playwright = run(
    playwrightBin,
    ["test", ...process.argv.slice(2)],
    { ...env, ...installEnv, GCS_E2E_BASE_URL: BASE_URL },
    "inherit",
  );
  const code = await new Promise<number>((resolve) => playwright.on("exit", (c) => resolve(c ?? 1)));
  // Cu GCS_E2E_KEEP=1, serverele rămân pornite după teste (verificare manuală în browser, cu datele de test).
  if (process.env.GCS_E2E_KEEP === "1") {
    console.log(`[gcs e2e] serverele rămân pornite: ${BASE_URL} (Ctrl+C pentru oprire)`);
    await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  }
  return code;
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
