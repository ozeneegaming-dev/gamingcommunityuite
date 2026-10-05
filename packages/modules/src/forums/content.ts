import type { GcsActor, GcsAttachmentService, GcsReactionService, GcsReportService } from "@gcs/core";
import { forumContainer, POST_CONTENT_TYPE, type GcsForumPosting } from "./posting";
import type { GcsPostService } from "./posts";

/**
 * Cine vede o postare (aceeași regulă ca în `GcsForumQueries.topic`): cine citește forumul vede postările vizibile
 * din topicuri vizibile; autorul își vede postările în așteptare; moderatorii văd tot.
 */
export async function canViewPost(posting: GcsForumPosting, actor: GcsActor, postId: number): Promise<boolean> {
  const { db, permissions } = posting.deps;
  if (!Number.isSafeInteger(postId)) return false;
  const post = await db.post.findUnique({ where: { id: postId }, select: { authorId: true, visibility: true, topic: { select: { forumId: true, visibility: true } } } });
  if (!post || !(await permissions.can(actor, "forums.read", forumContainer(post.topic.forumId)))) return false;
  if (post.visibility === "VISIBLE" && post.topic.visibility === "VISIBLE") return true;
  if (post.visibility === "PENDING" && actor.userId !== null && actor.userId === post.authorId) return true;
  return (await permissions.moderatorPowers(actor, forumContainer(post.topic.forumId))).length > 0 || (await permissions.can(actor, "forums.moderate_all"));
}

/** Înregistrează postările forumului la serviciile de conținut comune (reacții, rapoarte, descărcarea atașamentelor). */
export function registerForumContent(
  posting: GcsForumPosting,
  services: { reactions: GcsReactionService; attachments: GcsAttachmentService; reports: GcsReportService; posts: GcsPostService },
): void {
  const { db } = posting.deps;
  const forumOf = async (id: string) => (await db.post.findUnique({ where: { id: Number(id) }, select: { topic: { select: { forumId: true } } } }))?.topic.forumId;
  services.reports.registerContent(POST_CONTENT_TYPE, {
    canView: (actor, id) => canViewPost(posting, actor, Number(id)),
    canModerate: async (actor, id) => {
      const forumId = await forumOf(id);
      return forumId !== undefined && (await posting.isModerator(actor, "hide", forumId));
    },
    hide: (actor, id, reason) => services.posts.hide(actor, Number(id), reason),
  });
  services.reactions.registerContent(POST_CONTENT_TYPE, {
    author: async (id) => (await db.post.findUnique({ where: { id: Number(id) }, select: { authorId: true } }))?.authorId ?? null,
    canView: (actor, id) => canViewPost(posting, actor, Number(id)),
    tags: async (id) => {
      const post = await db.post.findUnique({ where: { id: Number(id) }, select: { topicId: true } });
      return post ? [`topic:${post.topicId}`] : [];
    },
  });
  services.attachments.registerAccess(POST_CONTENT_TYPE, async (actor, id) => {
    const postId = Number(id);
    if (!(await canViewPost(posting, actor, postId))) return false;
    const post = await db.post.findUnique({ where: { id: postId }, select: { topic: { select: { forumId: true } } } });
    return post !== null && (await posting.deps.permissions.can(actor, "forums.download", forumContainer(post.topic.forumId)));
  });
}
