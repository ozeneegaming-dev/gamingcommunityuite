import { Prisma, sqlIn, sqlTs, type PrismaClient } from "@gcs/db";
import type { GcsSearchBackend, GcsSearchHit, GcsSearchQuery } from "./search";

type Tx = Prisma.TransactionClient;

const SNIPPET_WORDS = 35;

/** Fără diacritice și cu litere mici: „Ștefan” și „stefan” sunt același cuvânt (ca `unaccent` + colația MySQL). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Interogarea în modul boolean al `FULLTEXT`: fiecare cuvânt e obligatoriu și se potrivește și ca prefix (`+cuv*`),
 * frazele între ghilimele rămân fraze, `-cuv` exclude (ca `websearch_to_tsquery`). Caracterele speciale ale modului
 * boolean se scot din cuvinte.
 */
export function mysqlBooleanQuery(q: string): { query: string; terms: string[] } {
  const terms: string[] = [];
  const parts: string[] = [];
  for (const m of q.matchAll(/(-?)"([^"]+)"|(-?)([^\s"]+)/g)) {
    const phrase = m[2];
    if (phrase !== undefined) {
      const clean = phrase.replace(/[+\-<>()~*"@]/g, " ").trim();
      if (!clean) continue;
      parts.push(`${m[1] ? "-" : "+"}"${clean}"`);
      if (!m[1]) terms.push(...clean.split(/\s+/));
      continue;
    }
    const word = (m[4] ?? "").replace(/[+\-<>()~*"@]/g, "");
    if (!word) continue;
    if (m[3]) parts.push(`-${word}`);
    else {
      parts.push(`+${word}*`);
      terms.push(word);
    }
  }
  return { query: parts.join(" "), terms };
}

/** Fragmentul în jurul primului termen găsit, cu termenii în `<mark>` (textul e simplu, deci se escapează). */
export function mysqlSnippet(text: string, terms: string[]): string {
  const words = text.split(/\s+/).filter(Boolean);
  const wanted = terms.map(fold).filter(Boolean);
  const hit = (w: string) => wanted.some((t) => fold(w).replace(/[^\p{L}\p{N}]/gu, "").startsWith(t));
  const first = Math.max(0, words.findIndex(hit));
  const start = Math.max(0, first - 5);
  const slice = words.slice(start, start + SNIPPET_WORDS);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = slice.map((w) => (hit(w) ? `<mark>${esc(w)}</mark>` : esc(w))).join(" ");
  return `${start > 0 ? "… " : ""}${body}${start + SNIPPET_WORDS < words.length ? " …" : ""}`;
}

/**
 * MySQL / MariaDB (ediția Lite): textul simplu în coloanele `searchText` (titlul topicului, conținutul postării), cu
 * index `FULLTEXT`; colația `utf8mb4_unicode_ci` ignoră diacriticele și majusculele. Diferențe față de PostgreSQL:
 * fără flexiuni (doar potrivire de prefix), cuvintele sub 3 litere și cele foarte comune nu se indexează, ordonarea
 * după scorul MySQL.
 */
export class GcsMysqlSearchBackend implements GcsSearchBackend {
  readonly dialect = "mysql" as const;

  async indexTopic(tx: Tx, topicId: number): Promise<void> {
    await tx.$executeRaw`UPDATE topics SET searchText = title WHERE id = ${topicId}`;
  }

  async indexPost(tx: Tx, postId: number, text: string): Promise<void> {
    await tx.$executeRaw`UPDATE posts SET searchText = ${text} WHERE id = ${postId}`;
  }

  async search(db: PrismaClient, input: GcsSearchQuery): Promise<{ total: number; hits: GcsSearchHit[] }> {
    const { query, terms } = mysqlBooleanQuery(input.q);
    if (!query || input.forumIds.length === 0) return { total: 0, hits: [] };
    const filters: Prisma.Sql[] = [];
    if (input.authorId) filters.push(Prisma.sql`AND p.authorId = ${input.authorId}`);
    if (input.since) filters.push(Prisma.sql`AND p.createdAt >= ${sqlTs(input.since)}`);
    const extra = filters.length > 0 ? Prisma.join(filters, " ") : Prisma.empty;
    const postMatch = Prisma.sql`MATCH(p.searchText) AGAINST (${query} IN BOOLEAN MODE)`;
    const topicMatch = Prisma.sql`MATCH(t.searchText) AGAINST (${query} IN BOOLEAN MODE)`;
    const match = input.type === "topics" ? Prisma.sql`p.id = t.firstPostId AND (${topicMatch} OR ${postMatch})` : postMatch;
    const score = input.type === "topics" ? Prisma.sql`(${topicMatch} * 2 + ${postMatch})` : postMatch;
    const base = Prisma.sql`
      FROM posts p
      JOIN topics t ON t.id = p.topicId
      JOIN forums f ON f.id = t.forumId
      WHERE ${match}
        AND p.visibility = 'VISIBLE' AND t.visibility = 'VISIBLE'
        AND t.forumId IN (${sqlIn(input.forumIds)})
        ${extra}`;
    const [countRows, rows] = await Promise.all([
      db.$queryRaw<{ total: bigint | number }[]>`SELECT count(*) AS total ${base}`,
      db.$queryRaw<(Omit<GcsSearchHit, "snippet"> & { text: string | null })[]>`
        SELECT t.id AS topicId, t.title AS topicTitle, t.slug AS topicSlug, p.id AS postId,
               f.id AS forumId, f.name AS forumName, p.authorId AS authorId, p.createdAt AS createdAt, p.searchText AS text
        ${base}
        ORDER BY ${score} DESC, p.createdAt DESC
        LIMIT ${input.limit} OFFSET ${input.offset}`,
    ]);
    return {
      total: Number(countRows[0]?.total ?? 0),
      hits: rows.map(({ text, ...r }) => ({ ...r, snippet: mysqlSnippet(text ?? "", terms) })),
    };
  }
}
