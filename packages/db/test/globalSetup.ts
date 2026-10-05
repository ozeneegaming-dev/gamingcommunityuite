import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { TEST_DB_COUNT, withDatabase } from "./url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, "../prisma/schema.prisma");
// Pachetul `prisma` nu expune `build/index.js` prin "exports", așa că îl luăm direct din node_modules-ul lui @gcs/db.
const prismaCli = path.resolve(here, "../node_modules/prisma/build/index.js");

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
    const databaseDir = path.resolve(here, "../.pgtest");
    rmSync(databaseDir, { recursive: true, force: true });
    const port = Number(process.env.TEST_PG_PORT ?? 54329);
    const server = new EmbeddedPostgres({
      databaseDir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
    });
    await server.initialise();
    await server.start();
    baseUrl = `postgresql://postgres:postgres@localhost:${port}/postgres`;
    stopServer = () => server.stop();
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
