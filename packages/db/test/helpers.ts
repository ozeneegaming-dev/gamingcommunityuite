import { PrismaClient } from "@prisma/client";
import { inject } from "vitest";
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
  return withDatabase(inject("pgBaseUrl"), `redline_test_${poolId}`);
}

/** Clientul Prisma pentru baza de test a worker-ului curent. */
export function testDb(): PrismaClient {
  client ??= new PrismaClient({ datasourceUrl: testDbUrl() });
  return client;
}

/** Golește toate tabelele (în afară de istoricul migrațiilor) și resetează secvențele. */
export async function truncateAll(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
