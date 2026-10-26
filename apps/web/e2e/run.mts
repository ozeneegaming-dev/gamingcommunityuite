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
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureInstallCode, seedDefaults } from "@gcs/core";
import { createRegistry } from "@gcs/modules";
import { createPrismaClient } from "@gcs/db";
import { migrateDatabase } from "@gcs/db/migrate";
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

/**
 * MySQL 8.4 local (`mysql-memory-server`, dependența de test a lui `@gcs/db`; binarele se descarcă o singură dată) sau
 * `TEST_MYSQL_URL`. Întoarce adresa bazei de serviciu (`mysql://…/gcs_e2e_bootstrap`).
 */
async function startMysql(): Promise<string> {
  if (process.env.TEST_MYSQL_URL) return process.env.TEST_MYSQL_URL;
  const dbRequire = createRequire(path.join(dbDir, "package.json"));
  const { createDB } = (await import(pathToFileURL(dbRequire.resolve("mysql-memory-server")).href)) as {
    createDB(o: { version: string; dbName: string; logLevel: string; downloadBinaryOnce: boolean }): Promise<{ username: string; port: number; stop(): Promise<void> }>;
  };
  const server = await createDB({ version: process.env.TEST_MYSQL_VERSION ?? "8.4.9", dbName: "gcs_e2e_bootstrap", logLevel: "ERROR", downloadBinaryOnce: true });
  cleanups.push(async () => {
    await server.stop();
  });
  return `mysql://${server.username}@127.0.0.1:${server.port}/gcs_e2e_bootstrap`;
}

/** O conexiune `mysql2` de administrare (din dependențele lui `@gcs/db`). */
async function mysqlAdmin(baseUrl: string): Promise<{ query(sql: string): Promise<unknown>; end(): Promise<void> }> {
  const dbRequire = createRequire(path.join(dbDir, "package.json"));
  const mysql = dbRequire("mysql2/promise") as { createConnection(o: { uri: string }): Promise<{ query(sql: string): Promise<unknown>; end(): Promise<void> }> };
  return mysql.createConnection({ uri: baseUrl });
}

/** Baza `name` creată din nou (goală), pe serverul din `baseUrl`; întoarce adresa ei. */
async function recreateDatabase(baseUrl: string, name: string): Promise<string> {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  if (MYSQL) {
    const admin = await mysqlAdmin(baseUrl);
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();
    return url.toString();
  }
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  return url.toString();
}

async function startRedis(): Promise<string> {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  process.env.REDISMS_DOWNLOAD_DIR ??= path.join(os.tmpdir(), "redis-memory-server");
  // Scriptul de pază al serverului Redis pornește cu `$NODE`; sub pnpm-ul standalone acesta e `pnpm.exe`, care dă
  // `.js`-ul shell-ului, iar Windows îl deschide în editorul asociat.
  process.env.NODE = process.execPath;
  const { RedisMemoryServer } = await import("redis-memory-server");
  const server = await RedisMemoryServer.create();
  cleanups.push(async () => {
    await server.stop();
  });
  return `redis://${await server.getHost()}:${await server.getPort()}`;
}

/**
 * Un LibreTranslate fals (fără modele): `/translate` întoarce textul cu prefixul limbii, ex. `[de] <p>salut</p>`.
 * Ajunge pentru testele butonului „Traduce”; instanțele E2E îl primesc prin setarea `i18n.libretranslate_url`.
 */
