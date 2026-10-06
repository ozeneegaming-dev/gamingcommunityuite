import type { GcsEventBus, GcsRealtime } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/**
 * Evenimentele de domeniu traduse în mesaje live (specul etapei 4 §5): o postare vizibilă nouă → `topic:{id}` `post:new`.
 * Postările în așteptare nu se publică; pleacă la aprobare.
 */
export function registerLiveEvents(bus: GcsEventBus, deps: { db: PrismaClient; realtime: GcsRealtime }): void {
  const publishPost = async (postId: number) => {
    const post = await deps.db.post.findUnique({ where: { id: postId }, select: { topicId: true, authorId: true, visibility: true, topic: { select: { visibility: true } } } });
    if (!post || post.visibility !== "VISIBLE" || post.topic.visibility !== "VISIBLE") return;
    await deps.realtime.publish(`topic:${post.topicId}`, "post:new", { topicId: post.topicId, postId, authorId: post.authorId });
  };
  bus.on("post.created", async (e) => {
    if (!e.payload.pending) await publishPost(Number(e.payload.postId));
  });
  bus.on("post.approved", async (e) => {
    for (const p of (e.payload.posts as { postId: number }[] | undefined) ?? []) await publishPost(p.postId);
  });
}
