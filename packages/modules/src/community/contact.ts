import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsMailer, type GcsNotificationService, type GcsRateLimiter, type GcsSettingDef, type GcsSettingsService } from "@gcs/core";
import type { ContactMessage, Prisma, PrismaClient } from "@gcs/db";
import type { GcsAntispamService } from "../antispam/service";

/** Secțiunea ACP (ACP › Setări › Contact): `view` = mesajele, `edit` = setările și răspunsurile, `delete` = ștergerea. */
export const CONTACT_ACP_SECTION = "system.settings_contact";
export const CONTACT_SETTING = "contact.config";
export const CONTACT_HREF = "/contact";
/** Notificarea staff-ului la un mesaj nou (ținta: id-ul mesajului). */
export const CONTACT_NOTIFICATION = "core.contact_message";
/** Jobul zilnic care șterge mesajele mai vechi de `keepDays`. */
export const CONTACT_PRUNE_JOB = "contact.prune";
export const CONTACT_PER_PAGE = 25;

export const GCS_CONTACT_STATUSES = ["new", "read", "answered", "archived"] as const;
export type GcsContactStatus = (typeof GCS_CONTACT_STATUSES)[number];

export type GcsContactConfig = {
  /** Pagina `/contact` și formularul. */
  enabled: boolean;
  /** Și vizitatorii (cu captcha-ul invizibil); altfel doar membrii autentificați. */
  guests: boolean;
  /** Textul de deasupra formularului. */
  intro: string;
  /** Subiectele din listă; goală = subiect liber. */
  subjects: string[];
  /** Clopoțelul staff-ului cu acces la Contact. */
  notifyStaff: boolean;
  /** Copii pe email ale fiecărui mesaj. */
  emails: string[];
  /** O adresă externă: `/contact` trimite acolo în loc de formular. */
  redirectUrl: string;
  /** Mesajele mai vechi de atâtea zile se șterg (zilnic). */
  keepDays: number;
};

