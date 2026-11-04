import type { GcsMemberDataHandler } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsPagesRecords } from "./records";
import { PAGES_FOLLOW_TYPE } from "./notify";

/**
 * Datele aplicației Pagini la ștergerea / unirea unui cont: înregistrările și comentariile membrului (păstrate ca
 * „Membru șters” sau șterse, după modul ales), urmăririle bazelor și numele din revizii. La unire, totul trece la țintă.
 */
export function pagesMemberData(deps: { db: PrismaClient; records: Pick<GcsPagesRecords, "deleteAsSystem"> }): GcsMemberDataHandler {
  const { db, records } = deps;
  return {
    key: "pages",
    async summary(userId) {
      const [recordsCount, comments] = await Promise.all([db.pagesRecord.count({ where: { authorId: userId } }), db.pagesComment.count({ where: { authorId: userId } })]);
      return [
        { key: "pages.records", count: recordsCount },
        { key: "pages.comments", count: comments },
      ];
    },
    async erase({ userId, mode, batchSize }) {
      if (mode === "DELETE_CONTENT") {
        const rows = await db.pagesRecord.findMany({ where: { authorId: userId }, select: { id: true }, take: batchSize });
        for (const r of rows) await records.deleteAsSystem(r.id);
        if (rows.length > 0) return rows.length;
        const comments = await db.pagesComment.findMany({ where: { authorId: userId }, select: { id: true, recordId: true, hidden: true, pending: true }, take: batchSize });
        for (const c of comments) {
          await db.$transaction([
            db.pagesComment.delete({ where: { id: c.id } }),
            ...(c.hidden || c.pending ? [] : [db.pagesRecord.update({ where: { id: c.recordId }, data: { commentsCount: { decrement: 1 } } })]),
          ]);
        }
        if (comments.length > 0) return comments.length;
      } else {
        const [r, c] = await Promise.all([
          db.pagesRecord.updateMany({ where: { authorId: userId }, data: { authorId: null } }),
          db.pagesComment.updateMany({ where: { authorId: userId }, data: { authorId: null } }),
        ]);
        if (r.count + c.count > 0) return r.count + c.count;
      }
      const [rev, edits, follows] = await Promise.all([
        db.pagesRecordRevision.updateMany({ where: { actorId: userId }, data: { actorId: null } }),
        db.pagesRecord.updateMany({ where: { editedById: userId }, data: { editedById: null } }),
        db.follow.deleteMany({ where: { userId, contentType: PAGES_FOLLOW_TYPE } }),
      ]);
      return rev.count + edits.count + follows.count;
    },
    async merge({ sourceId, targetId }) {
      const [r, c, rev, edits] = await Promise.all([
        db.pagesRecord.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } }),
        db.pagesComment.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } }),
        db.pagesRecordRevision.updateMany({ where: { actorId: sourceId }, data: { actorId: targetId } }),
        db.pagesRecord.updateMany({ where: { editedById: sourceId }, data: { editedById: targetId } }),
      ]);
      // Urmăririle: cele pe care ținta nu le are trec la ea, restul se șterg.
      const own = new Set((await db.follow.findMany({ where: { userId: targetId, contentType: PAGES_FOLLOW_TYPE }, select: { contentId: true } })).map((f) => f.contentId));
      const src = await db.follow.findMany({ where: { userId: sourceId, contentType: PAGES_FOLLOW_TYPE }, select: { id: true, contentId: true } });
      for (const f of src) {
        if (own.has(f.contentId)) await db.follow.delete({ where: { id: f.id } });
        else await db.follow.update({ where: { id: f.id }, data: { userId: targetId } });
      }
      return r.count + c.count + rev.count + edits.count + src.length;
    },
    async export(userId) {
      const [recordsList, comments] = await Promise.all([
        db.pagesRecord.findMany({ where: { authorId: userId }, select: { id: true, title: true, status: true, createdAt: true, databaseId: true } }),
        db.pagesComment.findMany({ where: { authorId: userId }, select: { id: true, recordId: true, contentHtml: true, createdAt: true } }),
      ]);
      return { records: recordsList, comments };
    },
  };
}
