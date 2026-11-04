import type { GcsMemberDataHandler } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsDownloadService } from "./service";

/**
 * Descărcările la ștergerea / unirea unui cont (specul 2026-10-09-stergere-unire-membri). La ștergere, fișierele rămân
 * (ca „Membru șters”) sau, cu „șterge și conținutul”, dispar; recenziile și comentariile urmează aceeași regulă; logul
 * își pierde numele. La unire, totul trece la contul țintă (o recenzie dublă o păstrează pe a țintei).
 */
export function downloadMemberData(deps: { db: PrismaClient; service: GcsDownloadService }): GcsMemberDataHandler {
  const { db, service } = deps;
  return {
    key: "downloads",
    async summary(userId) {
      const [files, reviews, comments, downloads] = await Promise.all([
        db.downloadFile.count({ where: { authorId: userId } }),
        db.downloadReview.count({ where: { userId } }),
        db.downloadComment.count({ where: { authorId: userId } }),
        db.downloadLog.count({ where: { userId } }),
      ]);
      return [
        { key: "downloads.files", count: files },
        { key: "downloads.reviews", count: reviews },
        { key: "downloads.comments", count: comments },
        { key: "downloads.downloads", count: downloads },
      ];
    },
    async erase({ userId, mode, batchSize }) {
      if (mode === "DELETE_CONTENT") {
        const files = await db.downloadFile.findMany({ where: { authorId: userId }, take: Math.max(1, Math.min(batchSize, 20)), include: { versions: { include: { assets: true } } } });
        for (const f of files) await service.purge(f, null);
        if (files.length > 0) return files.length;
        const c = await db.downloadComment.deleteMany({ where: { authorId: userId } });
        const r = await db.downloadReview.findMany({ where: { userId }, select: { id: true, fileId: true } });
        for (const row of r) await db.downloadReview.delete({ where: { id: row.id } });
        if (c.count + r.length > 0) return c.count + r.length;
      } else {
        const f = await db.downloadFile.updateMany({ where: { authorId: userId }, data: { authorId: null } });
        const c = await db.downloadComment.updateMany({ where: { authorId: userId }, data: { authorId: null } });
        // Recenziile au nevoie de un membru (una pe membru): dispar odată cu contul.
        const r = await db.downloadReview.deleteMany({ where: { userId } });
        if (f.count + c.count + r.count > 0) return f.count + c.count + r.count;
      }
      const assets = await db.downloadAsset.updateMany({ where: { uploaderId: userId }, data: { uploaderId: null } });
      const logs = await db.downloadLog.updateMany({ where: { userId }, data: { userId: null } });
      const versions = await db.downloadVersion.updateMany({ where: { createdById: userId }, data: { createdById: null } });
      return assets.count + logs.count + versions.count;
    },
    async merge({ sourceId, targetId }) {
      const dup = await db.downloadReview.findMany({ where: { userId: sourceId }, select: { id: true, fileId: true } });
      const theirs = new Set((await db.downloadReview.findMany({ where: { userId: targetId, fileId: { in: dup.map((d) => d.fileId) } }, select: { fileId: true } })).map((r) => r.fileId));
      let n = 0;
      for (const r of dup) {
        if (theirs.has(r.fileId)) await db.downloadReview.delete({ where: { id: r.id } });
        else await db.downloadReview.update({ where: { id: r.id }, data: { userId: targetId } });
        n++;
      }
      const updates = await Promise.all([
        db.downloadFile.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } }),
        db.downloadComment.updateMany({ where: { authorId: sourceId }, data: { authorId: targetId } }),
        db.downloadAsset.updateMany({ where: { uploaderId: sourceId }, data: { uploaderId: targetId } }),
        db.downloadLog.updateMany({ where: { userId: sourceId }, data: { userId: targetId } }),
        db.downloadVersion.updateMany({ where: { createdById: sourceId }, data: { createdById: targetId } }),
      ]);
      return n + updates.reduce((s, u) => s + u.count, 0);
    },
    async export(userId) {
      const [files, reviews, comments] = await Promise.all([
        db.downloadFile.findMany({ where: { authorId: userId }, select: { id: true, title: true, summary: true, status: true, createdAt: true } }),
        db.downloadReview.findMany({ where: { userId }, select: { fileId: true, rating: true, bodyHtml: true, createdAt: true } }),
        db.downloadComment.findMany({ where: { authorId: userId }, select: { fileId: true, bodyHtml: true, createdAt: true } }),
      ]);
      return { files, reviews, comments };
    },
  };
}
