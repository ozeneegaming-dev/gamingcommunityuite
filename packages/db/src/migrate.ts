import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/** Cheia lock-ului PostgreSQL care împiedică două migrări simultane (ex. două containere `web` care pornesc deodată). */
const MIGRATION_LOCK_KEY = 72_707_369;

/** Tabelul de evidență, identic cu cel creat de `prisma migrate deploy`. */
const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

/**
 * Aplică migrațiile SQL din `prisma/migrations` care lipsesc, în ordine, fiecare într-o tranzacție
 * (spec §17: migrațiile rulează automat la pornire, cu lock). Echivalent cu `prisma migrate deploy`,
 * dar fără CLI-ul Prisma, care nu există în imaginea de producție (Next.js standalone).
 */
export async function migrateDatabase(databaseUrl: string, migrationsDir: string): Promise<{ applied: string[] }> {
  const client = new pg.Client({ connectionString: databaseUrl });
  client.on("error", () => {});
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(MIGRATIONS_TABLE);
    const done = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const finished = new Set(done.rows.map((r) => r.migration_name));

    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const name of names) {
      if (finished.has(name)) continue;
      const sql = await readFile(path.join(migrationsDir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count, started_at)
           VALUES ($1, $2, now(), $3, 1, now())`,
          [randomUUID(), checksum, name],
        );
        await client.query("COMMIT");
        applied.push(name);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migrația ${name} a eșuat: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
  return { applied };
}
