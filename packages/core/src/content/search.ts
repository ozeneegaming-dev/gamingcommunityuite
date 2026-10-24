import { gcsDbDialect, Prisma, type GcsDbDialect, type PrismaClient } from "@gcs/db";

type Tx = Prisma.TransactionClient;

/** Configurația de căutare din migrația forumului: dicționarul `romanian` + `unaccent`. */
export const GCS_SEARCH_CONFIG = "gcs_ro";

/** O căutare în forum: doar conținutul vizibil din forumurile date (deja filtrate pe permisiuni). */
export type GcsSearchQuery = {
  q: string;
  type: "topics" | "posts";
  forumIds: number[];
  authorId?: string;
  since?: Date;
  limit: number;
  offset: number;
};

/** Un rezultat: topicul, postarea găsită (sau prima, la topicuri) și fragmentul cu termenii în `<mark>`. */
export type GcsSearchHit = {
  topicId: number;
  topicTitle: string;
  topicSlug: string;
  postId: number;
  forumId: number;
  forumName: string;
  authorId: string | null;
  createdAt: Date;
  snippet: string;
};

/**
 * Căutarea full-text, în spatele unui driver: PostgreSQL (`tsvector` + `unaccent` + dicționarul românesc) sau MySQL
 * (`FULLTEXT`, ediția Lite). Indexul se actualizează în tranzacția scrierii, deci conținutul e căutabil imediat.
 */
export interface GcsSearchBackend {
  readonly dialect: GcsDbDialect;
  indexTopic(tx: Tx, topicId: number): Promise<void>;
  indexPost(tx: Tx, postId: number, text: string): Promise<void>;
  search(db: PrismaClient, query: GcsSearchQuery): Promise<{ total: number; hits: GcsSearchHit[] }>;
}

const HEADLINE = "StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter= … ";

/** PostgreSQL: `tsvector` cu greutăți (titlul A, conținutul B), `websearch_to_tsquery`, `ts_rank` și `ts_headline`. */
export class GcsPgSearchBackend implements GcsSearchBackend {
  readonly dialect = "postgresql" as const;

  async indexTopic(tx: Tx, topicId: number): Promise<void> {
    await tx.$executeRaw`
      UPDATE topics SET "searchVector" = setweight(to_tsvector('gcs_ro', title), 'A') WHERE id = ${topicId}`;
  }

  async indexPost(tx: Tx, postId: number, text: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE posts SET "searchVector" = setweight(to_tsvector('gcs_ro', ${text}), 'B') WHERE id = ${postId}`;
  }

  async search(db: PrismaClient, input: GcsSearchQuery): Promise<{ total: number; hits: GcsSearchHit[] }> {
    const filters: Prisma.Sql[] = [];
    if (input.authorId) filters.push(Prisma.sql`AND p."authorId" = ${input.authorId}`);
    if (input.since) filters.push(Prisma.sql`AND p."createdAt" >= ${input.since.toISOString().slice(0, -1)}::timestamp`);
    const extra = filters.length > 0 ? Prisma.join(filters, " ") : Prisma.empty;
    const query = Prisma.sql`websearch_to_tsquery('gcs_ro', ${input.q})`;
    // La topicuri: titlul sau prima postare; la postări: orice postare vizibilă.
    const match =
      input.type === "topics"
        ? Prisma.sql`p.id = t."firstPostId" AND (t."searchVector" @@ ${query} OR p."searchVector" @@ ${query})`
        : Prisma.sql`p."searchVector" @@ ${query}`;
    const rank =
      input.type === "topics"
        ? Prisma.sql`ts_rank(coalesce(t."searchVector", ''::tsvector) || coalesce(p."searchVector", ''::tsvector), ${query})`
        : Prisma.sql`ts_rank(p."searchVector", ${query})`;
    const base = Prisma.sql`
      FROM posts p
      JOIN topics t ON t.id = p."topicId"
      JOIN forums f ON f.id = t."forumId"
      WHERE ${match}
        AND p.visibility = 'VISIBLE' AND t.visibility = 'VISIBLE'
        AND t."forumId" = ANY(${input.forumIds})
        ${extra}`;
    const [countRows, rows] = await Promise.all([
      db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${base}`,
      db.$queryRaw<GcsSearchHit[]>`
        SELECT t.id AS "topicId", t.title AS "topicTitle", t.slug AS "topicSlug", p.id AS "postId",
               f.id AS "forumId", f.name AS "forumName", p."authorId", p."createdAt",
               ts_headline('gcs_ro', regexp_replace(p."contentHtml", '<[^>]*>', ' ', 'g'), ${query}, ${HEADLINE}) AS snippet
        ${base}
        ORDER BY ${rank} DESC, p."createdAt" DESC
        LIMIT ${input.limit} OFFSET ${input.offset}`,
    ]);
    return { total: Number(countRows[0]?.total ?? 0), hits: rows };
  }
}

const backends = new Map<GcsDbDialect, GcsSearchBackend>();

/** Driverul de căutare pentru dialectul bazei (MySQL se înregistrează cu `registerSearchBackend`). */
export function searchBackend(dialect: GcsDbDialect = gcsDbDialect()): GcsSearchBackend {
  const found = backends.get(dialect) ?? (dialect === "postgresql" ? new GcsPgSearchBackend() : undefined);
  if (!found) throw new Error(`Căutarea nu are driver pentru ${dialect}`);
  return found;
}

export function registerSearchBackend(backend: GcsSearchBackend): void {
  backends.set(backend.dialect, backend);
}

/**
 * Indexul de căutare full-text (spec §2.1), folosit de scrieri (postare, editare, import, seed): delegă driverului
 * dialectului curent.
 */
export class GcsSearchIndex {
  constructor(private readonly backend?: GcsSearchBackend) {}

  private get driver(): GcsSearchBackend {
    return this.backend ?? searchBackend();
  }

  async indexTopic(tx: Tx, topicId: number): Promise<void> {
    await this.driver.indexTopic(tx, topicId);
  }

  async indexPost(tx: Tx, postId: number, text: string): Promise<void> {
    await this.driver.indexPost(tx, postId, text);
  }
}
