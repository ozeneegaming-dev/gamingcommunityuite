import type { GcsAcpRoleService, GcsActorResolver, GcsEventBus, GcsFollowService, GcsNotificationService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsDownloadQueries } from "./queries";
import { DOWNLOAD_FILE_CONTENT, DOWNLOADS_ACP, downloadFileHref } from "./text";

/** Ținta notificărilor despre un fișier existent (vede notificarea cine vede fișierul). */
export const DOWNLOAD_TARGET = "downloads.file";
/** Ținta notificărilor despre ceva ce membrul nu mai poate deschide (respins, blocat): textul vine din notificare. */
export const DOWNLOAD_NOTICE_TARGET = "downloads.notice";
/** Alertele staff-ului (antivirusul, coada): linkul duce în ACP. */
export const DOWNLOAD_STAFF_TARGET = "downloads.staff";

const str = (v: unknown) => (typeof v === "string" ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Notificările Descărcărilor: autorul (aprobat / respins / blocat de antivirus, recenzii și comentarii noi), urmăritorii
 * (o versiune nouă), cei menționați și staff-ul (fișiere noi în coadă, fișiere infectate). Toate trec prin serviciul de
 * notificări, cu preferințele fiecărui membru.
 */
export function registerDownloadNotifications(deps: {
  db: PrismaClient;
  bus: GcsEventBus;
  notifications: GcsNotificationService;
  queries: GcsDownloadQueries;
  actors: GcsActorResolver;
  follows: GcsFollowService;
  acp: GcsAcpRoleService;
}): void {
  const { db, bus, notifications, queries, actors, follows, acp } = deps;
  notifications.registerTarget(DOWNLOAD_TARGET, {
    canView: async (userId, id) => queries.canViewFile(await actors.forUser(userId, ""), Number(id)),
    describe: async (id) => {
      const f = await db.downloadFile.findUnique({ where: { id: Number(id) }, select: { id: true, title: true, slug: true, summary: true } });
      return f ? { title: f.title, href: downloadFileHref(f), snippet: f.summary.slice(0, 140) } : null;
    },
  });
  notifications.registerTarget(DOWNLOAD_NOTICE_TARGET, { canView: async () => true, describe: async () => ({ title: "", href: "/downloads/mine" }) });
  notifications.registerTarget(DOWNLOAD_STAFF_TARGET, { canView: async () => true, describe: async (id) => ({ title: "", href: id === "antivirus" ? "/admin/community/downloads/antivirus" : "/admin/community/downloads/queue" }) });

  bus.on("downloads.reviewed", async (e) => {
    const authorId = str(e.payload.authorId);
    const kind = str(e.payload.kind);
    const fileId = String(e.payload.fileId);
    const title = str(e.payload.title) ?? "";
    if (kind === "queued") {
      const staff = (await acp.usersWith(DOWNLOADS_ACP.queue, "edit")).filter((id) => id !== authorId);
      if (staff.length > 0) await notifications.notify({ userIds: staff, type: "downloads.queue", targetType: DOWNLOAD_STAFF_TARGET, targetId: "queue", actorId: authorId, data: { title } });
      return;
    }
    if (!authorId || !kind) return;
    await notifications.notify({ userIds: [authorId], type: "downloads.review", targetType: DOWNLOAD_NOTICE_TARGET, targetId: fileId, actorId: null, data: { kind, reason: str(e.payload.reason) ?? "", title } });
  });
  bus.on("downloads.published", async (e) => {
    const fileId = String(e.payload.fileId);
    const authorId = str(e.payload.authorId);
    const approverId = str(e.payload.approverId);
    if (authorId && approverId && approverId !== authorId) {
      await notifications.notify({ userIds: [authorId], type: "downloads.review", targetType: DOWNLOAD_TARGET, targetId: fileId, actorId: null, data: { kind: "approved" } });
    }
    if (e.payload.first) {
      // Urmăritorii categoriei: un fișier nou.
      const followers = (await follows.followers("downloads.category", String(e.payload.categoryId))).filter((id) => id !== authorId);
      if (followers.length > 0) await notifications.notify({ userIds: followers, type: "downloads.new_file", targetType: DOWNLOAD_TARGET, targetId: fileId, actorId: authorId });
      return;
    }
    const followers = (await follows.followers(DOWNLOAD_FILE_CONTENT, fileId)).filter((id) => id !== authorId);
    if (followers.length > 0) await notifications.notify({ userIds: followers, type: "downloads.version", targetType: DOWNLOAD_TARGET, targetId: fileId, actorId: authorId, data: { label: str(e.payload.label) ?? "" } });
  });
  bus.on("downloads.reviewed_by", async (e) => {
    const authorId = str(e.payload.authorId);
    if (!authorId || authorId === str(e.payload.userId)) return;
    await notifications.notify({ userIds: [authorId], type: "downloads.feedback", targetType: DOWNLOAD_TARGET, targetId: String(e.payload.fileId), actorId: str(e.payload.userId), data: { kind: "review", rating: Number(e.payload.rating) || 0 } });
  });
  bus.on("downloads.commented", async (e) => {
    const fileId = String(e.payload.fileId);
    const userId = str(e.payload.userId);
    const recipients = new Set(await follows.followers(DOWNLOAD_FILE_CONTENT, fileId));
    const authorId = str(e.payload.authorId);
    if (authorId) recipients.add(authorId);
    if (userId) recipients.delete(userId);
    if (recipients.size > 0) await notifications.notify({ userIds: [...recipients], type: "downloads.feedback", targetType: DOWNLOAD_TARGET, targetId: fileId, actorId: userId, data: { kind: "comment" } });
  });
  bus.on("downloads.mentioned", async (e) => {
    const userIds = ids(e.payload.userIds);
    if (userIds.length > 0) await notifications.notify({ userIds, type: "downloads.mention", targetType: DOWNLOAD_TARGET, targetId: String(e.payload.fileId), actorId: str(e.payload.authorId) });
  });
  bus.on("downloads.infected", async (e) => {
    const uploaderId = str(e.payload.uploaderId);
    const name = str(e.payload.name) ?? "";
    const signature = str(e.payload.signature) ?? "";
    if (uploaderId) await notifications.notify({ userIds: [uploaderId], type: "downloads.review", targetType: DOWNLOAD_NOTICE_TARGET, targetId: String(e.payload.assetId), actorId: null, data: { kind: "blocked", title: name } });
    const staff = await acp.usersWith(DOWNLOADS_ACP.antivirus, "view");
    if (staff.length > 0) await notifications.notify({ userIds: staff, type: "downloads.infected", targetType: DOWNLOAD_STAFF_TARGET, targetId: "antivirus", actorId: uploaderId, data: { title: name, signature }, important: true });
  });
}
