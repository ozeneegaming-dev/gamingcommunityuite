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
  const url = new URL(withDatabase(inject("pgBaseUrl"), `redline_test_${poolId}`));
  // Pool mic și timeout-uri generoase: mai mulți workeri și pachete împart același server de test.
  url.searchParams.set("connection_limit", "4");
  url.searchParams.set("connect_timeout", "60");
  url.searchParams.set("pool_timeout", "60");
  return url.toString();
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
