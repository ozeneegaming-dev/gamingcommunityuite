import {
  assertCanManageUser,
  countImages,
  createPowChallenge,
  emailDomain,
  extractUrls,
  findPhishing,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  isLocalIp,
  normalizeAnswer,
  normalizeHost,
  parseDomainList,
  verifyPowToken,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsBanService,
  type GcsCache,
  type GcsEventBus,
  type GcsPhishingLists,
  type GcsPowChallenge,
  type GcsRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import { Prisma, type PrismaClient, type RegistrationQuestion, type SpamLog } from "@gcs/db";

/** ACP › Moderare › Anti-spam: setările, întrebările, jurnalul (`view`) și „Marchează ca spammer” (`edit`). */
export const ANTISPAM_ACP_SECTION = "members.antispam";

export const SPAM_LOG_KINDS = [
  "captcha_failed",
  "qa_failed",
  "spam_source",
  "phishing_blocked",
  "links_blocked",
  "links_moderated",
  "images_blocked",
  "pm_limited",
  "spammer_marked",
  "multi_account",
] as const;
export type GcsSpamLogKind = (typeof SPAM_LOG_KINDS)[number];

/** Unde se verifică un conținut (membrii noi: linkurile intră în aprobare doar la postările din forum). */
export type GcsContentKind = "post" | "post_edit" | "pm" | "chat" | "signature" | "status";
/** Ce folosesc aplicațiile din serviciu la scriere (linkurile, imaginile, ritmul membrilor noi). */
export type GcsContentGuard = Pick<GcsAntispamService, "checkContent" | "checkPmQuota" | "checkChatPace">;

/** Furnizorii mari de email nu se banează ca domeniu întreg („Marchează ca spammer” sare peste ei). */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.ro",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.ru",
  "yandex.ru",
  "yandex.com",
]);

const SFS_ENDPOINT = "https://api.stopforumspam.org/api";
const SFS_REPORT_ENDPOINT = "https://www.stopforumspam.com/add";
const SFS_CACHE_TTL = 24 * 3600;
const LOG_PAGE = 50;

export type GcsRegistrationChallenge = { captcha: "none" | "pow" | "turnstile"; question: { id: number; text: string } | null };
export type GcsRegistrationCheck = { ip: string | null; email: string; name?: string; pow: string | null; questionId: number | null; answer: string | null; locale: string };
/** Ce face o aplicație cu conținutul unui spammer (ascunde postările, mesajele din chat …): câte elemente a atins. */
export type GcsSpammerContentHandler = { key: string; hide: (userId: string, actor: GcsActor) => Promise<number> };
export type GcsSpammerOptions = { banIp: boolean; banEmailDomain: boolean; hideContent: boolean; report: boolean; reason?: string };
export type GcsSpammerResult = { banned: boolean; ips: string[]; domain: string | null; hidden: Record<string, number>; reported: boolean };
export type GcsSpamLogRow = SpamLog & { user: { id: string; name: string } | null };
export type GcsSpamStats = { days: number; total: number; byKind: Record<string, number>; perDay: { day: string; count: number }[] };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Apărarea anti-spam (spec anti-spam & moderare §1): captcha-ul proof-of-work propriu (sau Turnstile cu cheia
 * adminului), întrebarea de la înregistrare, verificarea opțională a IP-ului / emailului într-o listă publică de
 * spammeri, restricțiile membrilor noi (linkuri, imagini, mesaje private, aprobare, chat), blocarea linkurilor de
 * phishing pe toate suprafețele de text, „Marchează ca spammer” și jurnalul apărării cu statistici.
 */
export class GcsAntispamService {
  private readonly hiders: GcsSpammerContentHandler[] = [];

  constructor(
    private readonly deps: {
      db: PrismaClient;
      settings: GcsSettingsService;
      cache: GcsCache;
      rateLimiter: GcsRateLimiter;
      bans: GcsBanService;
      acp: GcsAcpRoleService;
      bus: GcsEventBus;
      secret: () => string;
      fetch?: Fetch;
    },
  ) {}

