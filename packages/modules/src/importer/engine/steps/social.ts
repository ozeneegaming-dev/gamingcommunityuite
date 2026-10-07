import type { Prisma } from "@gcs/db";
import { POST_CONTENT_TYPE } from "../../../forums/posting";
import type { GcsStepContext } from "../context";

/** Numele reacțiilor vechi → cheia reacției GCS. Fără corespondent → `like` (specul modulului, implicit). */
const REACTION_ALIASES: Record<string, string> = {
  like: "like",
  likes: "like",
  "+1": "like",
  upvote: "like",
  agree: "like",
  "thumbs up": "like",
  thanks: "thanks",
  "thank you": "thanks",
  multumesc: "thanks",
  mersi: "thanks",
  love: "thanks",
  heart: "thanks",
  haha: "haha",
  lol: "haha",
  funny: "haha",
  laugh: "haha",
  gg: "gg",
  "good game": "gg",
  dislike: "disagree",
  disagree: "disagree",
  downvote: "disagree",
};

/** Cheia GCS pentru numele unei reacții vechi. */
export function reactionKeyFor(name: string): string {
  const n = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  return REACTION_ALIASES[n] ?? "like";
}

/** Pasul 9: reacțiile pe postări, potrivite după nume; una per membru per postare (ca în GCS). */
export async function importReactions(s: GcsStepContext): Promise<void> {
  const { db } = s.deps;
  const [types, reactions] = await Promise.all([s.adapter.reactionTypes(), db.reaction.findMany({ where: { enabled: true }, orderBy: { position: "asc" }, select: { id: true, key: true } })]);
  if (reactions.length === 0) {
    await s.log("warn", "nicio reacție activă în GCS; pasul se sare");
    return;
  }
  const byKey = new Map(reactions.map((r) => [r.key, r.id]));
  const fallback = byKey.get("like") ?? reactions[0]!.id;
  const typeMap = new Map(types.map((t) => [t.id, byKey.get(reactionKeyFor(t.name)) ?? fallback]));
  await s.batches(
    (c, l) => s.adapter.reactions(c, l),
    1000,
    async (rows) => {
      const [posts, members] = await Promise.all([s.map.get("post", rows.map((r) => r.postId)), s.map.get("member", rows.map((r) => r.memberId))]);
      const data: Prisma.ContentReactionCreateManyInput[] = [];
      for (const r of rows) {
        const postId = posts.get(r.postId);
        const userId = members.get(r.memberId);
        if (!postId || !userId) {
          s.state.skipped++;
          continue;
        }
        data.push({ contentType: POST_CONTENT_TYPE, contentId: postId, userId, reactionId: typeMap.get(r.typeId) ?? fallback, createdAt: r.createdAt });
      }
      const res = await db.contentReaction.createMany({ data, skipDuplicates: true });
      s.state.imported += res.count;
      s.state.skipped += data.length - res.count;
    },
  );
}

/** Pasul 11: urmăririle (forumuri, topicuri, membri), apoi ignorările. */
export async function importFollows(s: GcsStepContext): Promise<void> {
  const { db } = s.deps;
  // Cursorul are două faze: urmăririle (`f|…`), apoi ignorările (`i|…`).
  const phase = s.state.cursor?.startsWith("i|") ? "i" : "f";
  const inner = (c: string | null) => (c === null ? null : c.slice(2) || null);
  if (phase === "f") {
    await s.batches(
      async (c, l) => {
        const batch = await s.adapter.follows(inner(c), l);
        return { rows: batch.rows, next: batch.next === null ? null : `f|${batch.next}` };
      },
      1000,
      async (rows) => {
        const ids = (type: string) => rows.filter((r) => r.type === type).map((r) => r.targetId);
        const [members, forums, topics, users] = await Promise.all([
          s.map.get("member", rows.map((r) => r.memberId)),
          s.map.get("forum", ids("forum")),
          s.map.get("topic", ids("topic")),
          s.map.get("member", ids("user")),
        ]);
        const data: Prisma.FollowCreateManyInput[] = [];
        for (const r of rows) {
          const userId = members.get(r.memberId);
          const target = r.type === "forum" ? forums.get(r.targetId) : r.type === "topic" ? topics.get(r.targetId) : users.get(r.targetId);
          if (!userId || !target || (r.type === "user" && target === userId)) {
            s.state.skipped++;
            continue;
          }
          data.push({ userId, contentType: r.type, contentId: target });
        }
        const res = await db.follow.createMany({ data, skipDuplicates: true });
        s.state.imported += res.count;
        s.state.skipped += data.length - res.count;
      },
    );
    s.state.cursor = "i|";
  }
  await s.batches(
    async (c, l) => {
      const batch = await s.adapter.ignores(inner(c), l);
      return { rows: batch.rows, next: batch.next === null ? null : `i|${batch.next}` };
    },
    1000,
    async (rows) => {
      const members = await s.map.get("member", rows.flatMap((r) => [r.memberId, r.ignoredId]));
      const data = rows.flatMap((r) => {
        const userId = members.get(r.memberId);
        const ignoredId = members.get(r.ignoredId);
        return userId && ignoredId && userId !== ignoredId ? [{ userId, ignoredId }] : [];
      });
      s.state.skipped += rows.length - data.length;
      const res = await db.userIgnore.createMany({ data, skipDuplicates: true });
      s.state.imported += res.count;
      s.state.skipped += data.length - res.count;
    },
  );
}

/** Pasul 12: avertismentele (punctele, motivul, expirarea). Banurile vin cu membrii. */
export async function importWarnings(s: GcsStepContext): Promise<void> {
  await s.batches(
    (c, l) => s.adapter.warnings(c, l),
    500,
    async (rows) => {
      const [existing, members] = await Promise.all([s.map.get("warning", rows.map((r) => r.id)), s.map.get("member", rows.flatMap((r) => [r.memberId, r.issuerId ?? ""]))]);
      await s.rows(
        rows,
        (r) => r.id,
        async (tx, w) => {
          if (existing.has(w.id)) return "skipped";
          const userId = members.get(w.memberId);
          if (!userId) return "skipped";
          const row = await tx.warning.create({
            data: {
              userId,
              points: Math.max(0, Math.round(w.points)),
              reason: (w.reason || "Avertisment importat").slice(0, 500),
              expiresAt: w.expiresAt,
              issuedById: w.issuerId ? (members.get(w.issuerId) ?? null) : null,
              createdAt: w.createdAt,
            },
          });
          await s.map.set(tx, "warning", w.id, row.id);
          return "imported";
        },
      );
    },
  );
}
