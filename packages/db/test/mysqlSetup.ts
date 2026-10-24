import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { migrateDatabase } from "../src/migrate";
import { TEST_DB_COUNT, withDatabase } from "./url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../prisma/migrations");

export { testOnMysql } from "./url";

/**
 * Pornește un MySQL de test și creează câte o bază migrată (migrațiile MySQL) pentru fiecare worker.
 *
 * - Cu `TEST_MYSQL_URL` (ex. `mysql://root:parola@localhost:3306/mysql`) folosește acel server.
 * - Fără, pornește un MySQL 8.4 local prin `mysql-memory-server` (binarele se descarcă o singură dată, în %TEMP%).
 */
export async function setupMysql(project: TestProject): Promise<() => Promise<void>> {
  let baseUrl = process.env.TEST_MYSQL_URL;
  let stop: (() => Promise<void>) | undefined;
  if (!baseUrl) {
    const { createDB } = await import("mysql-memory-server");
    const server = await createDB({ version: process.env.TEST_MYSQL_VERSION ?? "8.4.9", dbName: "gcs_bootstrap", logLevel: "ERROR", downloadBinaryOnce: true });
    baseUrl = `mysql://${server.username}@127.0.0.1:${server.port}/gcs_bootstrap`;
    stop = () => server.stop();
  }
  const mysql = await import("mysql2/promise");
  const admin = await mysql.createConnection({ uri: baseUrl });
  try {
    for (let i = 1; i <= TEST_DB_COUNT; i++) {
      const name = `redline_test_${i}`;
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await migrateDatabase(withDatabase(baseUrl, name), migrationsDir);
    }
  } finally {
    await admin.end();
  }
  project.provide("pgBaseUrl", baseUrl);

  return async () => {
    await stop?.();
  };
}
