import { GcsValidationError, type GcsActor } from "@gcs/core";
import type { ForumType } from "@gcs/db";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

type Body =
  | { action: "forum"; parentId: number | null; type: ForumType; name: string; icon?: string; subforumColumns?: number }
  /** `images`: câte imagini (încărcate ca atașamente ale autorului) urmează după text (vizualizatorul de imagini). */
  /** `content`: documentul editorului ca atare (Forum v2: blocurile); o eroare de validare întoarce 422 cu câmpurile. */
  | { action: "topic"; forumId: number; title: string; text: string; authorEmail: string; tags?: string[]; images?: number; content?: { type: string; content: unknown[] } }
  | { action: "reply"; topicId: number; text: string; authorEmail: string; mentionEmail?: string }
  | { action: "permissions"; forumId: number; groupKey: string; actions: string[] }
  | { action: "pm"; fromEmail: string; toEmail: string; title: string; text: string }
  /** Conținutul demo al instalatorului (forumuri, topicuri, chat, profiluri), cu autorul dat; doar pe o bază fără forumuri. */
  | { action: "demo"; adminEmail: string }
  | {
      action: "profileField";
      key: string;
      label: string;
      type?: "TEXT" | "IMAGE_SELECT";
      options?: string[];
      optionImages?: Record<string, string>;
      icon?: string;
      visibility?: "PUBLIC" | "MEMBERS" | "STAFF";
    };

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** O imagine PNG de 120×40 (o culoare), pentru postările cu imagini din teste. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

/** Actorul unui user existent (după email); pauza de flood e ștearsă, ca testele să poată posta în ritmul lor. */
async function actorFor(email: string): Promise<GcsActor> {
  const { db, rateLimiter } = services();
  const user = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, include: { groups: true } });
  await rateLimiter.reset(`forum-post:${user.id}`);
  return { userId: user.id, groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId)], primaryGroupId: user.primaryGroupId, isBanned: false, ip: "e2e" };
}

/** Șterge și pauza lăsată de postarea creată, ca testul să poată posta imediat din browser. */
async function clearFlood(actor: GcsActor): Promise<void> {
  await services().rateLimiter.reset(`forum-post:${actor.userId}`);
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
      const forum = await s.forums.create(
        {
          parentId: body.parentId,
          type: body.type,
          name: body.name,
          ...(body.icon ? { icon: body.icon } : {}),
          ...(body.subforumColumns ? { subforumColumns: body.subforumColumns } : {}),
        },
        await rootActor(),
      );
      return Response.json({ id: forum.id, slug: forum.slug });
    }
    case "topic": {
      const actor = await actorFor(body.authorEmail);
      const content = body.content ?? (doc(body.text) as { type: string; content: unknown[] });
      for (let i = 0; i < (body.images ?? 0); i++) {
        const file = await s.attachments.importFile(actor.userId, { name: `poza-${i + 1}.png`, bytes: PNG }, { maxBytes: 1024 * 1024 });
        content.content.push({ type: "image", attrs: { attachmentId: file.id, alt: `Poza ${i + 1}`, width: file.width, height: file.height } });
      }
      try {
        const res = await s.topics.create(actor, {
          forumId: body.forumId,
          title: body.title,
          content,
          ...(body.tags ? { tags: body.tags } : {}),
        });
        await clearFlood(actor);
        return Response.json(res);
      } catch (error) {
        if (error instanceof GcsValidationError) return Response.json({ fields: error.fields, params: error.params }, { status: 422 });
        throw error;
      }
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
    case "profileField": {
      // Prin serviciul ACP, ca invalidarea cache-ului (câmpurile din postbit) să fie cea reală.
      const row = await s.profileFields.save(await rootActor(), null, {
        key: body.key,
        label: body.label,
        type: body.type ?? "TEXT",
        options: body.options ?? [],
        section: "ABOUT",
        required: false,
        maxLength: 200,
        visibility: body.visibility ?? "PUBLIC",
        showOnCard: false,
        position: 0,
        icon: body.icon ?? null,
        showInPostbit: true,
        optionImages: body.optionImages ?? {},
      });
      return Response.json({ id: row.id });
    }
    case "demo": {
      for (const m of s.registry.all()) {
        await m.seedDemo?.({ db: s.db, cache: s.cache, bus: s.bus, registry: s.registry, variant: "demo", adminEmail: body.adminEmail });
      }
      await s.cache.invalidateTags(["forums", "nav", "widgets"]);
      return Response.json({ ok: true });
    }
    case "pm": {
      const actor = await actorFor(body.fromEmail);
      const to = await s.db.user.findUniqueOrThrow({ where: { email: body.toEmail.toLowerCase() } });
      await s.rateLimiter.reset(`pm:${actor.userId}`);
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
