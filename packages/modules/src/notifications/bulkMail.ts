import { createHmac, timingSafeEqual } from "node:crypto";
import { GCS_RICH_FIELDS, GcsNotFound, GcsValidationError, renderRichField, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsMailer, type GcsSettingDef, type GcsSettingsService } from "@gcs/core";
import type { BulkMail, Prisma, PrismaClient } from "@gcs/db";

/** Secțiunea ACP (ACP › Membri › Comunicare › Email în masă). */
export const BULK_MAIL_ACP_SECTION = "members.bulk_mail";
/** Jobul care trimite lotul următor al fiecărui email în curs (la minut). */
export const BULK_MAIL_JOB = "members.bulk_mail";
/** Câte emailuri pleacă pe minut (pe toate trimiterile în curs). */
export const BULK_MAIL_RATE_SETTING = "bulk_mail.per_minute";
export const bulkMailRateSetting: GcsSettingDef = {
  key: BULK_MAIL_RATE_SETTING,
  type: "number",
  default: 60,
  section: "bulk_mail",
  labelKey: "settings.bulk_mail.per_minute",
  validate: (v) => (Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 1000 ? null : "invalid_range"),
};

export type GcsBulkAudience = {
  /** Grupurile țintă; gol = toți membrii. */
  groupIds: number[];
  /** Doar membrii cu unul dintre grupuri ca grup principal (altfel și ca grup secundar). */
  primaryOnly: boolean;
  /** Doar cei activi în ultimele N zile (`null` = oricând). */
  activeDays: number | null;
};

export type GcsBulkMailInput = { subject: string; body: unknown; audience: GcsBulkAudience };
export type GcsBulkMailView = Omit<BulkMail, "audience"> & { audience: GcsBulkAudience };

const isAudience = (v: unknown): v is GcsBulkAudience => {
  if (!v || typeof v !== "object") return false;
  const a = v as GcsBulkAudience;
  return Array.isArray(a.groupIds) && a.groupIds.every((g) => Number.isInteger(g)) && typeof a.primaryOnly === "boolean" && (a.activeDays === null || (Number.isInteger(a.activeDays) && a.activeDays > 0));
};
const view = (m: BulkMail): GcsBulkMailView => ({ ...m, audience: isAudience(m.audience) ? m.audience : { groupIds: [], primaryOnly: false, activeDays: null } });
const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Semnătura linkului de dezabonare (fără stare: HMAC pe id-ul membrului cu secretul aplicației). */
export function unsubscribeToken(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(`admin-mail:${userId}`).digest("base64url").slice(0, 32);
}

