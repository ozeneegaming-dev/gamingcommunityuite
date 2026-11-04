import {
  GcsConflict,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  writeAudit,
  type GcsActor,
  type GcsAttachmentService,
  type GcsEventBus,
  type GcsRateLimiter,
  type GcsRendered,
  type GcsSettingsService,
} from "@gcs/core";
import { Prisma, type PagesRecordStatus, type PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import type { GcsPagesAccess, GcsPagesDb } from "./access";
import { attachmentIdsOf, fieldSearchText, fieldValuesOf, parseFieldValues } from "./fields";
import { PAGES_SETTING } from "./options";
import { PAGES_CACHE_TAG, PAGES_RECORD_TYPE, plainText, searchNormalize } from "./shared";

export type GcsPagesRecordInput = {
  title: string;
  categoryId?: number | null;
  /** Documentul editorului (conținutul înregistrării). */
  content?: unknown;
  /** Imaginea înregistrării: un atașament încărcat de actor (`null` = scoate imaginea, lipsă = neschimbată). */
  imageId?: string | null;
  /** Valorile câmpurilor proprii, după cheie (atașamentele câmpurilor imagine / fișier sunt id-uri). */
  fields?: Record<string, unknown>;
};

/** Ce poate schimba staff-ul pe o înregistrare (pe lângă conținut): starea, „recomandată”, „fixată”. */
export type GcsPagesRecordFlags = { featured?: boolean; pinned?: boolean };

const CHANGE_TAGS = [PAGES_CACHE_TAG, "activity"];
const VIEW_WINDOW = 3600;

/**
 * Înregistrările bazelor de date (specul 2026-11-03-pagini §3): trimiterea (cu aprobare, după setările bazei și grupul
 * autorului), editarea de către autor sau staff, aprobarea / respingerea cu motiv, ascunderea, recomandarea și fixarea,
 * ștergerea; comentariile (editorul comun, cu mențiuni) și vizualizările. Evenimentele (`pages.record.*`,
 * `pages.comment.created`) duc la notificări (`notify.ts`).
 */
export class GcsPagesRecords {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      settings: GcsSettingsService;
      attachments: GcsAttachmentService;
      rateLimiter: GcsRateLimiter;
      access: GcsPagesAccess;
      /** Conținutul unei înregistrări (cu blocurile permise actorului) → JSON validat + HTML. */
      render: (content: unknown, actor: GcsActor) => Promise<GcsRendered>;
      /** Conținutul unui comentariu (fără blocuri). */
      renderComment: (content: unknown, actor: GcsActor) => Promise<GcsRendered>;
      /** Restricțiile anti-spam ale membrului (avertismente, restricții) și pauza dintre postări. */
      checkWrite: (actor: GcsActor) => Promise<void>;
      /** Serverele de joc care pot fi alese în câmpurile „server” (aplicația Servere pornită), sau `null`. */
      servers?: () => Promise<ReadonlySet<number> | null>;
    },
  ) {}

  private async loadDb(id: number): Promise<GcsPagesDb> {
    const d = await this.deps.access.database(id);
    if (!d) throw new GcsNotFound();
    return d;
  }

  /** Numerele bazei de date și ale categoriilor (doar înregistrările publicate), după orice schimbare de stare. */
  private async recount(tx: Prisma.TransactionClient, databaseId: number, categoryIds: (number | null)[]): Promise<void> {
    const total = await tx.pagesRecord.count({ where: { databaseId, status: "PUBLISHED" } });
    await tx.pagesDatabase.update({ where: { id: databaseId }, data: { recordsCount: total } });
    for (const id of new Set(categoryIds.filter((c): c is number => c !== null))) {
      const n = await tx.pagesRecord.count({ where: { categoryId: id, status: "PUBLISHED" } });
      await tx.pagesCategory.updateMany({ where: { id }, data: { recordsCount: n } });
    }
  }

  /** Datele validate ale unei înregistrări (titlul, categoria, conținutul randat, câmpurile, atașamentele noi). */
  private async prepare(actor: GcsActor, d: GcsPagesDb, input: GcsPagesRecordInput, current: { fields: unknown; contentJson: unknown } | null) {
    const { db, render, servers } = this.deps;
    const errors: Record<string, string> = {};
    const title = input.title.replace(/\s+/g, " ").trim();
    if (title.length < 3) errors.title = "too_short";
    else if (title.length > 150) errors.title = "too_long";
    const categoryId = input.categoryId ?? null;
    if (categoryId !== null && !(await db.pagesCategory.findFirst({ where: { id: categoryId, databaseId: d.id }, select: { id: true } }))) errors.categoryId = "invalid_choice";
    let rendered: GcsRendered | null = null;
    if (input.content !== undefined && input.content !== null) {
      try {
        rendered = await render(input.content, actor);
      } catch (error) {
        if (error instanceof GcsValidationError) Object.assign(errors, error.fields);
        else throw error;
      }
    }
    const needsServers = d.fields.some((f) => f.type === "server");
    const fieldsIn = input.fields ?? (current ? (fieldValuesOf(d.fields, current.fields) as Record<string, unknown>) : {});
    const parsed = parseFieldValues(d.fields, fieldsIn, { servers: needsServers && servers ? await servers() : null });
    Object.assign(errors, parsed.errors);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const text = rendered ? rendered.text : "";
    return {
      title,
      slug: slugify(title),
      categoryId,
      rendered,
      values: parsed.values,
      searchText: searchNormalize(`${title} ${text} ${fieldSearchText(d.fields, parsed.values)}`).slice(0, 20_000),
    };
  }

  /**
   * O înregistrare nouă: de la staff (oricând) sau trimisă de un membru (trimiterile pornite, grupul lui, pauza dintre
   * trimiteri). Fără dreptul de a sări aprobarea, într-o bază cu aprobare, ajunge „în așteptare” și staff-ul e anunțat.
   */
  async create(actor: GcsActor, databaseId: number, input: GcsPagesRecordInput): Promise<{ id: number; status: PagesRecordStatus; slug: string }> {
    const { db, bus, access, attachments, rateLimiter, settings } = this.deps;
    const d = await this.loadDb(databaseId);
    if (!(await access.canViewDatabase(actor, d)) || !(await access.canSubmit(actor, d))) throw new GcsForbidden({ permission: "pages.submit" });
    const staff = await access.isStaff(actor);
    if (!staff) {
      await this.deps.checkWrite(actor);
      const cooldown = await settings.get<number>(PAGES_SETTING.submitCooldown);
      if (cooldown > 0) {
        const res = await rateLimiter.consume(`pages-submit:${actor.userId}`, { window: cooldown, max: 1 });
        if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter) });
      }
    }
    const data = await this.prepare(actor, d, input, null);
    const status: PagesRecordStatus = !d.approval || (await access.skipsApproval(actor)) ? "PUBLISHED" : "PENDING";
    const fileIds = [...new Set([...(input.imageId ? [input.imageId] : []), ...attachmentIdsOf(d.fields, data.values), ...(data.rendered?.attachments ?? [])])];
    const record = await db.$transaction(async (tx) => {
      const row = await tx.pagesRecord.create({
        data: {
          databaseId,
          categoryId: data.categoryId,
          authorId: actor.userId,
          title: data.title,
          slug: data.slug,
          contentJson: data.rendered ? (data.rendered.json as Prisma.InputJsonValue) : Prisma.DbNull,
          contentHtml: data.rendered?.html ?? "",
          imageId: input.imageId ?? null,
          fields: data.values as Prisma.InputJsonValue,
          searchText: data.searchText,
          status,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
      });
      await attachments.attach(tx, fileIds, { contentType: PAGES_RECORD_TYPE, contentId: String(row.id), ownerId: actor.userId! });
      await this.recount(tx, databaseId, [data.categoryId]);
      await writeAudit(tx, { actorId: actor.userId, action: "pages.record.create", targetType: "pages_record", targetId: String(row.id), before: null, after: { title: data.title, status, databaseId }, ip: actor.ip });
      return row;
    });
    await bus.emit({
      name: "pages.record.created",
      payload: { recordId: record.id, databaseId, authorId: actor.userId, status, mentions: data.rendered?.mentions ?? [], groupMentions: data.rendered?.groupMentions ?? [] },
      tags: CHANGE_TAGS,
    });
    return { id: record.id, status, slug: record.slug };
  }

  /** Cine poate edita înregistrarea: staff-ul; autorul, dacă baza permite și înregistrarea nu e ascunsă. */
  async canEdit(actor: GcsActor, record: { authorId: string | null; status: PagesRecordStatus }, d: GcsPagesDb): Promise<boolean> {
    if (!actor.userId) return false;
    if (await this.deps.access.isStaff(actor)) return true;
    return record.authorId === actor.userId && d.authorEdit && record.status !== "HIDDEN";
  }

  async update(actor: GcsActor, recordId: number, input: GcsPagesRecordInput & GcsPagesRecordFlags): Promise<{ id: number; slug: string }> {
    const { db, bus, access, attachments } = this.deps;
    const record = await db.pagesRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new GcsNotFound();
    const d = await this.loadDb(record.databaseId);
    if (!(await access.canViewDatabase(actor, d)) || !(await this.canEdit(actor, record, d))) throw new GcsForbidden({ permission: "pages.edit" });
    const staff = await access.isStaff(actor);
    if (!staff) await this.deps.checkWrite(actor);
    const data = await this.prepare(actor, d, input, record);
    const imageId = input.imageId === undefined ? record.imageId : input.imageId;
    // Atașamentele noi (încărcate acum de actor); cele deja legate de înregistrare rămân.
    const wanted = [...new Set([...(imageId ? [imageId] : []), ...attachmentIdsOf(d.fields, data.values), ...(data.rendered?.attachments ?? [])])];
    const owned = new Set((await db.attachment.findMany({ where: { id: { in: wanted }, contentType: PAGES_RECORD_TYPE, contentId: String(recordId) }, select: { id: true } })).map((a) => a.id));
    const fresh = wanted.filter((id) => !owned.has(id));
    const before = { imageId: record.imageId, files: attachmentIdsOf(d.fields, fieldValuesOf(d.fields, record.fields)) };
    await db.$transaction(async (tx) => {
      await tx.pagesRecord.update({
        where: { id: recordId },
        data: {
          title: data.title,
          slug: data.slug,
          categoryId: data.categoryId,
          ...(data.rendered ? { contentJson: data.rendered.json as Prisma.InputJsonValue, contentHtml: data.rendered.html } : {}),
          imageId,
          fields: data.values as Prisma.InputJsonValue,
          searchText: data.searchText,
          ...(staff && input.featured !== undefined ? { featured: input.featured } : {}),
          ...(staff && input.pinned !== undefined ? { pinned: input.pinned } : {}),
        },
      });
      await attachments.attach(tx, fresh, { contentType: PAGES_RECORD_TYPE, contentId: String(recordId), ownerId: actor.userId! });
      await this.recount(tx, record.databaseId, [record.categoryId, data.categoryId]);
      await writeAudit(tx, { actorId: actor.userId, action: "pages.record.update", targetType: "pages_record", targetId: String(recordId), before: { title: record.title }, after: { title: data.title }, ip: actor.ip });
    });
    // Imaginea / fișierele înlocuite nu mai sunt folosite: se șterg.
    const dropped = [...(before.imageId ? [before.imageId] : []), ...before.files].filter((id) => !wanted.includes(id));
    if (dropped.length > 0) await attachments.removeAny(dropped);
    await bus.emit({ name: "pages.record.updated", payload: { recordId, databaseId: record.databaseId }, tags: CHANGE_TAGS });
    return { id: recordId, slug: data.slug };
  }

  /** Aprobă sau respinge (cu motiv) o trimitere în așteptare; autorul e anunțat. */
  async review(actor: GcsActor, recordId: number, decision: "approve" | "reject", reason = ""): Promise<void> {
    const { db, bus, access } = this.deps;
    if (!(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    const record = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, status: true, databaseId: true, categoryId: true, authorId: true, title: true } });
    if (!record) throw new GcsNotFound();
    if (record.status !== "PENDING" && !(decision === "approve" && record.status === "REJECTED")) throw new GcsConflict({ reason: "not_pending" });
    const why = reason.replace(/\s+/g, " ").trim().slice(0, 500);
    const status: PagesRecordStatus = decision === "approve" ? "PUBLISHED" : "REJECTED";
    await db.$transaction(async (tx) => {
      await tx.pagesRecord.update({
        where: { id: recordId },
        data: { status, reviewedById: actor.userId, rejectReason: decision === "reject" ? why || null : null, ...(decision === "approve" ? { publishedAt: new Date() } : {}) },
      });
      await this.recount(tx, record.databaseId, [record.categoryId]);
      await writeAudit(tx, { actorId: actor.userId, action: `pages.record.${decision}`, targetType: "pages_record", targetId: String(recordId), before: { status: record.status }, after: { status, reason: why }, ip: actor.ip });
    });
    await bus.emit({ name: "pages.record.reviewed", payload: { recordId, databaseId: record.databaseId, authorId: record.authorId, decision, reason: why, title: record.title }, tags: CHANGE_TAGS });
  }

  /** Ascunde sau arată din nou o înregistrare publicată (staff-ul). */
  async setHidden(actor: GcsActor, recordId: number, hidden: boolean): Promise<void> {
    const { db, bus, access } = this.deps;
    if (!(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    const record = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, status: true, databaseId: true, categoryId: true, publishedAt: true } });
    if (!record) throw new GcsNotFound();
    if (hidden ? record.status !== "PUBLISHED" : record.status !== "HIDDEN") throw new GcsConflict({ reason: "invalid_state" });
    await db.$transaction(async (tx) => {
      await tx.pagesRecord.update({ where: { id: recordId }, data: { status: hidden ? "HIDDEN" : "PUBLISHED", ...(hidden || record.publishedAt ? {} : { publishedAt: new Date() }) } });
      await this.recount(tx, record.databaseId, [record.categoryId]);
      await writeAudit(tx, { actorId: actor.userId, action: hidden ? "pages.record.hide" : "pages.record.unhide", targetType: "pages_record", targetId: String(recordId), before: { status: record.status }, after: null, ip: actor.ip });
    });
    await bus.emit({ name: "pages.record.updated", payload: { recordId, databaseId: record.databaseId }, tags: CHANGE_TAGS });
  }

  /** „Recomandată” / „fixată” (staff-ul), fără restul formularului. */
  async setFlags(actor: GcsActor, recordId: number, flags: GcsPagesRecordFlags): Promise<void> {
    const { db, bus, access } = this.deps;
    if (!(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    const record = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, databaseId: true } });
    if (!record) throw new GcsNotFound();
    await db.pagesRecord.update({ where: { id: recordId }, data: { ...(flags.featured !== undefined ? { featured: flags.featured } : {}), ...(flags.pinned !== undefined ? { pinned: flags.pinned } : {}) } });
    await writeAudit(db, { actorId: actor.userId, action: "pages.record.flags", targetType: "pages_record", targetId: String(recordId), before: null, after: flags, ip: actor.ip });
    await bus.emit({ name: "pages.record.updated", payload: { recordId, databaseId: record.databaseId }, tags: CHANGE_TAGS });
  }

  /** Șterge o înregistrare (staff-ul; autorul doar cât e în așteptare sau respinsă), cu comentariile, notele și fișierele ei. */
  async delete(actor: GcsActor, recordId: number): Promise<{ databaseId: number }> {
    const { db, bus, access, attachments } = this.deps;
    const record = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, status: true, databaseId: true, categoryId: true, authorId: true, title: true } });
    if (!record) throw new GcsNotFound();
    const own = record.authorId !== null && record.authorId === actor.userId && (record.status === "PENDING" || record.status === "REJECTED");
    if (!own && !(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    await db.$transaction(async (tx) => {
      await tx.pagesRecord.delete({ where: { id: recordId } });
      await tx.contentRating.deleteMany({ where: { contentType: PAGES_RECORD_TYPE, contentId: String(recordId) } });
      await tx.contentRatingSummary.deleteMany({ where: { contentType: PAGES_RECORD_TYPE, contentId: String(recordId) } });
      await this.recount(tx, record.databaseId, [record.categoryId]);
      await writeAudit(tx, { actorId: actor.userId, action: "pages.record.delete", targetType: "pages_record", targetId: String(recordId), before: { title: record.title, status: record.status }, after: null, ip: actor.ip });
    });
    await attachments.deleteFor(PAGES_RECORD_TYPE, [String(recordId)]);
    await bus.emit({ name: "pages.record.deleted", payload: { recordId, databaseId: record.databaseId }, tags: CHANGE_TAGS });
    return { databaseId: record.databaseId };
  }

  /** Mai multe înregistrări odată (coada din ACP): aprobă / respinge / ascunde / arată / șterge. Întoarce câte au reușit. */
  async bulk(actor: GcsActor, ids: number[], action: "approve" | "reject" | "hide" | "unhide" | "delete", reason = ""): Promise<number> {
    let done = 0;
    for (const id of [...new Set(ids)].slice(0, 100)) {
      try {
        if (action === "approve" || action === "reject") await this.review(actor, id, action, reason);
        else if (action === "hide" || action === "unhide") await this.setHidden(actor, id, action === "hide");
        else await this.delete(actor, id);
        done++;
      } catch (error) {
        if (error instanceof GcsForbidden) throw error;
      }
    }
    return done;
  }

  /** O vizualizare a înregistrării (cel mult una pe oră de la același vizitator). */
  async viewed(recordId: number, visitor: string): Promise<void> {
    const res = await this.deps.rateLimiter.consume(`pages-view:${recordId}:${visitor}`, { window: VIEW_WINDOW, max: 1 });
    if (res.allowed) await this.deps.db.pagesRecord.updateMany({ where: { id: recordId }, data: { views: { increment: 1 } } });
  }

  // ─── Comentariile ──────────────────────────────────────────────────────────────────────────────────────────

  async comment(actor: GcsActor, recordId: number, content: unknown): Promise<{ id: number }> {
    const { db, bus, access, renderComment, checkWrite } = this.deps;
    const record = await db.pagesRecord.findUnique({ where: { id: recordId }, select: { id: true, status: true, databaseId: true, authorId: true } });
    if (!record || record.status !== "PUBLISHED") throw new GcsNotFound();
    const d = await this.loadDb(record.databaseId);
    if (!(await access.canViewDatabase(actor, d))) throw new GcsNotFound();
    if (!(await access.canComment(actor, d))) throw new GcsForbidden({ permission: "pages.comment" });
    await checkWrite(actor);
    const rendered = await renderComment(content, actor);
    if (!rendered.text.trim() && rendered.attachments.length === 0) throw new GcsValidationError({ content: "required" });
    const row = await db.$transaction(async (tx) => {
      const c = await tx.pagesComment.create({ data: { recordId, authorId: actor.userId, contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html } });
      await tx.pagesRecord.update({ where: { id: recordId }, data: { commentsCount: { increment: 1 }, lastCommentAt: c.createdAt } });
      return c;
    });
    await bus.emit({
      name: "pages.comment.created",
      payload: { commentId: row.id, recordId, authorId: actor.userId, recordAuthorId: record.authorId, mentions: rendered.mentions, groupMentions: rendered.groupMentions },
      tags: CHANGE_TAGS,
    });
    return { id: row.id };
  }

  async editComment(actor: GcsActor, commentId: number, content: unknown): Promise<void> {
    const { db, bus, access, renderComment } = this.deps;
    const c = await db.pagesComment.findUnique({ where: { id: commentId }, select: { id: true, authorId: true, recordId: true } });
    if (!c) throw new GcsNotFound();
    if (c.authorId !== actor.userId && !(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    const rendered = await renderComment(content, actor);
    if (!rendered.text.trim()) throw new GcsValidationError({ content: "required" });
    await db.pagesComment.update({ where: { id: commentId }, data: { contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, editedAt: new Date() } });
    await bus.emit({ name: "pages.comment.updated", payload: { commentId, recordId: c.recordId }, tags: CHANGE_TAGS });
  }

  async setCommentHidden(actor: GcsActor, commentId: number, hidden: boolean): Promise<void> {
    const { db, bus, access } = this.deps;
    if (!(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    const c = await db.pagesComment.findUnique({ where: { id: commentId }, select: { id: true, recordId: true, hidden: true } });
    if (!c) throw new GcsNotFound();
    if (c.hidden === hidden) return;
    await db.$transaction(async (tx) => {
      await tx.pagesComment.update({ where: { id: commentId }, data: { hidden } });
      await tx.pagesRecord.update({ where: { id: c.recordId }, data: { commentsCount: { increment: hidden ? -1 : 1 } } });
      await writeAudit(tx, { actorId: actor.userId, action: hidden ? "pages.comment.hide" : "pages.comment.unhide", targetType: "pages_comment", targetId: String(commentId), before: null, after: null, ip: actor.ip });
    });
    await bus.emit({ name: "pages.comment.updated", payload: { commentId, recordId: c.recordId }, tags: CHANGE_TAGS });
  }

  async deleteComment(actor: GcsActor, commentId: number): Promise<void> {
    const { db, bus, access } = this.deps;
    const c = await db.pagesComment.findUnique({ where: { id: commentId }, select: { id: true, authorId: true, recordId: true, hidden: true, contentHtml: true } });
    if (!c) throw new GcsNotFound();
    if (c.authorId !== actor.userId && !(await access.isStaff(actor))) throw new GcsForbidden({ permission: "pages.moderate" });
    await db.$transaction(async (tx) => {
      await tx.pagesComment.delete({ where: { id: commentId } });
      if (!c.hidden) await tx.pagesRecord.update({ where: { id: c.recordId }, data: { commentsCount: { decrement: 1 } } });
      await writeAudit(tx, { actorId: actor.userId, action: "pages.comment.delete", targetType: "pages_comment", targetId: String(commentId), before: { text: plainText(c.contentHtml, 200) }, after: null, ip: actor.ip });
    });
    await bus.emit({ name: "pages.comment.updated", payload: { commentId, recordId: c.recordId }, tags: CHANGE_TAGS });
  }
}
