/**
 * E2E pe pachetul ediției Lite, exact cum îl primește clientul: dezarhivează `gcs-lite-<versiune>[-<țintă>].zip`,
 * pornește `node app.js` (fără `DATABASE_URL`, ca pe o găzduire partajată proaspătă), apoi rulează installer-ul din
 * browser (`install.spec.ts`, cu baza MySQL sau PostgreSQL aleasă la pasul „Baza de date”) și smoke-urile etapelor pe
 * site-ul instalat.
 *
 *   pnpm --filter @gcs/web exec tsx e2e/run-package.mts --zip <arhiva> [--db mysql|postgres] [argumente playwright]
 *
 * Pachetul trebuie să fie pentru platforma mașinii (pe Windows: `--target win32-x64` la release). Licența de test e
 * semnată cu o cheie de unică folosință, de încredere doar pentru această rulare (`GCS_LICENSE_TRUSTED_KEYS`).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const dbDir = path.resolve(webDir, "../../packages/db");
const playwrightBin = path.join(webDir, "node_modules/@playwright/test/cli.js");

const argv = process.argv.slice(2);
const take = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};
const zip = take("zip");
const engine = take("db") === "postgres" ? "postgres" : "mysql";
if (!zip) {
  console.error("--zip <arhiva gcs-lite-…zip> lipsește");
  process.exit(2);
}

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

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Oprit între timp.
    }
  } else child.kill("SIGTERM");
}

/** O bază goală pentru instalare: MySQL 8.4 (`mysql-memory-server`) sau PostgreSQL (`embedded-postgres`). */
async function emptyDatabase(work: string): Promise<string> {
  const dbRequire = createRequire(path.join(dbDir, "package.json"));
  if (engine === "mysql") {
    const { createDB } = (await import(pathToFileURL(dbRequire.resolve("mysql-memory-server")).href)) as {
      createDB(o: { version: string; dbName: string; logLevel: string; downloadBinaryOnce: boolean }): Promise<{ username: string; port: number; stop(): Promise<void> }>;
    };
    const server = await createDB({ version: process.env.TEST_MYSQL_VERSION ?? "8.4.9", dbName: "gcs_package", logLevel: "ERROR", downloadBinaryOnce: true });
    cleanups.push(() => server.stop());
    return `mysql://${server.username}@127.0.0.1:${server.port}/gcs_package`;
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const databaseDir = path.join(work, "pg");
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "postgres", port, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {} });
  await pg.initialise();
  // Pe Windows, `postgres.exe` nu pornește dintr-un proces cu drepturi de administrator: prin `pg_ctl` (ca în run.mts).
  const embedded = createRequire(import.meta.url).resolve("embedded-postgres");
  const binaries = createRequire(embedded).resolve(`@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`);
  const { pg_ctl: pgCtl } = (await import(pathToFileURL(binaries).href)) as { pg_ctl: string };
  if (process.platform === "win32") {
    execFileSync(pgCtl, ["start", "-D", databaseDir, "-o", `-p ${port}`, "-w", "-t", "60", "-l", path.join(databaseDir, "server.log")], { stdio: "ignore" });
  } else await pg.start();
  cleanups.push(() => {
    try {
      execFileSync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w", "-t", "30"], { stdio: "ignore" });
    } catch {
      void pg.stop();
    }
  });
  const { default: pgClient } = await import("pg");
  const admin = new pgClient.Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE "gcs_package"`);
  await admin.end();
  return `postgresql://postgres:postgres@127.0.0.1:${port}/gcs_package`;
}

