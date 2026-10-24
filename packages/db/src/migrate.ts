import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { gcsDbDialect } from "./json";

/** Cheia lock-ului PostgreSQL care împiedică două migrări simultane (ex. două containere `web` care pornesc deodată). */
const MIGRATION_LOCK_KEY = 72_707_369;
/** Lock-ul MySQL echivalent (`GET_LOCK`, la nivel de server, cu nume). */
const MYSQL_LOCK = "gcs-migrations";

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

const MYSQL_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS \`_prisma_migrations\` (
  \`id\` VARCHAR(36) PRIMARY KEY NOT NULL,
  \`checksum\` VARCHAR(64) NOT NULL,
  \`finished_at\` DATETIME(3) NULL,
  \`migration_name\` VARCHAR(255) NOT NULL,
  \`logs\` TEXT NULL,
  \`rolled_back_at\` DATETIME(3) NULL,
  \`started_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`applied_steps_count\` INTEGER UNSIGNED NOT NULL DEFAULT 0
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

async function migrationNames(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Migrațiile pentru dialectul URL-ului: `prisma/migrations` (PostgreSQL) sau `prisma/migrations-mysql` alături. */
export function migrationsDirFor(migrationsDir: string, databaseUrl: string): string {
  return gcsDbDialect(databaseUrl) === "mysql" ? path.join(path.dirname(migrationsDir), "migrations-mysql") : migrationsDir;
}

/**
 * Aplică migrațiile SQL care lipsesc, în ordine, fiecare într-o tranzacție (spec §17: migrațiile rulează automat la
 * pornire, cu lock). Echivalent cu `prisma migrate deploy`, dar fără CLI-ul Prisma, care nu există în imaginea de
 * producție (Next.js standalone). `migrationsDir` e folderul PostgreSQL; pentru MySQL se folosește
 * `migrations-mysql` de lângă el.
 */
export async function migrateDatabase(databaseUrl: string, migrationsDir: string): Promise<{ applied: string[] }> {
  if (gcsDbDialect(databaseUrl) === "mysql") return migrateMysql(databaseUrl, migrationsDirFor(migrationsDir, databaseUrl));
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

    for (const name of await migrationNames(migrationsDir)) {
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

/** Împarte un fișier SQL în instrucțiuni (fără `;` în șiruri: migrațiile MySQL nu au corpuri de proceduri). */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\" && quote !== "`") {
        current += sql[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      current += "\n";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    if (ch === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * MySQL / MariaDB: DDL-ul nu e tranzacțional, deci o migrație eșuată la jumătate rămâne marcată „începută” (fără
 * `finished_at`), cu eroarea în `logs`, și se oprește aici (ca `prisma migrate deploy`).
 */
async function migrateMysql(databaseUrl: string, migrationsDir: string): Promise<{ applied: string[] }> {
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: false });
  const applied: string[] = [];
  try {
    const [lock] = await conn.query<import("mysql2").RowDataPacket[]>("SELECT GET_LOCK(?, 600) AS ok", [MYSQL_LOCK]);
    if (Number(lock[0]?.ok) !== 1) throw new Error("Lock-ul migrațiilor nu a putut fi luat");
    await conn.query(MYSQL_MIGRATIONS_TABLE);
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(
      "SELECT migration_name, finished_at FROM `_prisma_migrations` WHERE rolled_back_at IS NULL",
    );
    const finished = new Set(rows.filter((r) => r.finished_at !== null).map((r) => String(r.migration_name)));
    const broken = rows.find((r) => r.finished_at === null);
    if (broken) throw new Error(`Migrația ${String(broken.migration_name)} a rămas neterminată; repar-o manual, apoi șterge rândul din _prisma_migrations`);

    for (const name of await migrationNames(migrationsDir)) {
      if (finished.has(name)) continue;
      const sql = await readFile(path.join(migrationsDir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const id = randomUUID();
      await conn.query("INSERT INTO `_prisma_migrations` (id, checksum, migration_name, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))", [id, checksum, name]);
      try {
        for (const statement of splitSqlStatements(sql)) await conn.query(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await conn.query("UPDATE `_prisma_migrations` SET logs = ? WHERE id = ?", [message, id]).catch(() => {});
        throw new Error(`Migrația ${name} a eșuat: ${message}`, { cause: error });
      }
      await conn.query("UPDATE `_prisma_migrations` SET finished_at = CURRENT_TIMESTAMP(3), applied_steps_count = 1 WHERE id = ?", [id]);
      applied.push(name);
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK(?)", [MYSQL_LOCK]).catch(() => {});
    await conn.end().catch(() => {});
  }
  return { applied };
}
