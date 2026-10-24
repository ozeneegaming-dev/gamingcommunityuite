import type { Prisma } from "@gcs/db";
import { GcsSearchIndex } from "@gcs/core";
import { POST_CONTENT_TYPE } from "../../../forums/posting";
import { PM_CONTENT_TYPE } from "../../../messages/conversations";
import type { GcsStepContext } from "../context";

/** Cel mai mare fișier copiat (ca limita maximă de upload a unui grup VIP). */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Pasul 7: atașamentele. Fiecare fișier trece prin `importFile` (tipul real din magic bytes, recodarea imaginilor),
 * ca un upload nou; legătura cu postarea sau mesajul se face la pașii lor.
 */
export async function importAttachments(s: GcsStepContext): Promise<void> {
  const { db, attachments } = s.deps;
  const files = s.files;
  if (!files) return;
  await s.batches(
    (c, l) => s.adapter.attachments(c, l),
    50,
    async (rows) => {
      const [existing, owners] = await Promise.all([s.map.get("attachment", rows.map((r) => r.id)), s.map.get("member", rows.map((r) => r.ownerId ?? ""))]);
      for (const a of rows) {
        if (existing.has(a.id)) {
          s.state.skipped++;
          continue;
        }
        try {
          const bytes = await files.read(a.path);
          if (!bytes) {
            s.state.skipped++;
            await s.log("warn", `fișier lipsă: ${a.path.slice(0, 200)}`, a.id);
            continue;
          }
          const info = await attachments.importFile(a.ownerId ? (owners.get(a.ownerId) ?? null) : null, { name: a.filename, bytes }, { maxBytes: MAX_FILE_BYTES });
          await s.map.set(db, "attachment", a.id, info.id);
          s.state.imported++;
        } catch (error) {
          s.state.errors++;
          await s.log("error", `fișier ${a.filename.slice(0, 80)}: ${(error as Error).message.slice(0, 200)}`, a.id);
        }
      }
    },
  );
}

/**
 * Pasul 8: postările, cu conținutul convertit (citatele spre postările noi, mențiunile, atașamentele, linkurile
 * interne), autorul, IP-ul, data, editarea și vizibilitatea. Postările dintr-un lot se pot cita între ele.
 */
export async function importPosts(s: GcsStepContext): Promise<void> {
  const lookups = s.newLookups();
  await s.batches(
    (c, l) => s.adapter.posts(c, l),
    200,
    async (rows) => {
      const [existing, topics] = await Promise.all([s.map.get("post", rows.map((r) => r.id)), s.map.get("topic", rows.map((r) => r.topicId))]);
      const refs = s.collectRefs(lookups, rows.map((r) => r.content));
      for (const r of rows) {
        if (r.authorId) refs.members.add(r.authorId);
        if (r.editedById) refs.members.add(r.editedById);
        for (const a of r.attachmentIds) refs.attachments.add(a);
      }
      await lookups.load(refs);
      await s.rows(
        rows,
        (r) => r.id,
        async (tx, p) => {
          if (existing.has(p.id)) return "skipped";
          const topicId = Number(topics.get(p.topicId));
          if (!Number.isInteger(topicId)) {
            await s.log("warn", "topicul postării nu a fost importat", p.id);
            return "skipped";
          }
          const content = s.convert(lookups, p.content, p.attachmentIds);
          if (content.unrecognized > 0 || content.fallback) s.state.unrecognized++;
          const authorId = p.authorId ? (lookups.members.get(p.authorId)?.id ?? null) : null;
          const editorId = p.editedById ? (lookups.members.get(p.editedById)?.id ?? null) : null;
          const post = await tx.post.create({
            data: {
              topicId,
              authorId,
              contentJson: content.rendered.json as Prisma.InputJsonValue,
              contentHtml: content.rendered.html,
              visibility: p.visibility,
              ip: p.ip,
              createdAt: p.createdAt,
              editedAt: p.editedAt,
              editedById: editorId,
            },
            select: { id: true },
          });
          await new GcsSearchIndex().indexPost(tx, post.id, content.rendered.text);
          if (content.attachmentIds.length > 0) {
            await tx.attachment.updateMany({ where: { id: { in: content.attachmentIds }, contentType: null }, data: { contentType: POST_CONTENT_TYPE, contentId: String(post.id) } });
          }
          await s.map.set(tx, "post", p.id, post.id);
          lookups.posts.set(p.id, { id: post.id, topicId });
          return "imported";
        },
        { onCommit: () => lookups.commit(), onRollback: () => lookups.discard() },
      );
    },
  );
}