async function main(): Promise<number> {
  const work = path.join(webDir, ".e2e", `package-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  cleanups.push(() => rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }));
  // Windows: tar-ul din System32 (bsdtar) citește și zip-uri; pe Linux tar-ul GNU nu, deci `unzip`.
  if (process.platform === "win32") {
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", path.resolve(zip!), "-C", work], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-q", path.resolve(zip!), "-d", work], { stdio: "inherit" });
  }
  const root = path.join(work, readdirSync(work).find((n) => n.startsWith("gcs-lite-"))!);
  // CloudLinux (NodeJS Selector) nu schimbă versiunea Node.js a unei aplicații cu `node_modules` în rădăcină.
  if (existsSync(path.join(root, "node_modules"))) {
    console.error("[gcs package e2e] pachetul are node_modules în rădăcină (dependențele trebuie să stea în server/)");
    return 1;
  }
  // Sursele TypeScript nu intră în pachet (sunt compilate în `.next`).
  if (existsSync(path.join(root, "server", "apps", "web", "app")) || existsSync(path.join(root, "server", "apps", "web", "lib"))) {
    console.error("[gcs package e2e] pachetul conține sursele aplicației (server/apps/web/app sau lib)");
    return 1;
  }
  // Un upgrade peste structura veche (pachetul din 2026-10-30): `app.js` o mută la pornire, fără pierderi.
  const legacy = { file: path.join(root, "config", "files", "legacy", "vechi.txt"), code: path.join(root, "apps", "web", "server.js") };
  for (const file of Object.values(legacy)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "vechi");
  }

  const databaseUrl = await emptyDatabase(work);
  // Cheia licenței de test (Ed25519): privată doar pentru Playwright, publică pentru aplicație.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const licenseKeyFile = path.join(work, "license-key.pem");
  writeFileSync(licenseKeyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  const port = await freePort();
  const url = `http://localhost:${port}`;
  const secret = "gcs-package-e2e-secret-0123456789abcdef0123456789abcdef";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    GCS_SECRET: secret,
    GCS_LICENSE_TRUSTED_KEYS: `e2e=${Buffer.from(spki.subarray(spki.length - 32)).toString("base64")}`,
    GCS_LICENSE_SERVER: "off",
    GCS_TEST_ROUTES: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // Ca pe găzduire: fără bază configurată, fără adresa site-ului (installer-ul o ia din browser), fără ediție sau mod
  // impuse din afară (le pune `app.js`).
  for (const k of ["DATABASE_URL", "REDIS_URL", "GCS_EDITION", "NODE_ENV", "GCS_CONFIG_DIR", "GCS_UPLOADS_DIR", "GCS_PLUGINS_DIR", "GCS_APPLICATIONS_DIR", "GCS_MIGRATIONS_DIR", "GCS_REALTIME_URL", "GCS_BASE_URL", "GCS_DOMAIN"]) delete env[k];

  let code = "";
  const log: string[] = [];
  const app = spawn(process.execPath, ["app.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  cleanups.push(() => killTree(app));
  const onData = (d: Buffer) => {
    const text = String(d);
    log.push(text);
    if (process.env.GCS_E2E_VERBOSE) process.stdout.write(text);
  };
  app.stdout.on("data", onData);
  let stderr = "";
  app.stderr.on("data", (d: Buffer) => {
    onData(d);
    // Codul se ia doar de pe stderr, ca pe găzduire: Passenger / LiteSpeed păstrează în jurnal doar stderr.
    stderr += String(d);
    const m = /Cod de instalare: ([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/.exec(stderr);
    if (m) code = m[1]!;
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !code) await new Promise((r) => setTimeout(r, 500));
  if (!code) {
    console.error("[gcs package e2e] codul de instalare nu a apărut pe stderr:\n" + log.join("").slice(-3000));
    return 1;
  }
  console.log(`[gcs package e2e] pachetul pornit (${url}), baza: ${engine}`);
  const layout: [string, boolean][] = [
    ["uploads/legacy/vechi.txt", true],
    ["old-version/apps/web/server.js", true],
    ["config/files", false],
    ["apps", false],
    ...["config", "uploads", "plugins", "applications", "server"].map((dir): [string, boolean] => [dir, true]),
  ];
  const wrong = layout.filter(([rel, expected]) => existsSync(path.join(root, rel)) !== expected).map(([rel, expected]) => `${rel} ${expected ? "lipsește" : "nu trebuia să existe"}`);
  if (wrong.length > 0) {
    console.error(`[gcs package e2e] structura instalării nu e cea așteptată: ${wrong.join("; ")}`);
    return 1;
  }

  const playwright = spawn(process.execPath, [playwrightBin, "test", "--project=install", "--project=smoke", ...argv], {
    cwd: webDir,
    stdio: "inherit",
    env: {
      ...process.env,
      GCS_EDITION: "lite",
      GCS_SECRET: secret,
      GCS_E2E_INSTALL_URL: url,
      GCS_E2E_INSTALL_CODE: code,
      GCS_E2E_LICENSE_KEY: licenseKeyFile,
      GCS_E2E_INSTALL_DATABASE_URL: databaseUrl,
      GCS_E2E_INSTALL_DB_URL: databaseUrl,
      DATABASE_URL: databaseUrl,
    },
  });
  const exit = await new Promise<number>((resolve) => playwright.on("exit", (c) => resolve(c ?? 1)));
  if (exit !== 0) {
    console.log("[gcs package e2e] ultimele rânduri din jurnalul aplicației:\n" + log.join("").slice(-4000));
    return exit;
  }
  // Adresa luată din browser la instalare rămâne pentru reporniri și pentru `cron.mjs`.
  const runtime = readFileSync(path.join(root, "config", ".env.runtime"), "utf8");
  if (!runtime.includes(`GCS_BASE_URL=${url}\n`)) {
    console.error(`[gcs package e2e] config/.env.runtime nu conține GCS_BASE_URL=${url}`);
    return 1;
  }
  // Fișierele încărcate în timpul testelor ajung în `uploads/`, nu în folderul de configurare.
  if (existsSync(path.join(root, "config", "files")) || existsSync(path.join(root, "config", "plugins"))) {
    console.error("[gcs package e2e] config/ conține fișiere sau pachete (trebuiau în uploads/ și plugins/)");
    return 1;
  }
  return 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error("[gcs package e2e]", error);
} finally {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch {
      // Curățenia continuă.
    }
  }
}
process.exit(exitCode);
