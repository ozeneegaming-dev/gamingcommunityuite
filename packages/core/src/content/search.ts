import type { Prisma } from "@gcs/db";

type Tx = Prisma.TransactionClient;

/** Configurația de căutare din migrația forumului: dicționarul `romanian` + `unaccent`. */
export const GCS_SEARCH_CONFIG = "gcs_ro";

/**
 * Indexul de căutare full-text (spec §2.1: `tsvector` + `unaccent`). Se actualizează în tranzacția scrierii,
 * deci un topic sau o postare e căutabil imediat după salvare. Titlul are greutatea A, conținutul B.
 */
export class GcsSearchIndex {
  async indexTopic(tx: Tx, topicId: number): Promise<void> {
    await tx.$executeRaw`
      UPDATE topics SET "searchVector" = setweight(to_tsvector('gcs_ro', title), 'A') WHERE id = ${topicId}`;
  }

  async indexPost(tx: Tx, postId: number, text: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE posts SET "searchVector" = setweight(to_tsvector('gcs_ro', ${text}), 'B') WHERE id = ${postId}`;
  }
}
