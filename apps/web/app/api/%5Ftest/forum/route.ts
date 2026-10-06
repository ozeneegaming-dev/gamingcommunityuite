import type { GcsActor } from "@gcs/core";
import type { ForumType } from "@gcs/db";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Body =
  | { action: "forum"; parentId: number | null; type: ForumType; name: string }
  | { action: "topic"; forumId: number; title: string; text: string; authorEmail: string; tags?: string[] }
  | { action: "reply"; topicId: number; text: string; authorEmail: string; mentionEmail?: string }
  | { action: "permissions"; forumId: number; groupKey: string; actions: string[] }
  | { action: "pm"; fromEmail: string; toEmail: string; title: string; text: string };

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Actorul unui user existent (după email); pauza de flood e ștearsă, ca testele să poată posta în ritmul lor. */
async function actorFor(email: string): Promise<GcsActor> {
  const { db, redis } = services();
  const user = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, include: { groups: true } });
  await redis.del(`gcs:rl:forum-post:${user.id}`);
  return { userId: user.id, groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId)], primaryGroupId: user.primaryGroupId, isBanned: false, ip: "e2e" };
}

/** Șterge și pauza lăsată de postarea creată, ca testul să poată posta imediat din browser. */
async function clearFlood(actor: GcsActor): Promise<void> {
  await services().redis.del(`gcs:rl:forum-post:${actor.userId}`);
}

/** Un Root Admin „de sistem” (fără user), pentru structura forumului. */
async function rootActor(): Promise<GcsActor> {
  const root = await services().db.group.findUniqueOrThrow({ where: { key: "root_admin" } });
  return { userId: null, groupIds: [root.id], primaryGroupId: root.id, isBanned: false, ip: "e2e" };
}

/**
 * Datele forumului pentru testele E2E (`POST /api/_test/forum`), prin serviciile reale. Există doar cu `GCS_TEST_ROUTES=1`.
 */
export async function POST(req: Request): Promise<Response> {
  if (process.env.GCS_TEST_ROUTES !== "1") return new Response(null, { status: 404 });
  const body = (await req.json()) as Body;
  const s = services();
  switch (body.action) {
    case "forum": {
      const forum = await s.forums.create({ parentId: body.parentId, type: body.type, name: body.name }, await rootActor());
      return Response.json({ id: forum.id, slug: forum.slug });
    }
    case "topic": {
      const actor = await actorFor(body.authorEmail);
      const res = await s.topics.create(actor, {
        forumId: body.forumId,
        title: body.title,
        content: doc(body.text),
        ...(body.tags ? { tags: body.tags } : {}),
      });
      await clearFlood(actor);
      return Response.json(res);
    }
    case "reply": {
      const actor = await actorFor(body.authorEmail);
      // Cu `mentionEmail`, textul e precedat de o mențiune a acelui user.
      const mentioned = body.mentionEmail ? await s.db.user.findUniqueOrThrow({ where: { email: body.mentionEmail.toLowerCase() } }) : null;
      const content = mentioned
        ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: mentioned.id, label: mentioned.name } }, { type: "text", text: ` ${body.text}` }] }] }
        : doc(body.text);
      const res = await s.posts.reply(actor, { topicId: body.topicId, content });
      await clearFlood(actor);
      return Response.json(res);
    }
    case "pm": {
      const actor = await actorFor(body.fromEmail);
      const to = await s.db.user.findUniqueOrThrow({ where: { email: body.toEmail.toLowerCase() } });
      await s.redis.del(`gcs:rl:pm:${actor.userId}`);
      return Response.json(await s.conversations.start(actor, { to: [to.id], title: body.title, content: doc(body.text) }));
    }
    case "permissions": {
      // Matricea efectivă a forumului (urcând pe moștenire), cu acțiunile grupului înlocuite.
      let source = String(body.forumId);
      for (;;) {
        const inherit = await s.db.containerInherit.findFirst({ where: { containerType: "forum", containerId: source } });
        if (!inherit?.inherits || !inherit.parentId) break;
        source = inherit.parentId;
      }
      const rows = await s.db.containerPermission.findMany({ where: { containerType: "forum", containerId: source } });
      const matrix: Record<number, string[]> = {};
      for (const r of rows) (matrix[r.groupId] ??= []).push(r.action);
      const group = await s.db.group.findUniqueOrThrow({ where: { key: body.groupKey } });
      matrix[group.id] = body.actions;
      const root = await rootActor();
      await s.groups.setContainerInherit("forum", String(body.forumId), { inherits: false, parentId: null }, root);
      await s.groups.setContainerPermissions("forum", String(body.forumId), matrix, root);
      return Response.json({ ok: true });
    }
  }
}