  private get<T>(key: string, fallback: T): Promise<T> {
    return this.deps.settings.get<T>(key).catch(() => fallback);
  }

  /** O aplicație își înregistrează ascunderea conținutului unui spammer (ordinea înregistrării). */
  registerContent(handler: GcsSpammerContentHandler): void {
    if (!this.hiders.some((h) => h.key === handler.key)) this.hiders.push(handler);
  }

  // ─── Jurnalul ─────────────────────────────────────────────────────────────────────────────────────────────

  async log(kind: GcsSpamLogKind, data: { userId?: string | null; ip?: string | null; email?: string | null; detail?: Record<string, unknown> } = {}): Promise<void> {
    await this.deps.db.spamLog
      .create({
        data: {
          kind,
          userId: data.userId ?? null,
          ip: data.ip ?? null,
          email: data.email ?? null,
          ...(data.detail ? { detail: data.detail as Prisma.InputJsonValue } : {}),
        },
      })
      .catch(() => {});
  }

  async logs(actor: GcsActor, filter: { kind?: string; q?: string; page?: number } = {}): Promise<{ rows: GcsSpamLogRow[]; total: number; page: number; pages: number }> {
    await this.deps.acp.assert(actor, ANTISPAM_ACP_SECTION, "view");
    const q = filter.q?.trim();
    const where: Prisma.SpamLogWhereInput = {
      ...(filter.kind && (SPAM_LOG_KINDS as readonly string[]).includes(filter.kind) ? { kind: filter.kind } : {}),
      ...(q ? { OR: [{ ip: { contains: q } }, { email: { contains: q } }, { userId: q }] } : {}),
    };
    const total = await this.deps.db.spamLog.count({ where });
    const pages = Math.max(1, Math.ceil(total / LOG_PAGE));
    const page = Math.min(Math.max(1, filter.page ?? 1), pages);
    const rows = await this.deps.db.spamLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * LOG_PAGE, take: LOG_PAGE });
    const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is string => id !== null))];
    const users = new Map((await this.deps.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
    return { rows: rows.map((r) => ({ ...r, user: r.userId ? (users.get(r.userId) ?? null) : null })), total, page, pages };
  }

  /** Statisticile apărării: pe tip și pe zi (UTC), pe ultimele `days` zile. */
  async stats(actor: GcsActor, days = 30, now = new Date()): Promise<GcsSpamStats> {
    await this.deps.acp.assert(actor, ANTISPAM_ACP_SECTION, "view");
    const since = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.deps.db.spamLog.findMany({ where: { createdAt: { gte: since } }, select: { kind: true, createdAt: true }, take: 50_000 });
    const byKind: Record<string, number> = {};
    const perDayMap = new Map<string, number>();
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      const day = r.createdAt.toISOString().slice(0, 10);
      perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
    }
    const perDay: { day: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      perDay.push({ day, count: perDayMap.get(day) ?? 0 });
    }
    return { days, total: rows.length, byKind, perDay };
  }

  // ─── Înregistrarea ────────────────────────────────────────────────────────────────────────────────────────

  async captchaMode(): Promise<"none" | "pow" | "turnstile"> {
    const mode = await this.get<string>("antispam.captcha", "pow");
    return mode === "none" || mode === "turnstile" ? mode : "pow";
  }

  async powChallenge(now = Date.now()): Promise<GcsPowChallenge> {
    return createPowChallenge(this.deps.secret(), await this.get<number>("antispam.pow_difficulty", 15), now);
  }

  private async questionsFor(locale: string): Promise<RegistrationQuestion[]> {
    if (!(await this.get<boolean>("antispam.qa_enabled", true))) return [];
    return this.deps.db.registrationQuestion.findMany({ where: { enabled: true, OR: [{ locale: null }, { locale }] }, orderBy: { id: "asc" } });
  }

  /** Ce cere formularul de înregistrare: captcha-ul și (dacă există) o întrebare aleasă la întâmplare pentru limba lui. */
  async registrationChallenge(locale: string): Promise<GcsRegistrationChallenge> {
    const [captcha, questions] = await Promise.all([this.captchaMode(), this.questionsFor(locale)]);
    const q = questions.length > 0 ? questions[Math.floor(Math.random() * questions.length)]! : null;
    return { captcha, question: q ? { id: q.id, text: q.question } : null };
  }

  /**
   * Verificarea unei înregistrări cu email: captcha-ul proof-of-work (folosit o singură dată), întrebarea și lista
   * publică de spammeri. Un refuz intră în jurnal și aruncă `GcsForbidden` cu motivul (`captcha_failed`,
   * `qa_failed`, `spam_source`). Turnstile îl verifică pluginul de autentificare.
   */
  async verifyRegistration(input: GcsRegistrationCheck, now = Date.now()): Promise<void> {
    const who = { ip: input.ip, email: input.email };
    if ((await this.captchaMode()) === "pow") await this.verifyPow(input.pow, who, {}, now);
    const questions = await this.questionsFor(input.locale);
    if (questions.length > 0) {
      const q = questions.find((x) => x.id === input.questionId);
      const answers = Array.isArray(q?.answers) ? (q.answers as unknown[]).filter((a): a is string => typeof a === "string") : [];
      const given = normalizeAnswer(input.answer ?? "");
      if (!q || given === "" || !answers.some((a) => normalizeAnswer(a) === given)) {
        await this.log("qa_failed", { ...who, detail: { questionId: input.questionId } });
        throw new GcsForbidden({ reason: "qa_failed" });
      }
    }
    const listed = await this.checkSpamSource(input.ip, input.email);
    if (listed) {
      await this.log("spam_source", { ...who, detail: listed });
      throw new GcsForbidden({ reason: "spam_source" });
    }
  }

  /**
   * Captcha-ul proof-of-work (invizibil): tokenul e semnat, neexpirat și folosit o singură dată. Altfel refuzul intră
   * în jurnal (`captcha_failed`, cu `detail` în plus, ex. formularul) și aruncă `GcsForbidden`.
   */
  async verifyPow(token: string | null, who: { ip: string | null; email: string | null }, detail: Record<string, unknown> = {}, now = Date.now()): Promise<void> {
    const verdict = token ? verifyPowToken(this.deps.secret(), token, now) : ({ ok: false, reason: "missing" } as const);
    const fresh = verdict.ok && (await this.deps.rateLimiter.consume(`pow:${verdict.challenge}`, { window: Math.ceil((verdict.expiresAt - now) / 1000) + 60, max: 1 })).allowed;
    if (!fresh) {
      await this.log("captcha_failed", { ...who, detail: { reason: verdict.ok ? "reused" : verdict.reason, ...detail } });
      throw new GcsForbidden({ reason: "captcha_failed" });
    }
  }

  /**
   * Verificarea opțională în lista publică de spammeri (StopForumSpam): IP-ul și emailul, cu cache 24 h. Doar
   * încrederea peste pragul din ACP blochează; o eroare de rețea lasă înregistrarea să treacă.
   */
  async checkSpamSource(ip: string | null, email: string | null): Promise<{ field: "ip" | "email"; confidence: number } | null> {
    if (!(await this.get<boolean>("antispam.sfs_enabled", false))) return null;
    const threshold = await this.get<number>("antispam.sfs_confidence", 60);
    const lookups: ["ip" | "email", string][] = [];
    if (ip && ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "::1") lookups.push(["ip", ip]);
    if (email) lookups.push(["email", email.toLowerCase()]);
    for (const [field, value] of lookups) {
      const key = `antispam:sfs:${field}:${value}`;
      let confidence = await this.deps.cache.get<number>(key).catch(() => null);
      if (confidence === null) {
        confidence = await this.querySfs(field, value);
        if (confidence === null) continue;
        await this.deps.cache.set(key, confidence, { ttlSec: SFS_CACHE_TTL, tags: ["antispam"] }).catch(() => {});
      }
      if (confidence >= threshold) return { field, confidence };
    }
    return null;
  }

  private async querySfs(field: "ip" | "email", value: string): Promise<number | null> {
    const fetchFn = this.deps.fetch ?? fetch;
    try {
      const res = await fetchFn(`${SFS_ENDPOINT}?json&${field}=${encodeURIComponent(value)}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { success?: number } & Record<string, { appears?: number; confidence?: number } | number | undefined>;
      const entry = body[field];
      if (body.success !== 1 || typeof entry !== "object" || !entry) return null;
      return entry.appears ? Number(entry.confidence ?? 0) : 0;
    } catch {
      return null;
    }
  }

  // ─── Întrebările (ACP) ────────────────────────────────────────────────────────────────────────────────────

  async questions(actor: GcsActor): Promise<RegistrationQuestion[]> {
    await this.deps.acp.assert(actor, ANTISPAM_ACP_SECTION, "view");
    return this.deps.db.registrationQuestion.findMany({ orderBy: { id: "asc" } });
  }

  async saveQuestion(actor: GcsActor, input: { id?: number; locale: string | null; question: string; answers: string[]; enabled: boolean }): Promise<RegistrationQuestion> {
    await this.deps.acp.assert(actor, ANTISPAM_ACP_SECTION, "edit");
    const question = input.question.trim();
    const answers = [...new Set(input.answers.map((a) => a.trim()).filter((a) => normalizeAnswer(a) !== ""))].slice(0, 20);
    const errors: Record<string, string> = {};
    if (question.length < 3 || question.length > 300) errors.question = "invalid_length";
    if (answers.length === 0 || answers.some((a) => a.length > 100)) errors.answers = "required";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = { locale: input.locale || null, question, answers, enabled: input.enabled };
    const row = input.id ? await this.deps.db.registrationQuestion.update({ where: { id: input.id }, data }) : await this.deps.db.registrationQuestion.create({ data });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "antispam.question_save", targetType: "registration_question", targetId: String(row.id), after: { question, locale: data.locale }, ip: actor.ip });
    return row;
  }

  async deleteQuestion(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, ANTISPAM_ACP_SECTION, "edit");
    await this.deps.db.registrationQuestion.deleteMany({ where: { id } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "antispam.question_delete", targetType: "registration_question", targetId: String(id), ip: actor.ip });
  }

  // ─── Membrii noi și conținutul ────────────────────────────────────────────────────────────────────────────

  /**
   * Membru nou = în primele `antispam.new_member_days` zile de la înregistrare sau sub `antispam.new_member_posts`
   * postări aprobate (amândouă 0 = restricțiile sunt oprite).
   */
  async isNewMember(userId: string | null, now = new Date()): Promise<boolean> {
    if (!userId) return false;
    const [days, posts] = await Promise.all([this.get<number>("antispam.new_member_days", 0), this.get<number>("antispam.new_member_posts", 0)]);
    if (days <= 0 && posts <= 0) return false;
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { createdAt: true, approvedPostsCount: true } });
    if (!user) return false;
    if (days > 0 && user.createdAt.getTime() > now.getTime() - days * 86_400_000) return true;
    return posts > 0 && user.approvedPostsCount < posts;
  }

  async phishingLists(): Promise<GcsPhishingLists> {
    const [blocked, allowed] = await Promise.all([this.get<string>("antispam.phishing_domains", ""), this.get<string>("antispam.phishing_allow", "")]);
    return { blocked: parseDomainList(blocked), allowed: parseDomainList(allowed) };
  }

  /** Lista pentru paza linkurilor din browser (`null` = verificarea phishing e oprită). */
  async clientPhishingLists(): Promise<GcsPhishingLists | null> {
    if (!(await this.get<boolean>("antispam.phishing_enabled", true))) return null;
    return this.phishingLists();
  }

  /** E suspect domeniul unui link (pagina de avertizare `/link`)? */
  async isPhishingUrl(url: string): Promise<boolean> {
    if (!(await this.get<boolean>("antispam.phishing_enabled", true))) return false;
    return findPhishing(url, await this.phishingLists()) !== null;
  }

  private async siteHost(): Promise<string | null> {
    const url = await this.get<string>("site.url", "");
    try {
      return url ? normalizeHost(new URL(url).hostname) : null;
    } catch {
      return null;
    }
  }

  /**
   * Verifică un conținut nou (postare, mesaj privat, chat, semnătură, status): linkurile de phishing se refuză oricui;
   * membrii noi au linkurile moderate sau blocate, imaginile limitate și (opțional) postările în aprobare. Întoarce
   * `moderate: true` când postarea trebuie să treacă prin coada de aprobare.
   */
  async checkContent(actor: GcsActor, input: { kind: GcsContentKind; html?: string; text: string; trusted?: boolean }): Promise<{ moderate: boolean }> {
    const body = `${input.html ?? ""}\n${input.text}`;
    if (await this.get<boolean>("antispam.phishing_enabled", true)) {
      const domain = findPhishing(body, await this.phishingLists());
      if (domain) {
        await this.log("phishing_blocked", { userId: actor.userId, ip: actor.ip, detail: { kind: input.kind, domain } });
        throw new GcsForbidden({ reason: "phishing_link", domain });
      }
    }
    // `trusted`: moderatorul locului (ex. al forumului) nu are restricțiile membrilor noi.
    if (input.trusted || !(await this.isNewMember(actor.userId))) return { moderate: false };
    let moderate = input.kind === "post" && (await this.get<boolean>("antispam.new_member_approval", false));
    const own = await this.siteHost();
    const external = extractUrls(input.html ?? input.text).filter((u) => {
      try {
        return normalizeHost(new URL(u).hostname) !== own;
      } catch {
        return false;
      }
    });
    if (external.length > 0) {
      const rule = await this.get<string>("antispam.new_member_links", "moderate");
      if (rule === "block" || (rule === "moderate" && input.kind !== "post")) {
        await this.log("links_blocked", { userId: actor.userId, ip: actor.ip, detail: { kind: input.kind, links: external.length } });
        throw new GcsForbidden({ reason: "new_member_links" });
      }
      if (rule === "moderate") {
        moderate = true;
        await this.log("links_moderated", { userId: actor.userId, ip: actor.ip, detail: { kind: input.kind, links: external.length } });
      }
    }
    if (input.html && input.kind !== "chat") {
      const max = await this.get<number>("antispam.new_member_images", 2);
      if (countImages(input.html) > max) {
        await this.log("images_blocked", { userId: actor.userId, ip: actor.ip, detail: { kind: input.kind, max } });
        throw new GcsForbidden({ reason: "new_member_images", max: String(max) });
      }
    }
    return { moderate };
  }

  /** Membrii noi: mesajele private pe zi (`antispam.new_member_pms_per_day`, 0 = fără limită). */
  async checkPmQuota(actor: GcsActor): Promise<void> {
    if (!actor.userId || !(await this.isNewMember(actor.userId))) return;
    const max = await this.get<number>("antispam.new_member_pms_per_day", 5);
    if (max <= 0) return;
    const res = await this.deps.rateLimiter.consume(`antispam-pm:${actor.userId}`, { window: 86_400, max });
    if (!res.allowed) {
      await this.log("pm_limited", { userId: actor.userId, ip: actor.ip, detail: { max } });
      throw new GcsRateLimited({ retryAfter: String(res.retryAfter), reason: "new_member_pm_limit" });
    }
  }

  /** Membrii noi: pauza minimă dintre două mesaje în chat (`antispam.new_member_chat_slow`, 0 = fără). */
  async checkChatPace(actor: GcsActor): Promise<void> {
    if (!actor.userId || !(await this.isNewMember(actor.userId))) return;
    const seconds = await this.get<number>("antispam.new_member_chat_slow", 10);
    if (seconds <= 0) return;
    const res = await this.deps.rateLimiter.consume(`antispam-chat:${actor.userId}`, { window: seconds, max: 1 });
    if (!res.allowed) throw new GcsRateLimited({ retryAfter: String(res.retryAfter), reason: "slow_mode" });
  }

  // ─── „Marchează ca spammer” ───────────────────────────────────────────────────────────────────────────────

  /**
   * O singură acțiune pentru un cont de spam: ban pe cont, opțional ban pe IP-urile lui (înregistrare + sesiuni) și pe
   * domeniul emailului (nu pe furnizorii mari), conținutul ascuns în toate aplicațiile, raportarea în lista publică
   * (cu cheia adminului) și jurnalul.
   */
  async markSpammer(actor: GcsActor, userId: string, opts: GcsSpammerOptions): Promise<GcsSpammerResult> {
    const { db, bans, bus } = this.deps;
    await this.deps.acp.assert(actor, ANTISPAM_ACP_SECTION, "edit");
    if (userId === actor.userId) throw new GcsForbidden({ reason: "self" });
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, registrationIp: true, isSpammer: true } });
    if (!user) throw new GcsNotFound({ entity: "user" });
    // Protecția Root Admin și ierarhia staff-ului (ca la ban).
    await assertCanManageUser(db, actor, userId, { removesRoot: true });
    const reason = (opts.reason ?? "").trim().slice(0, 300) || "spam";
    if (!user.isSpammer) {
      await db.user.update({ where: { id: userId }, data: { isSpammer: true } });
      await bus.emit({ name: "user.spammer_changed", payload: { userId, flag: true }, tags: [`user:${userId}`] });
    }
    let banned = false;
    if (!(await bans.activeFor({ userId }))) {
      await bans.applyBan({ type: "ACCOUNT", value: userId, userId, reason, expiresAt: null }, actor);
      banned = true;
    }
    const ips: string[] = [];
    if (opts.banIp) {
      const sessions = await db.session.findMany({ where: { userId }, select: { ipAddress: true }, orderBy: { createdAt: "desc" }, take: 20 });
      const candidates = [user.registrationIp, ...sessions.map((s) => s.ipAddress)].filter((ip): ip is string => !!ip && !isLocalIp(ip) && ip !== actor.ip);
      for (const ip of [...new Set(candidates)].slice(0, 5)) {
        if (await bans.activeFor({ ip })) continue;
        await bans.applyBan({ type: "IP", value: ip, reason, expiresAt: new Date(Date.now() + 90 * 86_400_000) }, actor);
        ips.push(ip);
      }
    }
    let domain: string | null = null;
    const d = emailDomain(user.email);
    if (opts.banEmailDomain && d && !FREE_MAIL_DOMAINS.has(d) && !d.endsWith(".invalid") && !(await bans.activeFor({ email: `x@${d}` }))) {
      await bans.applyBan({ type: "EMAIL", value: `@${d}`, reason, expiresAt: null }, actor);
      domain = d;
    }
    const hidden: Record<string, number> = {};
    if (opts.hideContent) {
      for (const h of this.hiders) hidden[h.key] = await h.hide(userId, actor).catch(() => 0);
    }
    const reported = opts.report ? await this.reportSpammer(user.name, user.email, user.registrationIp) : false;
    await db.session.deleteMany({ where: { userId } });
    await this.log("spammer_marked", { userId, ip: user.registrationIp, email: user.email, detail: { by: actor.userId, ips, domain, hidden, reported } });
    await writeAudit(db, { actorId: actor.userId, action: "user.mark_spammer", targetType: "user", targetId: userId, after: { ips, domain, hidden, reported, reason }, ip: actor.ip });
    await bus.emit({ name: "user.marked_spammer", payload: { userId, by: actor.userId }, tags: [`user:${userId}`] });
    return { banned, ips, domain, hidden, reported };
  }

  private async reportSpammer(name: string, email: string, ip: string | null): Promise<boolean> {
    const key = await this.get<string>("antispam.sfs_api_key", "");
    if (!key || !ip) return false;
    const fetchFn = this.deps.fetch ?? fetch;
    try {
      const body = new URLSearchParams({ username: name, ip_addr: ip, email, api_key: key, evidence: "Marked as spammer by the community staff" });
      const res = await fetchFn(SFS_REPORT_ENDPOINT, { method: "POST", body, signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