export const DEFAULT_CONTACT: GcsContactConfig = {
  enabled: true,
  guests: true,
  intro: "",
  subjects: ["Întrebare generală", "Problemă tehnică", "Reclamație", "Parteneriat"],
  notifyStaff: true,
  emails: [],
  redirectUrl: "",
  keepDays: 365,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsContactConfig>;
  if (typeof c.enabled !== "boolean" || typeof c.guests !== "boolean" || typeof c.notifyStaff !== "boolean") return "invalid";
  if (typeof c.intro !== "string" || c.intro.length > 2000) return "too_long";
  if (!Array.isArray(c.subjects) || c.subjects.length > 20 || c.subjects.some((s) => typeof s !== "string" || s.trim() === "" || s.length > 80)) return "invalid";
  if (!Array.isArray(c.emails) || c.emails.length > 10 || c.emails.some((e) => typeof e !== "string" || !EMAIL_RE.test(e))) return "invalid_email";
  if (typeof c.redirectUrl !== "string" || (c.redirectUrl !== "" && !/^https?:\/\//i.test(c.redirectUrl)) || (c.redirectUrl !== "" && !URL.canParse(c.redirectUrl))) return "invalid_url";
  if (!Number.isInteger(c.keepDays) || c.keepDays! < 30 || c.keepDays! > 3650) return "invalid_range";
  return null;
}

export const contactSetting: GcsSettingDef = { key: CONTACT_SETTING, type: "json", default: DEFAULT_CONTACT, section: "contact", labelKey: "settings.contact.config", validate: contactConfigError };

export type GcsContactInput = { name: string; email: string; subject: string; body: string; pow: string | null; ip: string | null };
export type GcsContactFilter = { status?: "open" | "archived" | "all"; q?: string; page: number };

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/**
 * Formularul de contact (`/contact`) și cutia lui din ACP › Setări › Contact. Un mesaj trimis (membru sau vizitator cu
 * captcha) se salvează, anunță staff-ul (clopoțel) și pleacă în copie la adresele alese; din ACP se citește, se
 * răspunde pe email (cu jurnal), se arhivează sau se șterge. Mesajele vechi se curăță după `keepDays`.
 */
export class GcsContactService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      settings: Pick<GcsSettingsService, "get" | "set">;
      acp: Pick<GcsAcpRoleService, "assert" | "usersWith">;
      notifications: Pick<GcsNotificationService, "notify">;
      mailer: GcsMailer;
      rateLimiter: Pick<GcsRateLimiter, "consume">;
      antispam: Pick<GcsAntispamService, "verifyPow" | "captchaMode">;
      siteName: () => Promise<string>;
    },
  ) {}

  async config(): Promise<GcsContactConfig> {
    const v = await this.deps.settings.get<GcsContactConfig | null>(CONTACT_SETTING).catch(() => null);
    return v && contactConfigError(v) === null ? v : DEFAULT_CONTACT;
  }

  async saveConfig(actor: GcsActor, value: GcsContactConfig): Promise<void> {
    await this.deps.acp.assert(actor, CONTACT_ACP_SECTION, "edit");
    await this.deps.settings.set(CONTACT_SETTING, value, actor);
  }

  /** Trimiterea din `/contact`. Membrii trimit cu numele și emailul contului; vizitatorii trec prin captcha. */
  async submit(actor: GcsActor, input: GcsContactInput, account: { name: string; email: string } | null): Promise<{ id: number }> {
    const cfg = await this.config();
    if (!cfg.enabled || cfg.redirectUrl) throw new GcsNotFound({ entity: "contact" });
    const member = actor.userId !== null && account !== null;
    if (!member && !cfg.guests) throw new GcsForbidden({ reason: "login_required" });
    if (actor.isBanned) throw new GcsForbidden({ reason: "banned" });

    // Conturile Steam au un email fictiv (`…@steam.invalid`): membrul își scrie atunci adresa pentru răspuns.
    const accountEmail = member && !account!.email.endsWith(".invalid") ? account!.email : null;
    const name = (member ? account!.name : input.name).trim();
    const email = (accountEmail ?? input.email).trim().toLowerCase();
    const subject = input.subject.trim();
    const body = input.body.trim();
    const errors: Record<string, string> = {};
    if (name.length < 2 || name.length > 60) errors.name = "length";
    if (!EMAIL_RE.test(email) || email.length > 190 || email.endsWith(".invalid")) errors.email = "invalid_email";
    if (cfg.subjects.length > 0 ? !cfg.subjects.includes(subject) : subject.length < 3 || subject.length > 120) errors.subject = cfg.subjects.length > 0 ? "invalid_choice" : "length";
    if (body.length < 10 || body.length > 5000) errors.body = "length";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    // Câte 3 mesaje la 10 minute de pe un IP / cont (și captcha-ul pentru vizitatori, dacă e pornit).
    const limit = await this.deps.rateLimiter.consume(`contact:${actor.userId ?? input.ip ?? "anon"}`, { window: 600, max: 3 });
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter ?? 600) });
    if (!member && (await this.deps.antispam.captchaMode()) !== "none") await this.deps.antispam.verifyPow(input.pow, { ip: input.ip, email }, { form: "contact" });

    const row = await this.deps.db.contactMessage.create({ data: { userId: member ? actor.userId : null, name, email, subject, body, ip: input.ip }, select: { id: true } });
    if (cfg.notifyStaff) {
      const staff = (await this.deps.acp.usersWith(CONTACT_ACP_SECTION, "view")).filter((id) => id !== actor.userId);
      if (staff.length > 0) {
        await this.deps.notifications
          .notify({ userIds: staff, type: CONTACT_NOTIFICATION, targetType: CONTACT_NOTIFICATION, targetId: String(row.id), actorId: member ? actor.userId : null, data: { from: name } })
          .catch(() => {});
      }
    }
    if (cfg.emails.length > 0) {
      const site = await this.deps.siteName().catch(() => "");
      const html = `<p><strong>${escape(name)}</strong> &lt;${escape(email)}&gt;</p><p><strong>${escape(subject)}</strong></p><p>${escape(body).replace(/\n/g, "<br>")}</p>`;
      for (const to of cfg.emails) {
        await this.deps.mailer({ to, subject: `[${site || "Contact"}] ${subject}`, html, text: `${name} <${email}>\n${subject}\n\n${body}` }).catch(() => {});
      }
    }
    return row;
  }

  async list(actor: GcsActor, filter: GcsContactFilter): Promise<{ items: ContactMessage[]; total: number; page: number; pages: number; counts: Record<GcsContactStatus, number> }> {
    await this.deps.acp.assert(actor, CONTACT_ACP_SECTION, "view");
    const { db } = this.deps;
    const and: Prisma.ContactMessageWhereInput[] = [];
    if (filter.status === "archived") and.push({ status: "archived" });
    else if (filter.status !== "all") and.push({ status: { not: "archived" } });
    const q = filter.q?.trim();
    if (q) and.push({ OR: [{ name: { contains: q } }, { email: { contains: q.toLowerCase() } }, { subject: { contains: q } }] });
    const where = and.length > 0 ? { AND: and } : {};
    const [total, grouped] = await Promise.all([db.contactMessage.count({ where }), db.contactMessage.groupBy({ by: ["status"], _count: { _all: true } })]);
    const pages = Math.max(1, Math.ceil(total / CONTACT_PER_PAGE));
    const page = Math.min(Math.max(1, filter.page), pages);
    const items = await db.contactMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * CONTACT_PER_PAGE, take: CONTACT_PER_PAGE });
    const counts = Object.fromEntries(GCS_CONTACT_STATUSES.map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0])) as Record<GcsContactStatus, number>;
    return { items, total, page, pages, counts };
  }

  async setStatus(actor: GcsActor, id: number, status: GcsContactStatus): Promise<void> {
    await this.deps.acp.assert(actor, CONTACT_ACP_SECTION, "edit");
    if (!GCS_CONTACT_STATUSES.includes(status)) throw new GcsValidationError({ status: "invalid_choice" });
    const { count } = await this.deps.db.contactMessage.updateMany({ where: { id }, data: { status, handledById: actor.userId, handledAt: new Date() } });
    if (count === 0) throw new GcsNotFound({ entity: "contact_message" });
  }

  /** Răspunsul pe email către expeditor; mesajul devine „răspuns”, iar textul intră în jurnalul ACP. */
  async reply(actor: GcsActor, id: number, text: string): Promise<void> {
    await this.deps.acp.assert(actor, CONTACT_ACP_SECTION, "edit");
    const body = text.trim();
    if (body.length < 2 || body.length > 10_000) throw new GcsValidationError({ reply: "length" });
    const msg = await this.deps.db.contactMessage.findUnique({ where: { id } });
    if (!msg) throw new GcsNotFound({ entity: "contact_message" });
    const site = await this.deps.siteName().catch(() => "");
    const quoted = msg.body.split("\n").map((l) => `> ${l}`).join("\n");
    await this.deps.mailer({
      to: msg.email,
      subject: `Re: ${msg.subject}${site ? ` · ${site}` : ""}`,
      html: `<p>${escape(body).replace(/\n/g, "<br>")}</p><hr><blockquote style="color:#667">${escape(msg.body).replace(/\n/g, "<br>")}</blockquote>`,
      text: `${body}\n\n${quoted}`,
    });
    await this.deps.db.contactMessage.update({ where: { id }, data: { status: "answered", handledById: actor.userId, handledAt: new Date() } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "contact.reply", targetType: "contact_message", targetId: String(id), after: { reply: body }, ip: actor.ip });
  }

  /** Răspunsurile trimise unui mesaj (din jurnalul ACP), cele mai vechi primele. */
  async replies(ids: number[]): Promise<Map<number, { at: Date; actorId: string | null; text: string }[]>> {
    const out = new Map<number, { at: Date; actorId: string | null; text: string }[]>();
    if (ids.length === 0) return out;
    const rows = await this.deps.db.auditLog.findMany({ where: { action: "contact.reply", targetType: "contact_message", targetId: { in: ids.map(String) } }, orderBy: { createdAt: "asc" } });
    for (const r of rows) {
      const text = (r.after as { reply?: unknown } | null)?.reply;
      if (typeof text !== "string") continue;
      const key = Number(r.targetId);
      out.set(key, [...(out.get(key) ?? []), { at: r.createdAt, actorId: r.actorId, text }]);
    }
    return out;
  }

  async remove(actor: GcsActor, ids: number[]): Promise<number> {
    await this.deps.acp.assert(actor, CONTACT_ACP_SECTION, "delete");
    const { count } = await this.deps.db.contactMessage.deleteMany({ where: { id: { in: [...new Set(ids)].slice(0, 200) } } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "contact.delete", targetType: "contact_message", targetId: ids.length === 1 ? String(ids[0]) : String(count), ip: actor.ip });
    return count;
  }

  /** Jobul zilnic: mesajele mai vechi de `keepDays`. */
  async prune(now = new Date()): Promise<number> {
    const { keepDays } = await this.config();
    const { count } = await this.deps.db.contactMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - keepDays * 86_400_000) } } });
    return count;
  }
}