async function startFakeTranslator(): Promise<string> {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const body = (raw ? JSON.parse(raw) : {}) as { q?: string | string[]; target?: string };
      const tr = (q: string) => `[${body.target ?? "?"}] ${q}`;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ translatedText: Array.isArray(body.q) ? body.q.map(tr) : tr(body.q ?? "") }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${port}`;
}

/**
 * Fluxurile de test ale botului de știri (bot-stiri): un RSS (și o redirecționare spre el) și API-ul de știri Steam cu
 * un anunț oficial. Pluginurile ajung la el doar prin `GCS_PLUGIN_HTTP_TEST_HOSTS` (cu `GCS_TEST_ROUTES=1`).
 */
async function startFakeFeeds(): Promise<string> {
  const port = await freePort();
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Fluxul de test</title>
<item><title>Turneul de toamnă începe sâmbătă</title><link>https://news.example.com/turneu</link><guid>e2e-news-1</guid>
<pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Înscrierile sunt deschise pentru echipele de cinci jucători. Detaliile complete sunt pe site-ul organizatorului.</p><img src="https://news.example.com/turneu.jpg">]]></description></item>
</channel></rss>`;
  const steam = {
    appnews: {
      appid: 730,
      newsitems: [
        {
          gid: "e2e-steam-1",
          title: "Counter-Strike 2 Update",
          url: "https://store.steampowered.com/news/app/730/view/e2e",
          feedname: "steam_community_announcements",
          date: 1_793_000_000,
          contents: "[ MISC ]\n[list][*]Agents now wear gloves in the buy menu.[*]Fixed the grenade crosshair.[/list]",
        },
        { gid: "e2e-steam-2", title: "Third-party article", url: "https://example.com/x", feedname: "pcgamer", date: 1_793_000_100, contents: "<p>not official</p>" },
      ],
    },
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/rss.xml") {
      res.setHeader("content-type", "application/rss+xml; charset=utf-8");
      return res.end(rss);
    }
    if (url.pathname === "/moved.xml") {
      res.statusCode = 301;
      res.setHeader("location", "/rss.xml");
      return res.end();
    }
    if (url.pathname === "/steam/ISteamNews/GetNewsForApp/v2/") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(steam));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${port}`;
}

/**
 * Verificatorul OpenID Steam fals (login-ul cu Steam în E2E): la `check_authentication` răspunde `is_valid:true` doar
 * pentru răspunsurile semnate de teste (`openid.sig` = HMAC-SHA256 cu secretul acestei rulări al lui `openid.claimed_id`).
 * Instanța web îl folosește doar cu `GCS_TEST_ROUTES=1` (vezi `steam-plugin.ts`).
 */
async function startFakeSteam(secret: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const port = await freePort();
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const params = new URLSearchParams(raw);
      const expected = createHmac("sha256", secret).update(params.get("openid.claimed_id") ?? "").digest("base64url");
      const valid = params.get("openid.mode") === "check_authentication" && params.get("openid.sig") === expected;
      res.setHeader("content-type", "text/plain");
      res.end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid ? "true" : "false"}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${port}/openid/login`;
}

/** Pornirea aplicației (instalare + instanța de test); sub sarcină mare durează mai mult. */
const HEALTH_TIMEOUT_MS = 360_000;

async function prepareDatabase(baseUrl: string, translatorUrl: string): Promise<string> {
  const url = new URL(await recreateDatabase(baseUrl, "redline_e2e"));
  // Sub sarcină mare (alte teste sau build-uri pe aceeași mașină), conectarea poate depăși cele 5 s implicite ale Prisma:
  // valabil pentru migrații, seed și instanțele aplicației (toate primesc adresa asta).
  url.searchParams.set("connect_timeout", "60");
  if (MYSQL) {
    // MySQL: migrația de bază MySQL, prin runner-ul aplicației (ca installer-ul ediției Lite).
    await migrateDatabase(url.toString(), path.join(dbDir, "prisma/migrations"));
  } else {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: "pipe",
    });
  }
  const db = createPrismaClient(url.toString());
  await seedDefaults(db, createRegistry());
  await db.setting.upsert({
    where: { key: "i18n.libretranslate_url" },
    create: { key: "i18n.libretranslate_url", value: translatorUrl },
    update: { value: translatorUrl },
  });
  await db.$disconnect();
  return url.toString();
}

