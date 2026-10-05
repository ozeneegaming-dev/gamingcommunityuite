import path from "node:path";

/**
 * Folderul cu migrațiile SQL (`packages/db/prisma/migrations`). Next.js rulează cu directorul curent
 * `apps/web` (și în imaginea standalone, unde `server.js` face `chdir`), deci calea relativă e aceeași.
 */
export function migrationsDir(): string {
  return process.env.GCS_MIGRATIONS_DIR ?? path.resolve(process.cwd(), "../../packages/db/prisma/migrations");
}
