import { isMysql, Prisma, sql, type PrismaClient } from "@gcs/db";

/**
 * Id-urile din `topics` / `posts` care conțin toți termenii, direct pe indexul de căutare al bazei: PostgreSQL
 * (`gcs_ro`, cu flexiuni) sau MySQL (`FULLTEXT`, fără flexiuni: termenii se caută ca prefix).
 */
export async function ftsIds(db: PrismaClient, table: "topics" | "posts", q: string): Promise<number[]> {
  const rows = isMysql()
    ? await db.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE MATCH(searchText) AGAINST (${q.split(/\s+/).map((w) => `+${w}*`).join(" ")} IN BOOLEAN MODE) ORDER BY id`)
    : await db.$queryRaw<{ id: number }[]>(sql`SELECT id FROM ${Prisma.raw(table)} WHERE "searchVector" @@ plainto_tsquery('gcs_ro', ${q}) ORDER BY id`);
  return rows.map((r) => Number(r.id));
}