/** O bază goală (fără migrații): installer-ul o pregătește singur. */
async function emptyDatabase(baseUrl: string, name: string): Promise<string> {
  return recreateDatabase(baseUrl, name);
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

/**
 * `GCS_EDITION=lite`: ediția Lite (shared hosting) — fără Redis, fără `gcs-worker` și fără `gcs-realtime`; cheile,
 * joburile și timpul real (SSE / polling) stau în baza de date și în procesul web.
 */
const LITE = process.env.GCS_EDITION === "lite";
/** `GCS_DB=mysql` (doar cu `GCS_EDITION=lite`): ediția Lite pe MySQL 8.4 în locul PostgreSQL. */
const MYSQL = process.env.GCS_DB === "mysql";

async function main(): Promise<number> {
  if (MYSQL && !LITE) throw new Error("GCS_DB=mysql merge doar cu GCS_EDITION=lite (ediția VPS e pe PostgreSQL)");
  const [pgUrl, redisUrl] = await Promise.all([MYSQL ? startMysql() : startPostgres(), LITE ? Promise.resolve("") : startRedis()]);
  const databaseUrl = await prepareDatabase(pgUrl, await startFakeTranslator());
  // Un folder de configurare „deja instalat”: testele (în afară de cele ale installer-ului) pornesc de pe un site instalat.
  const configDir = path.join(webDir, ".e2e", `config-${process.pid}`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "installed.lock"), new Date().toISOString());
  // Pluginurile semnate din teste (ex. Studio VIP): o cheie Ed25519 de unică folosință, de încredere doar pentru această
  // rulare. Cheia privată stă în folderul `.e2e` (șters la rularea următoare) și ajunge doar la Playwright.
  const { generateSigningKey } = await import("@gcs/plugin-sdk/pack");
  const e2eKey = generateSigningKey();
  const e2eKeyFile = path.join(webDir, ".e2e", `plugin-key-${process.pid}.pem`);
  writeFileSync(e2eKeyFile, e2eKey.privateKeyPem, { mode: 0o600 });
  cleanups.push(() => rmSync(e2eKeyFile, { force: true }));
  // Login-ul cu Steam: un secret de unică folosință, cunoscut doar de verificatorul fals și de Playwright.
  const steamSecret = (await import("node:crypto")).randomBytes(24).toString("base64url");
  const steamCheckUrl = await startFakeSteam(steamSecret);
  const feedsUrl = await startFakeFeeds();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GCS_PLUGIN_TRUSTED_KEYS: [process.env.GCS_PLUGIN_TRUSTED_KEYS, `e2e=${e2eKey.publicKeyBase64}`].filter(Boolean).join(","),
    // Licențele de test (pasul „Licență” al installer-ului): semnate în teste cu aceeași cheie de unică folosință.
    GCS_LICENSE_TRUSTED_KEYS: `e2e=${e2eKey.publicKeyBase64}`,
    // Testele nu vorbesc niciodată cu Data Center-ul real (verificarea online a licenței).
    GCS_LICENSE_SERVER: "off",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    GCS_BASE_URL: BASE_URL,
    GCS_CONFIG_DIR: configDir,
    // În producție Better Auth cere un secret propriu; pentru teste e unul de unică folosință.
    GCS_SECRET: process.env.GCS_SECRET ?? "gcs-e2e-secret-0123456789abcdef0123456789abcdef",
    GCS_TEST_ROUTES: "1",
    GCS_STEAM_OPENID_CHECK_URL: steamCheckUrl,
    // Aplicația Servere: serverul de joc fals al testelor rulează pe 127.0.0.1 (altfel adresa locală e refuzată).
    GCS_SERVERS_ALLOW_NETS: "127.0.0.1/32",
    // Botul de știri: fluxurile de test (doar această adresă, doar cu `GCS_TEST_ROUTES=1`).
    GCS_PLUGIN_HTTP_TEST_HOSTS: new URL(feedsUrl).host,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (LITE) {
    env.GCS_EDITION = "lite";
    delete env.REDIS_URL;
  } else {
    env.GCS_REALTIME_URL = await startRealtime(env);
  }

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
  if (!LITE) startWorker(env);

  // Instanța pentru installer: altă bază (goală), alt folder de configurare (neinstalat), altă bază Redis.
  // Doar cu build de producție: două `next dev` nu pot rula în același proiect.
  const installEnv: Record<string, string> = {};
  if (mode === "start") {
    const installConfigDir = path.join(webDir, ".e2e", `install-config-${process.pid}`);
    mkdirSync(installConfigDir, { recursive: true });
    const code = await ensureInstallCode(installConfigDir);
    const installInstanceEnv: NodeJS.ProcessEnv = {
      ...env,
      DATABASE_URL: await emptyDatabase(pgUrl, "redline_e2e_install"),
      GCS_CONFIG_DIR: installConfigDir,
      GCS_BASE_URL: INSTALL_URL,
    };
    if (!LITE) {
      const installRedis = new URL(redisUrl);
      installRedis.pathname = "/2";
      installInstanceEnv.REDIS_URL = installRedis.toString();
      installInstanceEnv.GCS_REALTIME_URL = await startRealtime(installInstanceEnv);
    }
    const installServer = run(nextBin, ["start", "-p", String(INSTALL_PORT)], installInstanceEnv, process.env.GCS_E2E_VERBOSE ? "inherit" : "ignore");
    cleanups.push(() => killTree(installServer));
    // Worker-ul așteaptă `installed.lock`, apoi pornește singur (ca în Docker, pe un site proaspăt).
    if (!LITE) startWorker(installInstanceEnv);
    Object.assign(installEnv, {
      GCS_E2E_INSTALL_URL: INSTALL_URL,
      GCS_E2E_INSTALL_CODE: code ?? "",
      // Pentru install.spec: readuce aplicația de pornire implicită după ce verifică alegerea (smoke-urile continuă pe instanță).
      GCS_E2E_INSTALL_DATABASE_URL: installInstanceEnv.DATABASE_URL ?? "",
      GCS_E2E_INSTALL_REDIS_URL: installInstanceEnv.REDIS_URL ?? "",
    });
    await waitForHealth(HEALTH_TIMEOUT_MS, INSTALL_URL);
  }
  await waitForHealth(HEALTH_TIMEOUT_MS);

  const playwright = run(
    playwrightBin,
    ["test", ...process.argv.slice(2)],
    { ...env, ...installEnv, GCS_E2E_BASE_URL: BASE_URL, GCS_E2E_PLUGIN_KEY: e2eKeyFile, GCS_E2E_LICENSE_KEY: e2eKeyFile, GCS_E2E_STEAM_SECRET: steamSecret, GCS_E2E_FEEDS_URL: feedsUrl },
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
