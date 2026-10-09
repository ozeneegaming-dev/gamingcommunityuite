import { GcsForumCounters } from "../../../forums/counters";
import { IMPORT_DELETED_MEMBER } from "../map";
import type { GcsStepContext } from "../context";
import { IMPORT_TX } from "../context";

const CHUNK = 200;

/**
 * Pasul final: contoarele recalculate din date (topicuri, forumuri, membri, urmăritori, conversații, răspunsurile
 * status-urilor), versiunea permisiunilor și cache-ul golit. Doar entitățile din harta acestei surse.
 */
export async function finalizeImport(s: GcsStepContext): Promise<void> {
  const { db, permissions, bus } = s.deps;
  const counters = new GcsForumCounters();
  const source = s.map.source;
  // Fără membrii cu contul șters între timp (legătura lor nu mai dă un cont).
  const ids = async (type: string) =>
    (await db.importMap.findMany({ where: { source, type }, select: { targetId: true } })).map((r) => r.targetId).filter((id) => !id.startsWith(IMPORT_DELETED_MEMBER));
  const [topicIds, forumIds, userIds, statusIds] = await Promise.all([ids("topic"), ids("forum"), ids("member"), ids("status")]);
  const topics = topicIds.map(Number);
  const forums = forumIds.map(Number).filter((n) => Number.isInteger(n));
  s.state.total = topics.length + forums.length + userIds.length;

  // Prima postare a fiecărui topic importat (cea mai veche), apoi răspunsurile și ultima postare.
  for (let i = 0; i < topics.length; i += CHUNK) {
    const chunk = topics.slice(i, i + CHUNK);
    await db.$executeRaw`
      UPDATE topics t SET "firstPostId" = f.first_id
      FROM (SELECT "topicId", MIN(id) AS first_id FROM posts WHERE "topicId" = ANY(${chunk}::int[]) GROUP BY "topicId") f
      WHERE t.id = f."topicId"`;
    // Un topic rămas fără nicio postare (toate au eșuat sau sursa nu avea) nu se poate afișa: devine ascuns.
    const empty = await db.$executeRaw`UPDATE topics SET visibility = 'HIDDEN' WHERE id = ANY(${chunk}::int[]) AND "firstPostId" IS NULL AND visibility <> 'HIDDEN'`;
    if (empty > 0) await s.log("warn", `${empty} topicuri fără postări au fost ascunse`);
    await db.$transaction(async (tx) => {
      for (const id of chunk) await counters.recountTopic(tx, id);
    }, IMPORT_TX);
    s.state.done += chunk.length;
    await s.checkpointProgress();
  }
  for (const id of forums) {
    await db.$transaction((tx) => counters.recountForum(tx, id), IMPORT_TX);
    s.state.done++;
  }
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    await db.$transaction(async (tx) => {
      for (const id of chunk) await counters.recountUser(tx, id);
    }, IMPORT_TX);
    await db.$executeRaw`
      UPDATE users u SET "followersCount" = (SELECT COUNT(*)::int FROM follows f WHERE f."contentType" = 'user' AND f."contentId" = u.id)
      WHERE u.id = ANY(${chunk}::text[])`;
    s.state.done += chunk.length;
    await s.checkpointProgress();
  }
  const statuses = statusIds.map(Number);
  for (let i = 0; i < statuses.length; i += 1000) {
    const chunk = statuses.slice(i, i + 1000);
    await db.$executeRaw`
      UPDATE status_updates s SET "repliesCount" = (SELECT COUNT(*)::int FROM status_updates r WHERE r."parentId" = s.id)
      WHERE s.id = ANY(${chunk}::int[])`;
  }
  await permissions.bumpVersion();
  await s.deps.clearCache();
  await bus.emit({ name: "forum.updated", payload: { forumIds: forums }, tags: ["forums-tree", ...forums.map((id) => `forum:${id}`)] });
  s.state.imported = s.state.done;
}