/** Pasul 10: conversațiile private, cu participanții (plecați = `leftAt`), mesajele și starea de citire. */
export async function importConversations(s: GcsStepContext): Promise<void> {
  const lookups = s.newLookups();
  await s.batches(
    (c, l) => s.adapter.conversations(c, l),
    25,
    async (rows) => {
      const existing = await s.map.get("conversation", rows.map((r) => r.id));
      const messages = rows.flatMap((c) => c.messages);
      const refs = s.collectRefs(lookups, messages.map((m) => m.content));
      for (const c of rows) {
        if (c.starterId) refs.members.add(c.starterId);
        for (const p of c.participants) refs.members.add(p.memberId);
        for (const m of c.messages) {
          if (m.authorId) refs.members.add(m.authorId);
          for (const a of m.attachmentIds) refs.attachments.add(a);
        }
      }
      await lookups.load(refs);
      await s.rows(
        rows,
        (r) => r.id,
        async (tx, c) => {
          if (existing.has(c.id)) return "skipped";
          const participants = new Map<string, { lastReadAt: Date | null; left: boolean }>();
          for (const p of c.participants) {
            const userId = lookups.members.get(p.memberId)?.id;
            if (userId) participants.set(userId, { lastReadAt: p.lastReadAt, left: p.left });
          }
          if (participants.size === 0 || c.messages.length === 0) {
            await s.log("warn", "conversație fără participanți sau mesaje importate", c.id);
            return "skipped";
          }
          const last = c.messages[c.messages.length - 1]!;
          const conversation = await tx.conversation.create({
            data: {
              title: c.title.replace(/\s+/g, " ").trim().slice(0, 150) || "Conversație",
              starterId: c.starterId ? (lookups.members.get(c.starterId)?.id ?? null) : null,
              createdAt: c.createdAt,
              lastMessageAt: last.createdAt,
            },
          });
          const created: { id: number; createdAt: Date }[] = [];
          for (const m of c.messages) {
            const content = s.convert(lookups, m.content, m.attachmentIds);
            if (content.unrecognized > 0 || content.fallback) s.state.unrecognized++;
            const row = await tx.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                authorId: m.authorId ? (lookups.members.get(m.authorId)?.id ?? null) : null,
                contentJson: content.rendered.json as Prisma.InputJsonValue,
                contentHtml: content.rendered.html,
                ip: m.ip,
                createdAt: m.createdAt,
              },
              select: { id: true, createdAt: true },
            });
            if (content.attachmentIds.length > 0) {
              await tx.attachment.updateMany({ where: { id: { in: content.attachmentIds }, contentType: null }, data: { contentType: PM_CONTENT_TYPE, contentId: String(row.id) } });
            }
            await s.map.set(tx, "message", m.id, row.id);
            created.push(row);
          }
          const lastId = created[created.length - 1]!.id;
          await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageId: lastId, messagesCount: created.length } });
          await tx.conversationParticipant.createMany({
            data: [...participants].map(([userId, p]) => ({
              conversationId: conversation.id,
              userId,
              joinedAt: c.createdAt,
              leftAt: p.left ? last.createdAt : null,
              // Citit până la ultimul mesaj de dinaintea ultimei citiri din sursă.
              lastReadMessageId: p.lastReadAt ? created.filter((m) => m.createdAt <= p.lastReadAt!).reduce((max, m) => Math.max(max, m.id), 0) : 0,
            })),
            skipDuplicates: true,
          });
          await s.map.set(tx, "conversation", c.id, conversation.id);
          return "imported";
        },
      );
    },
  );
}

/** Pasul 13: status-urile de pe profil și răspunsurile lor (un singur nivel, ca în GCS). */
export async function importStatuses(s: GcsStepContext): Promise<void> {
  const { db } = s.deps;
  const lookups = s.newLookups();
  await s.batches(
    (c, l) => s.adapter.statuses(c, l),
    200,
    async (rows) => {
      const existing = await s.map.get("status", rows.map((r) => r.id));
      const parents = await s.map.get("status", rows.map((r) => r.parentId ?? ""));
      const parentRows = await db.statusUpdate.findMany({ where: { id: { in: [...parents.values()].map(Number) } }, select: { id: true, profileUserId: true } });
      const profileOf = new Map(parentRows.map((p) => [p.id, p.profileUserId]));
      const refs = s.collectRefs(lookups, rows.map((r) => r.content));
      for (const r of rows) {
        if (r.authorId) refs.members.add(r.authorId);
        if (r.profileId) refs.members.add(r.profileId);
      }
      await lookups.load(refs);
      await s.rows(
        rows,
        (r) => r.id,
        async (tx, st) => {
          if (existing.has(st.id)) return "skipped";
          const parentId = st.parentId ? Number(parents.get(st.parentId)) : null;
          if (parentId !== null && !Number.isInteger(parentId)) return "skipped";
          const profileUserId = parentId !== null ? profileOf.get(parentId) : lookups.members.get(st.profileId)?.id;
          if (!profileUserId) return "skipped";
          const content = s.convert(lookups, st.content);
          if (content.unrecognized > 0 || content.fallback) s.state.unrecognized++;
          const row = await tx.statusUpdate.create({
            data: {
              profileUserId,
              authorId: st.authorId ? (lookups.members.get(st.authorId)?.id ?? null) : null,
              parentId,
              contentJson: content.rendered.json as Prisma.InputJsonValue,
              contentHtml: content.rendered.html,
              visibility: st.visibility,
              ip: st.ip,
              createdAt: st.createdAt,
            },
            select: { id: true },
          });
          await s.map.set(tx, "status", st.id, row.id);
          return "imported";
        },
      );
    },
  );
}
