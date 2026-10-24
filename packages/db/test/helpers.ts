import type { PrismaClient } from "@prisma/client";
import { inject } from "vitest";
import { createPrismaClient } from "../src/client";
import { gcsDbDialect } from "../src/json";
import { withDatabase } from "./url";

declare module "vitest" {
  export interface ProvidedContext {
    pgBaseUrl: string;
  }
}

let client: PrismaClient | undefined;

/** URL-ul bazei de test a worker-ului curent. */
export function testDbUrl(): string {
  const poolId = process.env.VITEST_POOL_ID ?? "1";
  const url = new URL(withDatabase(inject("pgBaseUrl"), `redline_test_${poolId}`));
  // Pool mic și timeout-uri generoase: mai mulți workeri și pachete împart același server de test.
  url.searchParams.set("connection_limit", "4");
  url.searchParams.set("connect_timeout", "60");
  url.searchParams.set("pool_timeout", "60");
  return url.toString();
}

/** Clientul Prisma pentru baza de test a worker-ului curent. */
export function testDb(): PrismaClient {
  client ??= createPrismaClient(testDbUrl());
  return client;
}

/** Golește toate tabelele (în afară de istoricul migrațiilor) și resetează secvențele. */
export async function truncateAll(db: PrismaClient): Promise<void> {
  if (gcsDbDialect(testDbUrl()) === "mysql") return truncateMysql();
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  // Scrierile în fundal ale testului anterior (prezența, cache-ul pe driverele SQL ale ediției Lite) pot ține încă
  // rânduri blocate: un deadlock oprește `TRUNCATE`, care se reia.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
      return;
    } catch (error) {
      if (attempt >= 5 || !/40P01|deadlock/i.test(String((error as Error).message))) throw error;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}

let mysqlConn: import("mysql2/promise").Connection | undefined;

/**
 * MySQL: `TRUNCATE` pe toate tabelele ar dura secunde la fiecare test; se golesc cu `DELETE` doar cele cu rânduri, iar
 * cele cu contor `AUTO_INCREMENT` pornit se trunchiază (contorul revine la 1, ca `RESTART IDENTITY`).
 */
async function truncateMysql(): Promise<void> {
  if (!mysqlConn) {
    const mysql = await import("mysql2/promise");
    const url = new URL(testDbUrl());
    url.search = "";
    mysqlConn = await mysql.createConnection({ uri: url.toString() });
    await mysqlConn.query("SET SESSION information_schema_stats_expiry = 0");
  }
  const conn = mysqlConn;
  const [tables] = await conn.query<import("mysql2").RowDataPacket[]>(
    "SELECT TABLE_NAME AS name, AUTO_INCREMENT AS ai FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> '_prisma_migrations'",
  );
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const t of tables) {
      const name = String(t.name);
      if (t.ai !== null && Number(t.ai) > 1) await conn.query(`TRUNCATE TABLE \`${name}\``);
      else await conn.query(`DELETE FROM \`${name}\``);
    }
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}
