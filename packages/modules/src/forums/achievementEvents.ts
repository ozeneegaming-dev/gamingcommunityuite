import type { GcsAchievementEventDef, GcsAchievementOccurrence } from "@gcs/core";
import { POST_CONTENT_TYPE } from "./posting";

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
const forumScope = (forumIds: number[]) => (forumIds.length > 0 ? { topic: { forumId: { in: forumIds } } } : {});

/** Evenimentele Forumului pentru constructorul de reguli (Realizări v2). */
export const forumAchievementEvents: GcsAchievementEventDef[] = [
  {
    key: "forums.post",
    labelKey: "achievements.events.forums.post",
    icon: "fa-solid fa-comment",
    kind: "count",
    scopes: ["forum"],
    sources: [
      ...["post.created", "topic.created"].map((event) => ({
        event,
        map: (e: { payload: Record<string, unknown> }): GcsAchievementOccurrence[] => {
          const userId = str(e.payload.authorId);
          const postId = num(e.payload.postId);
          return userId && postId !== null && !e.payload.pending ? [{ userId, ref: `post:${postId}`, forumId: num(e.payload.forumId) }] : [];
        },
      })),
      {
        event: "post.approved",
        map: async (e, { db }) => {
          const list = ((e.payload.posts as { postId: number; authorId: string | null }[]) ?? []).filter((p) => p.authorId);
          const posts = await db.post.findMany({ where: { id: { in: list.map((p) => p.postId) } }, select: { id: true, authorId: true, topic: { select: { forumId: true } } } });
          return posts.filter((p) => p.authorId).map((p) => ({ userId: p.authorId!, ref: `post:${p.id}`, forumId: p.topic.forumId }));
        },
      },
    ],
    current: ({ db }, userId, { forumIds }) => db.post.count({ where: { authorId: userId, visibility: "VISIBLE", ...forumScope(forumIds) } }),
  },
  {
    key: "forums.topic",
    labelKey: "achievements.events.forums.topic",
    icon: "fa-solid fa-file-lines",
    kind: "count",
    scopes: ["forum"],
    sources: [
      {
        event: "topic.created",
        map: (e) => {
          const userId = str(e.payload.authorId);
          const topicId = num(e.payload.topicId);
          return userId && topicId !== null && !e.payload.pending ? [{ userId, ref: `topic:${topicId}`, forumId: num(e.payload.forumId) }] : [];
        },
      },
    ],
    current: ({ db }, userId, { forumIds }) => db.topic.count({ where: { authorId: userId, visibility: "VISIBLE", ...(forumIds.length > 0 ? { forumId: { in: forumIds } } : {}) } }),
  },
  {
    key: "forums.reaction_received",
    labelKey: "achievements.events.forums.reaction_received",
    icon: "fa-solid fa-heart",
    kind: "count",
    scopes: ["forum"],
    otherLabelKey: "achievements.other.reactionGiver",
    sources: [
      {
        event: "reaction.changed",
        map: async (e, { db }) => {
          const { authorId, reactionId, contentType, contentId, userId } = e.payload as Record<string, unknown>;
          if (typeof authorId !== "string" || typeof userId !== "string" || authorId === userId || typeof reactionId !== "number") return [];
          const reaction = await db.reaction.findUnique({ where: { id: reactionId }, select: { weight: true } });
          if (!reaction || reaction.weight <= 0) return [];
          let forumId: number | null = null;
          if (contentType === POST_CONTENT_TYPE && Number.isSafeInteger(Number(contentId))) {
            forumId = (await db.post.findUnique({ where: { id: Number(contentId) }, select: { topic: { select: { forumId: true } } } }))?.topic.forumId ?? null;
          }
          return [{ userId: authorId, otherUserId: userId, ref: `reaction:${String(contentType)}:${String(contentId)}:${userId}`, forumId }];
        },
      },
    ],
  },
  {
    key: "forums.solution",
    labelKey: "achievements.events.forums.solution",
    icon: "fa-solid fa-circle-check",
    kind: "count",
    scopes: ["forum"],
    otherLabelKey: "achievements.other.topicAuthor",
    sources: [
      {
        event: "topic.solved",
        map: async (e, { db }) => {
          const solverId = str(e.payload.solverId);
          const topicId = num(e.payload.topicId);
          if (!solverId || topicId === null) return [];
          const topic = await db.topic.findUnique({ where: { id: topicId }, select: { forumId: true, authorId: true } });
          return [{ userId: solverId, otherUserId: topic?.authorId ?? null, ref: `solution:${topicId}:${String(e.payload.postId)}`, forumId: topic?.forumId ?? null }];
        },
      },
    ],
    current: async ({ db }, userId) => (await db.user.findUnique({ where: { id: userId }, select: { solutionsCount: true } }))?.solutionsCount ?? 0,
  },
  {
    key: "forums.reputation",
    labelKey: "achievements.events.forums.reputation",
    icon: "fa-solid fa-star",
    kind: "value",
    rankMetric: false,
    sources: [
      {
        event: "reaction.changed",
        map: (e) => (typeof e.payload.authorId === "string" ? [{ userId: e.payload.authorId, ref: "value" }] : []),
      },
    ],
    current: async ({ db }, userId) => (await db.user.findUnique({ where: { id: userId }, select: { reputation: true } }))?.reputation ?? 0,
  },
];
