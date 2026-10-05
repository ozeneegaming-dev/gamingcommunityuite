import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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
 * Pornește un server PostgreSQL de test și creează câte o bază migrată pentru fiecare worker.
 *
 * - Cu `TEST_PG_URL` (ex. în CI: `postgresql://redline:redline@localhost:5432/postgres`) folosește acel server.
 * - Fără, pornește un PostgreSQL embedded (pachetul `embedded-postgres`), fără Docker și fără instalare.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let baseUrl = process.env.TEST_PG_URL;
  let stopServer: (() => Promise<void>) | undefined;

  if (!baseUrl) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    // Folder și port separate per pachet: turbo rulează în paralel testele din `db` și `core`.
    const databaseDir = path.resolve(process.cwd(), ".pgtest");
    // Pe Windows, folderul poate rămâne blocat câteva clipe după oprirea unui server anterior.
    rmSync(databaseDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    const port = process.env.TEST_PG_PORT ? Number(process.env.TEST_PG_PORT) : await freePort();
    const server = new EmbeddedPostgres({
      databaseDir,
      user: "postgres",
      password: "postgres",
      port,
      // Folderul îl ștergem noi, cu reîncercări, la pornirea următoare (vezi mai sus).
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
      // O eroare la oprire (ex. fișier blocat de Windows) nu trebuie să pice testele care au trecut.
      await server.stop().catch((error: unknown) => console.warn("[gcs] oprirea PostgreSQL de test a eșuat", error));
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
        env: { ...process.env, DATABASE_URL: withDatabase(baseUrl, name) },
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
