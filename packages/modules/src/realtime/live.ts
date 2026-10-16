import type { GcsEventBus, GcsRealtime } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/** Semnalul „activitate nouă” (feed-ul și clasamentul din consolă), trimis tuturor (camera `presence`). */
export const ACTIVITY_ROOM = "presence";
export const ACTIVITY_EVENT = "activity:new";

/**
 * Evenimentele de domeniu traduse în mesaje live (specul etapei 4 §5): o postare vizibilă nouă → `topic:{id}` `post:new`.
 * Postările în așteptare nu se publică; pleacă la aprobare.
 */
export function registerLiveEvents(bus: GcsEventBus, deps: { db: PrismaClient; realtime: GcsRealtime }): void {
  const publishPost = async (postId: number) => {
    const post = await deps.db.post.findUnique({ where: { id: postId }, select: { topicId: true, authorId: true, visibility: true, topic: { select: { visibility: true } } } });
    if (!post || post.visibility !== "VISIBLE" || post.topic.visibility !== "VISIBLE") return;
    await deps.realtime.publish(`topic:${post.topicId}`, "post:new", { topicId: post.topicId, postId, authorId: post.authorId });
    // Consola Hero Cockpit: un semnal fără date (feed-ul și topul se cer din nou, cu drepturile fiecăruia).
    await deps.realtime.publish(ACTIVITY_ROOM, ACTIVITY_EVENT, { kind: "forum" });
  };
  bus.on("post.created", async (e) => {
    if (!e.payload.pending) await publishPost(Number(e.payload.postId));
  });
  // Un topic nou (primul mesaj vizibil) e tot activitate pentru consolă; pagina topicului încă nu are abonați.
  bus.on("topic.created", async (e) => {
    if (e.payload.pending) return;
    const topic = await deps.db.topic.findUnique({ where: { id: Number(e.payload.topicId) }, select: { visibility: true } });
    if (topic?.visibility === "VISIBLE") await deps.realtime.publish(ACTIVITY_ROOM, ACTIVITY_EVENT, { kind: "forum" });
  });
  bus.on("post.approved", async (e) => {
    for (const p of (e.payload.posts as { postId: number }[] | undefined) ?? []) await publishPost(p.postId);
  });
}
