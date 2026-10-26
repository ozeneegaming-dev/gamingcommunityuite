import "server-only";
import { GcsForbidden, type GcsActor } from "@gcs/core";
import { services } from "./services";

/**
 * Nota botului comunității după o acțiune de moderare (funcția „Note de moderare” din ACP; oprită → nimic). Nu e o
 * Server Action: o cheamă doar acțiunile de moderare, după verificarea drepturilor.
 */
export async function postBotNotes(topicIds: number[], note: string | undefined): Promise<void> {
  if (!note) return;
  const { communityBot } = services();
  for (const topicId of topicIds) await communityBot.reply("moderation_notes", { topicId, content: { text: note } });
}

/** Puterea de moderare `power` pe forumul fiecărui topic (verificarea dinaintea unei note scrise înaintea acțiunii). */
export async function assertModeratorOn(actor: GcsActor, topicIds: number[], power: string): Promise<void> {
  const { db, posting } = services();
  const topics = await db.topic.findMany({ where: { id: { in: topicIds } }, select: { forumId: true } });
  for (const forumId of new Set(topics.map((t) => t.forumId))) {
    if (!(await posting.isModerator(actor, power, forumId))) throw new GcsForbidden({ power });
  }
}
