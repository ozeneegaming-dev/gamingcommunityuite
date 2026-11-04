import { contentRefs, type GcsActorResolver, type GcsEventBus, type GcsNotificationService, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsPagesAccess } from "./access";
import type { GcsPagesQueries } from "./queries";
import { PAGES_COMMENT_TYPE, PAGES_NOTICE_TYPE, PAGES_RECORD_TYPE } from "./shared";

/** Urmărirea unei baze de date (butonul „Urmărește” de pe pagina ei): înregistrările noi ajung la urmăritori. */
export const PAGES_FOLLOW_TYPE = "pages.database";
const MAX_FOLLOWERS = 500;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const nums = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []);

/**
 * Notificările aplicației Pagini: trimiterile în așteptare (staff-ul), decizia (autorul), comentariile noi pe
 * înregistrarea ta, mențiunile din înregistrări și comentarii (prin `mentions.created`, ca peste tot), înregistrările
 * noi din bazele urmărite; plus publicarea automată ca topic în forumul bazei (`publishTopic`).
 */
export function registerPagesNotifications(deps: {
  db: PrismaClient;
  bus: GcsEventBus;
  notifications: GcsNotificationService;
  settings: GcsSettingsService;
  access: GcsPagesAccess;
  queries: GcsPagesQueries;
  actors: GcsActorResolver;
  /** Publică înregistrarea ca topic în forumul bazei ei (legătura cu forumul), dacă baza are un forum. */
  publishTopic?: (recordId: number) => Promise<void>;
}): void {
  const { db, bus, notifications, settings, access, queries, actors } = deps;
  notifications.registerTarget(PAGES_RECORD_TYPE, {
    canView: async (userId, id) => queries.canViewRecord(await actors.forUser(userId, ""), Number(id)),
    describe: async (id) => {
      const link = await queries.recordLink(Number(id));
      return link ? { title: link.title, href: link.href } : null;
    },
  });
  notifications.registerTarget(PAGES_COMMENT_TYPE, {
    canView: async (userId, id) => {
      const c = await db.pagesComment.findUnique({ where: { id: Number(id) }, select: { recordId: true, hidden: true } });
      return !!c && !c.hidden && queries.canViewRecord(await actors.forUser(userId, ""), c.recordId);
    },
    describe: async (id) => {
      const c = await db.pagesComment.findUnique({ where: { id: Number(id) }, select: { id: true, recordId: true } });
      const link = c ? await queries.recordLink(c.recordId) : null;
      return link && c ? { title: link.title, href: `${link.href}#comment-${c.id}` } : null;
    },
  });
  // Înregistrarea respinsă sau ștearsă: textul și linkul vin din notificare.
  notifications.registerTarget(PAGES_NOTICE_TYPE, { canView: async () => true, describe: async () => ({ title: "", href: "/pages" }) });

  /** Mențiunile din conținut (membrii și grupurile), prin notificarea comună. */
  const mentions = async (targetType: string, targetId: string, authorId: string | null, userIds: string[], groupIds: number[]) => {
    if (userIds.length === 0 && groupIds.length === 0) return;
    await bus.emit({ name: "mentions.created", payload: { targetType, targetId, authorId, userIds, groupIds }, tags: [] });
  };

  /** O înregistrare tocmai publicată: mențiunile, urmăritorii bazei și topicul din forum. */
  const published = async (recordId: number, databaseId: number, authorId: string | null) => {
    const r = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { contentJson: true } });
    const refs = contentRefs(r?.contentJson ?? null);
    await mentions(PAGES_RECORD_TYPE, String(recordId), authorId, refs.mentions.filter((id) => id !== authorId), refs.groups);
    const followers = (await db.follow.findMany({ where: { contentType: PAGES_FOLLOW_TYPE, contentId: String(databaseId) }, select: { userId: true }, take: MAX_FOLLOWERS })).map((f) => f.userId).filter((id) => id !== authorId && !refs.mentions.includes(id));
    if (followers.length > 0) await notifications.notify({ userIds: followers, type: "pages.followed", targetType: PAGES_RECORD_TYPE, targetId: String(recordId), actorId: authorId });
    if (deps.publishTopic) await deps.publishTopic(recordId).catch((error) => console.error(`[GCS] pages topic ${recordId}:`, error));
  };

  bus.on("pages.record.created", async (e) => {
    const recordId = Number(e.payload.recordId);
    const databaseId = Number(e.payload.databaseId);
    const authorId = str(e.payload.authorId);
    if (e.payload.status === "PUBLISHED") {
      await published(recordId, databaseId, authorId);
      return;
    }
    if (e.payload.status !== "PENDING" || !(await settings.get<boolean>("pages.notify_staff"))) return;
    const staff = (await access.moderatorIds()).filter((id) => id !== authorId);
    if (staff.length > 0) await notifications.notify({ userIds: staff, type: "pages.submission", targetType: PAGES_RECORD_TYPE, targetId: String(recordId), actorId: authorId, data: { kind: "record" } });
  });

  bus.on("pages.record.reviewed", async (e) => {
    const recordId = Number(e.payload.recordId);
    const authorId = str(e.payload.authorId);
    const decision = str(e.payload.decision);
    if (!authorId || !decision) return;
    if (decision === "approve") {
      await notifications.notify({ userIds: [authorId], type: "pages.review", targetType: PAGES_RECORD_TYPE, targetId: String(recordId), actorId: null, data: { kind: "approved" } });
      await published(recordId, Number(e.payload.databaseId), authorId);
    } else {
      await notifications.notify({
        userIds: [authorId],
        type: "pages.review",
        targetType: PAGES_NOTICE_TYPE,
        targetId: String(recordId),
        actorId: null,
        data: { kind: "rejected", title: str(e.payload.title) ?? "", reason: str(e.payload.reason) ?? "" },
      });
    }
  });

  bus.on("pages.comment.created", async (e) => {
    const commentId = String(e.payload.commentId);
    const authorId = str(e.payload.authorId);
    const recordAuthorId = str(e.payload.recordAuthorId);
    const mentioned = ids(e.payload.mentions).filter((id) => id !== authorId);
    await mentions(PAGES_COMMENT_TYPE, commentId, authorId, mentioned, nums(e.payload.groupMentions));
    if (recordAuthorId && recordAuthorId !== authorId && !mentioned.includes(recordAuthorId) && (await settings.get<boolean>("pages.notify_author"))) {
      await notifications.notify({ userIds: [recordAuthorId], type: "pages.comment", targetType: PAGES_COMMENT_TYPE, targetId: commentId, actorId: authorId });
    }
  });

  bus.on("pages.comment.pending", async (e) => {
    if (!(await settings.get<boolean>("pages.notify_staff"))) return;
    const authorId = str(e.payload.authorId);
    const staff = (await access.moderatorIds()).filter((id) => id !== authorId);
    if (staff.length > 0) await notifications.notify({ userIds: staff, type: "pages.submission", targetType: PAGES_RECORD_TYPE, targetId: String(e.payload.recordId), actorId: authorId, data: { kind: "comment" } });
  });
}
