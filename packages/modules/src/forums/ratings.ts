import type { GcsActor, GcsContentRatingService, GcsPermissionService, GcsRatingDenial, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { forumContainer, type GcsForumPosting } from "./posting";
import type { GcsForumQueries } from "./queries";

/** Tipul de conținut al topicurilor în serviciul generic de note. */
export const TOPIC_RATING_TYPE = "forums.topic";

/**
 * Nota cu stele a topicurilor (Forum v2): pornită per forum (opțiunea „Nota cu stele”), cu grupurile care pot nota în
 * matricea forumului (`forums.rate`), schimbarea votului, nota pe propriul topic, vechimea contului și postările minime
 * din setările globale. Media și numărul voturilor se copiază pe topic (sortarea și filtrul „4★+”).
 */
export function registerTopicRatings(
  ratings: GcsContentRatingService,
  deps: { db: PrismaClient; permissions: GcsPermissionService; settings: GcsSettingsService; posting: GcsForumPosting; queries: GcsForumQueries },
): void {
  const { db, permissions, settings, posting, queries } = deps;
  const topicOf = (id: string) =>
    /^\d{1,10}$/.test(id) ? db.topic.findUnique({ where: { id: Number(id) }, select: { id: true, forumId: true, authorId: true, archivedAt: true, visibility: true, forum: { select: { ratingEnabled: true } } } }) : Promise.resolve(null);

  ratings.register(TOPIC_RATING_TYPE, {
    canView: async (actor, id) => /^\d{1,10}$/.test(id) && (await queries.topicAccess(actor, Number(id))).canRead,
    check: async (actor: GcsActor, id: string): Promise<GcsRatingDenial | null> => {
      if (!actor.userId) return "guest";
      const topic = await topicOf(id);
      if (!topic || !topic.forum.ratingEnabled || topic.archivedAt || topic.visibility !== "VISIBLE") return "disabled";
      if (!(await permissions.can(actor, "forums.rate", forumContainer(topic.forumId)))) return "no_permission";
      const [own, minDays, minPosts] = await Promise.all([
        settings.get<boolean>("forums.rating_own"),
        settings.get<number>("forums.rating_min_age_days"),
        settings.get<number>("forums.rating_min_posts"),
      ]);
      if (topic.authorId === actor.userId && !own) return "own_content";
      if (minDays > 0 || minPosts > 0) {
        const user = await db.user.findUnique({ where: { id: actor.userId }, select: { createdAt: true, postsCount: true } });
        if (!user) return "guest";
        if (minDays > 0 && Date.now() - user.createdAt.getTime() < minDays * 86_400_000) return "account_too_new";
        if (minPosts > 0 && user.postsCount < minPosts) return "not_enough_posts";
      }
      return null;
    },
    changeVote: () => settings.get<boolean>("forums.rating_change_vote"),
    canModerate: async (actor, id) => {
      const topic = await topicOf(id);
      return topic !== null && (await posting.isModerator(actor, "edit", topic.forumId));
    },
    onChange: async (tx, id, summary) => {
      await tx.topic.update({ where: { id: Number(id) }, data: { ratingAvg: summary.avg, ratingCount: summary.count } });
    },
    tags: async (id) => {
      const topic = await topicOf(id);
      return topic ? [`topic:${topic.id}`, `forum:${topic.forumId}`, "forums-ratings"] : [];
    },
  });
}
