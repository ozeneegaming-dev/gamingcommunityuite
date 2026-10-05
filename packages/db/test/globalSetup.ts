import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { TEST_DB_COUNT, withDatabase } from "./url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "../prisma/schema.prisma");
// Pachetul `prisma` nu expune `build/index.js` prin "exports", așa că îl luăm direct din node_modules-ul lui @gcs/db.
const prismaCli = path.resolve(here, "../node_modules/prisma/build/index.js");

/** Evenimentele pe care `embedded-postgres` (prin `async-exit-hook`) își pune handlerii de oprire. */
const EXIT_EVENTS = ["exit", "beforeExit", "SIGHUP", "SIGINT", "SIGTERM", "SIGBREAK", "message"];
type Listener = (...args: unknown[]) => void;
const listenersOf = (event: string) => (process.listeners as (e: string) => Listener[])(event);

/** Un port TCP liber pe localhost. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Importă `embedded-postgres` fără handlerii lui de ieșire. Biblioteca folosește `async-exit-hook`, care la
 * `beforeExit` apelează `process.exit(0)` și astfel suprascrie codul de ieșire 1 pus de Vitest când un test
 * pică: testele picate ar părea trecute. Oprim serverul noi, în teardown.
 */
async function importEmbeddedPostgres() {
  const before = new Map(EXIT_EVENTS.map((e) => [e, new Set(listenersOf(e))]));
  const mod = await import("embedded-postgres");
  for (const event of EXIT_EVENTS) {
    for (const listener of listenersOf(event)) {
      if (!before.get(event)?.has(listener)) process.removeListener(event, listener);
    }
  }
  return mod.default;
}

/** Șterge folderele rămase de la rulările anterioare; un folder încă blocat de Windows e lăsat pe data viitoare. */
function cleanOldRuns(root: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      rmSync(path.join(root, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Încă folosit (ex. un proces orfan); se reîncearcă la rularea următoare.
    }
  }
}

/**
 * Pornește un server PostgreSQL de test și creează câte o bază migrată pentru fiecare worker.
 *
 * - Cu `TEST_PG_URL` (ex. în CI: `postgresql://redline:redline@localhost:5432/postgres`) folosește acel server.
 * - Fără, pornește un PostgreSQL embedded (pachetul `embedded-postgres`), fără Docker și fără instalare.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let baseUrl = process.env.TEST_PG_URL;
  let stopServer: (() => Promise<void>) | undefined;

  if (!baseUrl) {
    const EmbeddedPostgres = await importEmbeddedPostgres();
    // Folder separat per pachet (turbo rulează în paralel testele din `db`, `core` și `web`) și per rulare:
    // un proces orfan dintr-o rulare întreruptă nu mai blochează pornirea următoare.
    const root = path.resolve(process.cwd(), ".pgtest");
    cleanOldRuns(root);
    const databaseDir = path.join(root, `run-${process.pid}`);
    const port = process.env.TEST_PG_PORT ? Number(process.env.TEST_PG_PORT) : await freePort();
    const server = new EmbeddedPostgres({
      databaseDir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      // Fiecare worker are propriul pool Prisma; serverul de test e local, fără nevoie de durabilitate.
      postgresFlags: ["-c", "max_connections=200", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"],
      onLog: () => {},
    });
    await server.initialise();
    await server.start();
    baseUrl = `postgresql://postgres:postgres@localhost:${port}/postgres`;

    stopServer = async () => {
      // `server.stop()` folosește pe Windows `taskkill /f` și poate lăsa procese copil orfane;
      // `pg_ctl stop` oprește curat serverul cu toate procesele lui și așteaptă să termine.
      const postgresBin = (server as unknown as { process?: ChildProcess }).process?.spawnfile;
      try {
        if (!postgresBin) throw new Error("binarul postgres nu e cunoscut");
        const pgCtl = path.join(path.dirname(postgresBin), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
        execFileSync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w", "-t", "30"], { stdio: "pipe" });
      } catch (error) {
        console.warn("[gcs] pg_ctl stop a eșuat, opresc forțat PostgreSQL de test", error);
        await server.stop().catch(() => {});
      }
      try {
        rmSync(databaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Se șterge la rularea următoare.
      }
    };
  }

  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    for (let i = 1; i <= TEST_DB_COUNT; i++) {
      const name = `redline_test_${i}`;
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${name}"`);
      execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
        // Sub încărcarea `pnpm test` (toate pachetele pornesc PostgreSQL în paralel), conexiunea poate întârzia peste 5 s.
        env: { ...process.env, DATABASE_URL: `${withDatabase(baseUrl, name)}?connect_timeout=60` },
        stdio: "pipe",
      });
    }
  } finally {
    await admin.end();
  }

  project.provide("pgBaseUrl", baseUrl);

  return async () => {
    await stopServer?.();
  };
}