export function validUnsubscribeToken(secret: string, userId: string, token: string): boolean {
  const want = Buffer.from(unsubscribeToken(secret, userId));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Email în masă: ciorna (subiect + documentul editorului, randat cu același sanitizer ca anunțurile), publicul după
 * grupuri / activitate, testul pe adresa adminului, apoi trimiterea pe loturi (jobul la minut, cel mult
 * `bulk_mail.per_minute` emailuri). Primesc doar membrii cu email confirmat și real, nebanați, care nu s-au dezabonat de
 * la emailurile administratorilor (setarea lor sau linkul din fiecare email). `{name}` și `{site}` se înlocuiesc.
 */
export class GcsBulkMailService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: Pick<GcsAcpRoleService, "assert">;
      settings: Pick<GcsSettingsService, "get">;
      mailer: GcsMailer;
      secret: () => string;
      baseUrl: () => Promise<string>;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private validate(input: GcsBulkMailInput): { subject: string; json: Prisma.InputJsonValue; html: string; audience: GcsBulkAudience } {
    const subject = input.subject.trim();
    if (subject.length < 3 || subject.length > 150) throw new GcsValidationError({ subject: "length" });
    if (!isAudience(input.audience)) throw new GcsValidationError({ audience: "invalid" });
    const rendered = renderRichField(input.body, GCS_RICH_FIELDS.announcement, { field: "body", maxChars: 20_000, maxImages: 6 });
    if (rendered.text.trim().length < 5) throw new GcsValidationError({ body: "required" });
    return { subject, json: rendered.json as Prisma.InputJsonValue, html: rendered.html, audience: { ...input.audience, groupIds: [...new Set(input.audience.groupIds)] } };
  }

  /** Condiția destinatarilor (fără cursor). */
  private recipientsWhere(a: GcsBulkAudience): Prisma.UserWhereInput {
    const now = this.now();
    const and: Prisma.UserWhereInput[] = [
      { emailVerified: true, isBot: false, isSpammer: false },
      { NOT: { email: { endsWith: ".invalid" } } },
      // „Nedezabonat”: fără rând de livrare sau cu emailurile adminilor și toate emailurile pornite.
      { OR: [{ notificationMember: { is: null } }, { notificationMember: { is: { adminMailOff: false, emailsOff: false } } }] },
    ];
    and.push({ bans: { none: { type: "ACCOUNT", liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } });
    if (a.groupIds.length > 0) {
      and.push(a.primaryOnly ? { primaryGroupId: { in: a.groupIds } } : { OR: [{ primaryGroupId: { in: a.groupIds } }, { groups: { some: { groupId: { in: a.groupIds } } } }] });
    }
    if (a.activeDays !== null) and.push({ lastActiveAt: { gte: new Date(now.getTime() - a.activeDays * 86_400_000) } });
    return { AND: and };
  }

  async count(actor: GcsActor, audience: GcsBulkAudience): Promise<number> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "view");
    if (!isAudience(audience)) throw new GcsValidationError({ audience: "invalid" });
    return this.deps.db.user.count({ where: this.recipientsWhere(audience) });
  }

  async list(actor: GcsActor): Promise<GcsBulkMailView[]> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "view");
    return (await this.deps.db.bulkMail.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 })).map(view);
  }

  /** O ciornă nouă (`id` = `null`) sau modificarea uneia (doar cât e ciornă). */
  async save(actor: GcsActor, id: number | null, input: GcsBulkMailInput): Promise<{ id: number }> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "edit");
    const v = this.validate(input);
    const data = { subject: v.subject, bodyJson: v.json, bodyHtml: v.html, audience: v.audience as unknown as Prisma.InputJsonValue };
    if (id === null) return this.deps.db.bulkMail.create({ data: { ...data, createdById: actor.userId }, select: { id: true } });
    const { count } = await this.deps.db.bulkMail.updateMany({ where: { id, status: "draft" }, data });
    if (count === 0) throw new GcsNotFound({ entity: "bulk_mail" });
    return { id };
  }

  /** O copie ca ciornă nouă (ex. a unui email deja trimis). */
  async duplicate(actor: GcsActor, id: number): Promise<{ id: number }> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "edit");
    const m = await this.deps.db.bulkMail.findUnique({ where: { id } });
    if (!m) throw new GcsNotFound({ entity: "bulk_mail" });
    return this.deps.db.bulkMail.create({
      data: { subject: m.subject, bodyJson: m.bodyJson as Prisma.InputJsonValue, bodyHtml: m.bodyHtml, audience: m.audience as Prisma.InputJsonValue, createdById: actor.userId },
      select: { id: true },
    });
  }

  private async personal(m: Pick<BulkMail, "subject" | "bodyHtml">, user: { id: string; name: string }, site: string, base: string): Promise<{ subject: string; html: string; text: string }> {
    const fill = (s: string, esc: boolean) => s.replace(/\{name\}/g, esc ? escape(user.name) : user.name).replace(/\{site\}/g, esc ? escape(site) : site);
    const link = `${base.replace(/\/$/, "")}/unsubscribe?u=${encodeURIComponent(user.id)}&t=${unsubscribeToken(this.deps.secret(), user.id)}`;
    const html = `${fill(m.bodyHtml, true)}<hr><p style="font-size:12px;color:#888">Primești acest email pentru că ești membru ${escape(site)}. <a href="${escape(link)}">Dezabonare de la emailurile administratorilor</a></p>`;
    const text = `${fill(m.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), false)}\n\n---\nDezabonare: ${link}`;
    return { subject: fill(m.subject, false), html, text };
  }

  /** Testul: emailul pleacă doar la adresa adminului, cu numele lui în locul `{name}`. */
  async sendTest(actor: GcsActor, id: number): Promise<string> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "edit");
    const [m, me, site, base] = await Promise.all([
      this.deps.db.bulkMail.findUnique({ where: { id } }),
      actor.userId ? this.deps.db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true, email: true } }) : null,
      this.deps.settings.get<string>("site.name").catch(() => ""),
      this.deps.baseUrl(),
    ]);
    if (!m) throw new GcsNotFound({ entity: "bulk_mail" });
    if (!me || me.email.endsWith(".invalid")) throw new GcsValidationError({ email: "invalid_email" });
    const p = await this.personal(m, me, site, base);
    await this.deps.mailer({ to: me.email, subject: `[Test] ${p.subject}`, html: p.html, text: p.text });
    return me.email;
  }

  /** Pornește trimiterea: numărul destinatarilor de acum, apoi jobul trimite pe loturi. */
  async start(actor: GcsActor, id: number): Promise<number> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "edit");
    const m = await this.deps.db.bulkMail.findUnique({ where: { id } });
    if (!m || m.status !== "draft") throw new GcsNotFound({ entity: "bulk_mail" });
    const total = await this.deps.db.user.count({ where: this.recipientsWhere(view(m).audience) });
    if (total === 0) throw new GcsValidationError({ audience: "empty" });
    await this.deps.db.bulkMail.update({ where: { id }, data: { status: "sending", total, sent: 0, failed: 0, cursor: null, startedAt: this.now() } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "members.bulk_mail_start", targetType: "bulk_mail", targetId: String(id), after: { subject: m.subject, total }, ip: actor.ip });
    return total;
  }

  async cancel(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "edit");
    const { count } = await this.deps.db.bulkMail.updateMany({ where: { id, status: "sending" }, data: { status: "cancelled", finishedAt: this.now() } });
    if (count === 0) throw new GcsNotFound({ entity: "bulk_mail" });
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, BULK_MAIL_ACP_SECTION, "delete");
    const { count } = await this.deps.db.bulkMail.deleteMany({ where: { id, status: { not: "sending" } } });
    if (count === 0) throw new GcsNotFound({ entity: "bulk_mail" });
  }

  /** Jobul: lotul următor al fiecărui email în curs, în limita pe minut. Întoarce câte emailuri au plecat. */
  async tick(): Promise<number> {
    const { db } = this.deps;
    const sending = await db.bulkMail.findMany({ where: { status: "sending" }, orderBy: { id: "asc" } });
    if (sending.length === 0) return 0;
    const perMinute = await this.deps.settings.get<number>(BULK_MAIL_RATE_SETTING).catch(() => 60);
    const [site, base] = await Promise.all([this.deps.settings.get<string>("site.name").catch(() => ""), this.deps.baseUrl()]);
    let budget = Number.isInteger(perMinute) && perMinute > 0 ? perMinute : 60;
    let total = 0;
    for (const m of sending) {
      if (budget <= 0) break;
      const want = budget;
      const where = this.recipientsWhere(view(m).audience);
      const batch = await db.user.findMany({ where: m.cursor ? { AND: [where, { id: { gt: m.cursor } }] } : where, orderBy: { id: "asc" }, take: want, select: { id: true, name: true, email: true } });
      let sent = 0;
      let failed = 0;
      for (const u of batch) {
        const p = await this.personal(m, u, site, base);
        try {
          await this.deps.mailer({ to: u.email, subject: p.subject, html: p.html, text: p.text });
          sent++;
        } catch {
          failed++;
        }
      }
      budget -= batch.length;
      total += sent;
      // Mai puțini destinatari decât s-au cerut = lista s-a terminat.
      const done = batch.length < want;
      await db.bulkMail.update({
        where: { id: m.id },
        data: {
          sent: { increment: sent },
          failed: { increment: failed },
          ...(batch.length > 0 ? { cursor: batch[batch.length - 1]!.id } : {}),
          ...(done ? { status: "sent", finishedAt: this.now() } : {}),
        },
      });
    }
    return total;
  }

  /** Dezabonarea din linkul emailului (semnat). Întoarce `false` la un link greșit. */
  async unsubscribe(userId: string, token: string): Promise<boolean> {
    if (!validUnsubscribeToken(this.deps.secret(), userId, token)) return false;
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return false;
    await this.setOptOut(userId, true);
    return true;
  }

  /** Setarea membrului: emailurile administratorilor oprite / pornite. */
  async setOptOut(userId: string, off: boolean): Promise<void> {
    await this.deps.db.notificationMember.upsert({ where: { userId }, create: { userId, adminMailOff: off }, update: { adminMailOff: off } });
  }

  async optedOut(userId: string): Promise<boolean> {
    return (await this.deps.db.notificationMember.findUnique({ where: { userId }, select: { adminMailOff: true } }))?.adminMailOff === true;
  }
}
