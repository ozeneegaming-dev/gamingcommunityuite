import {
  csvCell,
  GcsConflict,
  GcsForbidden,
  GcsNotFound,
  GcsValidationError,
  normalizeUsername,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsEventBus,
  type GcsRealtime,
  type GcsSettingsService,
} from "@gcs/core";
import type { DonationGoal, MemberDonation, Prisma, PrismaClient } from "@gcs/db";
import { dayKey } from "../chat-pro/period";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";
import { SPONSOR_MIN_SETTING } from "../profile/extras";
import { donationRange, goalPeriod, zonedDayStart, type GcsDonationRangeKind } from "./donationPeriod";

/**
 * Donațiile și „Obiectivul lunii” (VIP clasic): un singur model, `MemberDonation`.
 * - echipa le înregistrează din ACP › VIP & Magazin › Donații (sau din fișa membrului) și confirmă / respinge cererile
 *   „Am donat” trimise de membri (cu o referință de verificat);
 * - progresul obiectivelor, ultimele donații, topul și insigna „Sponsor” numără doar donațiile confirmate;
 * - un procesator de plăți se poate lega mai târziu prin `recordFromProvider` (idempotent după `source` + `externalId`).
 *   Aici nu se apelează niciun API de plăți și nu se păstrează date de card.
 */

export const DONATIONS_ACP_SECTION = "vip.donations";
export const DONATION_GOALS_ACP_SECTION = "vip.donation_goals";
export const DONATIONS_SETTINGS_SECTION = "donations";
export const DONATION_URL_SETTING = "donations.external_url";
export const DONATION_INSTRUCTIONS_SETTING = "donations.instructions";
export const DONATION_CURRENCY_SETTING = "donations.currency";
export const DONATION_METHODS_SETTING = "donations.methods";
export const DONATION_MEMBER_SUBMIT_SETTING = "donations.member_submit";
export const SPONSOR_PERIOD_SETTING = "donations.sponsor_period";
/** Semnalul „donațiile s-au schimbat”, trimis tuturor (camera `presence`), fără date: fiecare își cere progresul. */
export const DONATIONS_ROOM = "presence";
export const DONATIONS_EVENT = "donations:update";
/** Câte cereri „Am donat” poate avea un membru în așteptare în același timp. */
export const DONATION_PENDING_LIMIT = 3;
const PAGE_SIZE = 25;
const MAX_UNITS = 1_000_000;

export type GcsDonationStatus = "CONFIRMED" | "PENDING" | "REJECTED";
export const DONATION_STATUSES: readonly GcsDonationStatus[] = ["CONFIRMED", "PENDING", "REJECTED"];

/** O donație scrisă din ACP. `member`: numele sau id-ul membrului (gol = fără cont, cu `donorName` sau „Anonim”). */
export type GcsDonationInput = {
  member: string;
  donorName: string;
  /** În unități (ex. 25.50). */
  amount: number;
  /** Gol = moneda principală din setări. */
  currency: string;
  /** `YYYY-MM-DD` (gol = acum). */
  donatedAt: string;
  method: string;
  note: string;
  reference?: string;
  anonymous: boolean;
  status: GcsDonationStatus;
  /** Donatorul primește notificarea (și mesajul de mulțumire) când donația ajunge confirmată. */
  notify?: boolean;
};

/** Cererea „Am donat” a unui membru (rămâne în așteptare până o confirmă echipa). */
export type GcsDonationSubmitInput = { amount: number; currency: string; method: string; reference: string; note: string; anonymous: boolean; donatedAt?: string };

/** O plată adusă de un procesator (suma în subunități, ca la procesatoare). */
export type GcsProviderDonationInput = { source: string; externalId: string; userId?: string | null; donorName?: string; amount: number; currency: string; donatedAt?: Date; anonymous?: boolean; method?: string };

export type GcsDonationGoalInput = {
  title: string;
  /** În unități. */
  target: number;
  currency: string;
  period: "MONTHLY" | "CUSTOM";
  startsOn: string;
  endsOn: string;
  autoRenew: boolean;
  groupIds: number[];
  enabled: boolean;
};

export type GcsDonationFilter = { status?: string; q?: string; method?: string; from?: string; to?: string; page?: number };

/** Cine apare la o donație publică: membrul (nume stilizat), numele dat de un donator fără cont sau „Anonim”. */
export type GcsDonorView = { kind: "member"; user: GcsUserRef } | { kind: "name"; name: string } | { kind: "anonymous" };
export type GcsPublicDonation = { id: number; donor: GcsDonorView; amount: number; currency: string; at: string };
export type GcsTopDonor = { rank: number; donor: GcsDonorView; total: number; count: number; currency: string; since: string };
export type GcsDonationRow = MemberDonation & { user: GcsUserRef | null };
export type GcsGoalView = {
  id: number;
  title: string;
  target: number;
  raised: number;
  currency: string;
  /** Procentul atins (0–100; peste țintă rămâne 100, `raised` arată suma reală). */
  percent: number;
  donors: number;
  last: GcsPublicDonation | null;
  period: { kind: "MONTHLY" | "CUSTOM"; autoRenew: boolean; startDay: string; endDay: string; state: "upcoming" | "active" | "ended" };
};

/** Cârligul mesajului de mulțumire (botul comunității); fără bot, lipsește. */
export type GcsDonationThankYou = (donation: { id: number; userId: string; amount: number; currency: string }) => Promise<void>;

type Deps = {
  db: PrismaClient;
  bus: GcsEventBus;
  settings: GcsSettingsService;
  acp: Pick<GcsAcpRoleService, "assert" | "can">;
  realtime: Pick<GcsRealtime, "publish"> | null;
  /**
   * TODO(bot-stiri): mesajul privat de mulțumire trimis de contul botului comunității. Botul nu există încă, deci
   * serviciile nu dau cârligul; când apare, îl leagă aici (o setare „Mesaj de mulțumire” în Donații › Setări).
   */
  thankYou?: GcsDonationThankYou | null;
  clock?: () => Date;
};

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const userInclude = { user: { select: userRefSelect } } as const;
type WithUser = MemberDonation & { user: Parameters<typeof toRef>[0] | null };

/** Suma în subunități, scrisă scurt (ex. „50 RON”, „25.50 EUR”): titlul notificărilor și al jurnalului. */
export function donationAmountLabel(amount: number, currency: string): string {
  return `${amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2)} ${currency}`;
}

/** Donatorul public al unei donații: „Anonim” ascunde membrul (nici id-ul nu pleacă spre pagină). */
function donorOf(d: WithUser): GcsDonorView {
  if (d.anonymous) return { kind: "anonymous" };
  if (d.user) return { kind: "member", user: toRef(d.user) };
  return d.donorName ? { kind: "name", name: d.donorName } : { kind: "anonymous" };
}

const publicDonation = (d: WithUser): GcsPublicDonation => ({ id: d.id, donor: donorOf(d), amount: d.amount, currency: d.currency, at: d.donatedAt.toISOString() });

export class GcsDonationService {
  constructor(private readonly deps: Deps) {}

  private now(): Date {
    return this.deps.clock?.() ?? new Date();
  }

  private timeZone(): Promise<string> {
    return this.deps.settings.get<string>("site.timezone");
  }

  /** Moneda principală (formularele, topul și pragul insignei „Sponsor”). */
  async mainCurrency(): Promise<string> {
    const c = (await this.deps.settings.get<string>(DONATION_CURRENCY_SETTING)).trim().toUpperCase();
    return /^[A-Z]{3}$/.test(c) ? c : "EUR";
  }

  /** Metodele propuse în formulare (setarea, despărțită prin virgule). */
  async methods(): Promise<string[]> {
    const raw = await this.deps.settings.get<string>(DONATION_METHODS_SETTING);
    return [...new Set(raw.split(",").map((m) => clean(m, 40)).filter(Boolean))].slice(0, 20);
  }

  private async changed(): Promise<void> {
    await this.deps.realtime?.publish(DONATIONS_ROOM, DONATIONS_EVENT, {});
  }

  /** Data donației: o zi `YYYY-MM-DD` (amiaza ei, în fusul site-ului) sau acum; nu în viitor. */
  private async donationDate(raw: string | undefined, errors: Record<string, string>): Promise<Date> {
    const now = this.now();
    const day = (raw ?? "").trim();
    if (!day) return now;
    const tz = await this.timeZone();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || day > dayKey(now, tz)) {
      errors.donatedAt = "invalid_date";
      return now;
    }
    if (day === dayKey(now, tz)) return now;
    return new Date(zonedDayStart(day, tz).getTime() + 12 * 3_600_000);
  }

  private async amountAndCurrency(amount: number, currency: string, errors: Record<string, string>): Promise<{ cents: number; currency: string }> {
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_UNITS * 100) errors.amount = "invalid_range";
    const c = currency.trim() ? currency.trim().toUpperCase() : await this.mainCurrency();
    if (!/^[A-Z]{3}$/.test(c)) errors.currency = "invalid";
    return { cents, currency: c };
  }

  /** Membrul după id sau nume (fără diacritice / majuscule); gol = fără cont. */
  private async resolveMember(raw: string, errors: Record<string, string>): Promise<string | null> {
    const ref = raw.trim();
    if (!ref) return null;
    const { db } = this.deps;
    const user = (await db.user.findUnique({ where: { id: ref }, select: { id: true } })) ?? (await db.user.findUnique({ where: { nameNormalized: normalizeUsername(ref) }, select: { id: true } }));
    if (!user) errors.member = "member_not_found";
    return user?.id ?? null;
  }

  private async data(input: GcsDonationInput): Promise<Omit<Prisma.MemberDonationUncheckedCreateInput, "createdById" | "source">> {
    const errors: Record<string, string> = {};
    const [userId, money, donatedAt] = await Promise.all([this.resolveMember(input.member, errors), this.amountAndCurrency(input.amount, input.currency, errors), this.donationDate(input.donatedAt, errors)]);
    if (!DONATION_STATUSES.includes(input.status)) errors.status = "invalid_choice";
    const donorName = userId ? "" : clean(input.donorName, 60);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return {
      userId,
      donorName,
      amount: money.cents,
      currency: money.currency,
      donatedAt,
      method: clean(input.method, 40),
      note: clean(input.note, 200),
      reference: clean(input.reference ?? "", 120),
      anonymous: input.anonymous,
      status: input.status,
    };
  }

  // ─── ACP ───────────────────────────────────────────────────────────────────────────────────────

  async record(actor: GcsActor, input: GcsDonationInput): Promise<MemberDonation> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "edit");
    const { db } = this.deps;
    const data = await this.data(input);
    const reviewed = data.status === "PENDING" ? {} : { reviewedById: actor.userId, reviewedAt: this.now() };
    const row = await db.memberDonation.create({ data: { ...data, ...reviewed, source: "manual", createdById: actor.userId } });
    await writeAudit(db, { actorId: actor.userId, action: "donation.add", targetType: "donation", targetId: String(row.id), after: row, ip: actor.ip });
    if (row.status === "CONFIRMED") await this.confirmed(row, input.notify === true);
    await this.changed();
    return row;
  }

  async update(actor: GcsActor, id: number, input: GcsDonationInput): Promise<MemberDonation> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "edit");
    const { db } = this.deps;
    const before = await db.memberDonation.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    const data = await this.data(input);
    const reviewed = data.status !== before.status && data.status !== "PENDING" ? { reviewedById: actor.userId, reviewedAt: this.now() } : {};
    const row = await db.memberDonation.update({ where: { id }, data: { ...data, ...reviewed } });
    await writeAudit(db, { actorId: actor.userId, action: "donation.edit", targetType: "donation", targetId: String(id), before, after: row, ip: actor.ip });
    if (row.status === "CONFIRMED" && before.status !== "CONFIRMED") await this.confirmed(row, input.notify === true);
    await this.changed();
    return row;
  }

  async remove(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "delete");
    const { db } = this.deps;
    const before = await db.memberDonation.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.memberDonation.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "donation.delete", targetType: "donation", targetId: String(id), before, ip: actor.ip });
    await this.changed();
  }

  /** Confirmă o cerere în așteptare (sau una respinsă din greșeală); o donație deja confirmată → conflict. */
  async confirm(actor: GcsActor, id: number, opts: { notify?: boolean } = {}): Promise<MemberDonation> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "edit");
    const { db } = this.deps;
    const { count } = await db.memberDonation.updateMany({ where: { id, status: { not: "CONFIRMED" } }, data: { status: "CONFIRMED", reviewedById: actor.userId, reviewedAt: this.now(), rejectReason: "" } });
    if (count === 0) {
      if (!(await db.memberDonation.findUnique({ where: { id }, select: { id: true } }))) throw new GcsNotFound();
      throw new GcsConflict({ reason: "donation_reviewed" });
    }
    const row = await db.memberDonation.findUniqueOrThrow({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "donation.confirm", targetType: "donation", targetId: String(id), after: { status: row.status }, ip: actor.ip });
    await this.confirmed(row, opts.notify ?? true);
    await this.changed();
    return row;
  }

  /** Respinge o cerere în așteptare, cu motivul (îl vede membrul în notificare). */
  async reject(actor: GcsActor, id: number, reason: string): Promise<MemberDonation> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "edit");
    const { db, bus } = this.deps;
    const why = clean(reason, 200);
    const { count } = await db.memberDonation.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", reviewedById: actor.userId, reviewedAt: this.now(), rejectReason: why } });
    if (count === 0) {
      if (!(await db.memberDonation.findUnique({ where: { id }, select: { id: true } }))) throw new GcsNotFound();
      throw new GcsConflict({ reason: "donation_reviewed" });
    }
    const row = await db.memberDonation.findUniqueOrThrow({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "donation.reject", targetType: "donation", targetId: String(id), after: { status: row.status, reason: why }, ip: actor.ip });
    if (row.userId) await bus.emit({ name: "donation.rejected", payload: { donationId: id, userId: row.userId, actorId: actor.userId, reason: why }, tags: [] });
    await this.changed();
    return row;
  }

  /** O donație a ajuns confirmată: evenimentul (realizările, notificarea donatorului) și mesajul de mulțumire. */
  private async confirmed(row: MemberDonation, notify: boolean): Promise<void> {
    await this.deps.bus.emit({ name: "donation.confirmed", payload: { donationId: row.id, userId: row.userId, amount: row.amount, currency: row.currency, notify }, tags: [] });
    if (notify && row.userId) await this.deps.thankYou?.({ id: row.id, userId: row.userId, amount: row.amount, currency: row.currency });
  }

  private where(f: GcsDonationFilter): Prisma.MemberDonationWhereInput {
    const where: Prisma.MemberDonationWhereInput = {};
    if (f.status && DONATION_STATUSES.includes(f.status as GcsDonationStatus)) where.status = f.status as GcsDonationStatus;
    const q = f.q?.trim();
    if (q) where.OR = [{ donorName: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }];
    if (f.method?.trim()) where.method = { equals: f.method.trim(), mode: "insensitive" };
    const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = day(f.from);
    const to = day(f.to);
    if (from || to) where.donatedAt = { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000) } : {}) };
    return where;
  }

  /** Lista din ACP (cele mai noi primele), cu filtrele paginii și paginarea. */
  async adminList(f: GcsDonationFilter): Promise<{ rows: GcsDonationRow[]; total: number; pages: number; page: number }> {
    const { db } = this.deps;
    const where = this.where(f);
    const page = Math.max(1, Math.trunc(f.page ?? 1));
    const [rows, total] = await Promise.all([
      db.memberDonation.findMany({ where, orderBy: [{ donatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: userInclude }),
      db.memberDonation.count({ where }),
    ]);
    return { rows: rows.map((r) => ({ ...r, user: r.user ? toRef(r.user) : null })), total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), page };
  }

  async donation(id: number): Promise<GcsDonationRow | null> {
    const row = await this.deps.db.memberDonation.findUnique({ where: { id }, include: userInclude });
    return row ? { ...row, user: row.user ? toRef(row.user) : null } : null;
  }

  /** Exportul CSV al listei filtrate (toate rândurile, nu doar pagina); intră în jurnal. */
  async exportCsv(actor: GcsActor, f: GcsDonationFilter): Promise<string> {
    await this.deps.acp.assert(actor, DONATIONS_ACP_SECTION, "view");
    const { db } = this.deps;
    const [rows, tz] = await Promise.all([db.memberDonation.findMany({ where: this.where(f), orderBy: [{ donatedAt: "desc" }, { id: "desc" }], take: 50_000, include: { user: { select: { name: true } } } }), this.timeZone()]);
    const header = ["id", "date", "member", "donor_name", "amount", "currency", "method", "status", "anonymous", "reference", "note"];
    const lines = rows.map((r) =>
      [r.id, dayKey(r.donatedAt, tz), r.user?.name ?? "", r.donorName, (r.amount / 100).toFixed(2), r.currency, r.method, r.status, r.anonymous ? "yes" : "no", r.reference, r.note].map(csvCell).join(","),
    );
    await writeAudit(db, { actorId: actor.userId, action: "donation.export", targetType: "donation", targetId: "csv", after: { rows: rows.length, filter: f }, ip: actor.ip });
    return [header.join(","), ...lines].join("\n") + "\n";
  }

  /** Sumarul din antetul paginii ACP: cererile în așteptare și totalul confirmat luna aceasta (moneda principală). */
  async summary(): Promise<{ pending: number; month: number; currency: string }> {
    const { db } = this.deps;
    const [currency, tz] = await Promise.all([this.mainCurrency(), this.timeZone()]);
    const range = donationRange("month", this.now(), tz);
    const [pending, month] = await Promise.all([
      db.memberDonation.count({ where: { status: "PENDING" } }),
      db.memberDonation.aggregate({ where: { status: "CONFIRMED", currency, donatedAt: { gte: range.start!, lt: range.end! } }, _sum: { amount: true } }),
    ]);
    return { pending, month: month._sum.amount ?? 0, currency };
  }

  // ─── Membrii („Am donat”) ───────────────────────────────────────────────────────────────────────

  /** Cererea „Am donat”: în așteptare, cu referința plății; echipa e anunțată. */
  async submit(actor: GcsActor, input: GcsDonationSubmitInput): Promise<MemberDonation> {
    const { db, bus, settings } = this.deps;
    if (!actor.userId || actor.isBanned) throw new GcsForbidden();
    if (!(await settings.get<boolean>(DONATION_MEMBER_SUBMIT_SETTING))) throw new GcsForbidden({ reason: "donations_closed" });
    const errors: Record<string, string> = {};
    const [money, donatedAt] = await Promise.all([this.amountAndCurrency(input.amount, input.currency, errors), this.donationDate(input.donatedAt, errors)]);
    const reference = clean(input.reference, 120);
    if (reference.length === 0) errors.reference = "required";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    if ((await db.memberDonation.count({ where: { userId: actor.userId, status: "PENDING" } })) >= DONATION_PENDING_LIMIT) throw new GcsConflict({ reason: "donation_pending_limit" });
    const row = await db.memberDonation.create({
      data: {
        userId: actor.userId,
        amount: money.cents,
        currency: money.currency,
        donatedAt,
        method: clean(input.method, 40),
        reference,
        note: clean(input.note, 200),
        anonymous: input.anonymous,
        status: "PENDING",
        source: "member",
        createdById: actor.userId,
      },
    });
    await writeAudit(db, { actorId: actor.userId, action: "donation.submit", targetType: "donation", targetId: String(row.id), after: row, ip: actor.ip });
    await bus.emit({ name: "donation.submitted", payload: { donationId: row.id, userId: actor.userId }, tags: [] });
    return row;
  }

  /** Donațiile unui membru (cererile lui, cu starea), cele mai noi primele. */
  mine(userId: string): Promise<MemberDonation[]> {
    return this.deps.db.memberDonation.findMany({ where: { userId }, orderBy: [{ donatedAt: "desc" }, { id: "desc" }], take: 50 });
  }

  /**
   * O plată confirmată adusă de un procesator de plăți (cârligul pentru magazinul / procesatorul de mai târziu, de ex.
   * din webhook-ul lui, după verificarea semnăturii). Aceeași plată (`source` + `externalId`) rămâne o singură donație.
   */
  async recordFromProvider(input: GcsProviderDonationInput): Promise<MemberDonation> {
    const { db } = this.deps;
    const source = clean(input.source, 40).toLowerCase();
    const externalId = clean(input.externalId, 120);
    const currency = input.currency.trim().toUpperCase();
    if (!/^[a-z0-9_-]{2,40}$/.test(source) || source === "manual" || source === "member" || !externalId) throw new GcsValidationError({ source: "invalid" });
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_UNITS * 100) throw new GcsValidationError({ amount: "invalid_range" });
    if (!/^[A-Z]{3}$/.test(currency)) throw new GcsValidationError({ currency: "invalid" });
    const existing = await db.memberDonation.findUnique({ where: { source_externalId: { source, externalId } } });
    if (existing) return existing;
    const row = await db.memberDonation.create({
      data: {
        userId: input.userId ?? null,
        donorName: input.userId ? "" : clean(input.donorName ?? "", 60),
        amount: input.amount,
        currency,
        donatedAt: input.donatedAt ?? this.now(),
        method: clean(input.method ?? source, 40),
        anonymous: input.anonymous ?? false,
        status: "CONFIRMED",
        source,
        externalId,
      },
    });
    await writeAudit(db, { actorId: null, action: "donation.provider", targetType: "donation", targetId: String(row.id), after: row, ip: null });
    await this.confirmed(row, true);
    await this.changed();
    return row;
  }

  // ─── Public ─────────────────────────────────────────────────────────────────────────────────────

  /** Ultimele donații confirmate (toate monedele); cele anonime apar „Anonim”. */
  async latest(limit: number): Promise<GcsPublicDonation[]> {
    const rows = await this.deps.db.memberDonation.findMany({ where: { status: "CONFIRMED" }, orderBy: [{ donatedAt: "desc" }, { id: "desc" }], take: limit, include: userInclude });
    return rows.map(publicDonation);
  }

  /**
   * Topul donatorilor pe lună / an / tot (după ceasul site-ului): donațiile confirmate și publice, în moneda principală;
   * membrii după cont, donatorii fără cont după nume. La egalitate, cine a donat primul.
   */
  async top(range: GcsDonationRangeKind, limit: number): Promise<GcsTopDonor[]> {
    const { db } = this.deps;
    const [currency, tz] = await Promise.all([this.mainCurrency(), this.timeZone()]);
    const r = donationRange(range, this.now(), tz);
    const rows = await db.memberDonation.findMany({
      where: { status: "CONFIRMED", anonymous: false, currency, ...(r.start && r.end ? { donatedAt: { gte: r.start, lt: r.end } } : {}), OR: [{ userId: { not: null } }, { donorName: { not: "" } }] },
      orderBy: [{ donatedAt: "asc" }, { id: "asc" }],
      include: userInclude,
    });
    const groups = new Map<string, { donor: GcsDonorView; total: number; count: number; since: Date }>();
    for (const d of rows) {
      const key = d.userId ? `u:${d.userId}` : `n:${normalizeUsername(d.donorName)}`;
      const g = groups.get(key);
      if (g) {
        g.total += d.amount;
        g.count += 1;
      } else groups.set(key, { donor: donorOf(d), total: d.amount, count: 1, since: d.donatedAt });
    }
    return [...groups.values()]
      .sort((a, b) => b.total - a.total || a.since.getTime() - b.since.getTime())
      .slice(0, limit)
      .map((g, i) => ({ rank: i + 1, donor: g.donor, total: g.total, count: g.count, currency, since: g.since.toISOString() }));
  }

  /** Insigna „Sponsor”: donațiile confirmate și publice ale membrului, din perioada setată, în moneda principală, peste prag. */
  async sponsor(userId: string): Promise<{ total: number; sponsor: boolean }> {
    const { db, settings } = this.deps;
    const [min, period, currency, tz] = await Promise.all([settings.get<number>(SPONSOR_MIN_SETTING), settings.get<string>(SPONSOR_PERIOD_SETTING), this.mainCurrency(), this.timeZone()]);
    const r = donationRange(period === "month" || period === "year" ? period : "all", this.now(), tz);
    const sum = await db.memberDonation.aggregate({
      where: { userId, status: "CONFIRMED", anonymous: false, currency, ...(r.start && r.end ? { donatedAt: { gte: r.start, lt: r.end } } : {}) },
      _sum: { amount: true },
    });
    const total = sum._sum.amount ?? 0;
    return { total, sponsor: min > 0 && total >= Math.round(min * 100) };
  }

  // ─── Obiectivele ────────────────────────────────────────────────────────────────────────────────

  goals(): Promise<DonationGoal[]> {
    return this.deps.db.donationGoal.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
  }

  goal(id: number): Promise<DonationGoal | null> {
    return this.deps.db.donationGoal.findUnique({ where: { id } });
  }

  async saveGoal(actor: GcsActor, id: number | null, input: GcsDonationGoalInput): Promise<DonationGoal> {
    await this.deps.acp.assert(actor, DONATION_GOALS_ACP_SECTION, "edit");
    const { db } = this.deps;
    const errors: Record<string, string> = {};
    const title = clean(input.title, 80);
    if (!title) errors.title = "required";
    const target = Math.round(input.target * 100);
    if (!Number.isFinite(target) || target <= 0 || target > MAX_UNITS * 100) errors.target = "invalid_range";
    const currency = input.currency.trim() ? input.currency.trim().toUpperCase() : await this.mainCurrency();
    if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "invalid";
    const period = input.period === "CUSTOM" ? "CUSTOM" : "MONTHLY";
    const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    const startsOn = input.startsOn.trim() || dayKey(this.now(), await this.timeZone());
    if (!isDay(startsOn)) errors.startsOn = "invalid_date";
    const endsOn = input.endsOn.trim();
    if (period === "CUSTOM" && (!isDay(endsOn) || endsOn < startsOn)) errors.endsOn = "invalid_date";
    const groupIds = [...new Set(input.groupIds.filter((g) => Number.isInteger(g) && g > 0))];
    if (groupIds.length > 0 && (await db.group.count({ where: { id: { in: groupIds } } })) !== groupIds.length) errors.groupIds = "invalid_choice";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const data = {
      title,
      target,
      currency,
      period,
      startsOn: new Date(`${startsOn}T00:00:00Z`),
      endsOn: period === "CUSTOM" ? new Date(`${endsOn}T00:00:00Z`) : null,
      autoRenew: period === "MONTHLY" && input.autoRenew,
      groupIds,
      enabled: input.enabled,
    };
    let row: DonationGoal;
    if (id === null) {
      const last = await db.donationGoal.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
      row = await db.donationGoal.create({ data: { ...data, position: (last?.position ?? 0) + 1 } });
    } else {
      if (!(await db.donationGoal.findUnique({ where: { id }, select: { id: true } }))) throw new GcsNotFound();
      row = await db.donationGoal.update({ where: { id }, data });
    }
    await writeAudit(db, { actorId: actor.userId, action: id === null ? "donation.goal.add" : "donation.goal.edit", targetType: "donation_goal", targetId: String(row.id), after: row, ip: actor.ip });
    await this.changed();
    return row;
  }

  async deleteGoal(actor: GcsActor, id: number): Promise<void> {
    await this.deps.acp.assert(actor, DONATION_GOALS_ACP_SECTION, "delete");
    const { db } = this.deps;
    const before = await db.donationGoal.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.donationGoal.delete({ where: { id } });
    await writeAudit(db, { actorId: actor.userId, action: "donation.goal.delete", targetType: "donation_goal", targetId: String(id), before, ip: actor.ip });
    await this.changed();
  }

  /**
   * Progresul unui obiectiv pentru viewer (`null` = obiectivul lipsește, e oprit sau nu e pentru grupurile lui). Fără
   * id: primul obiectiv pornit, vizibil și activ acum (în ordinea din ACP).
   */
  async goalView(viewer: GcsActor, goalId: number | null): Promise<GcsGoalView | null> {
    const { db } = this.deps;
    const tz = await this.timeZone();
    const now = this.now();
    const visible = (g: DonationGoal) => g.enabled && (g.groupIds.length === 0 || g.groupIds.some((id) => viewer.groupIds.includes(id)));
    let goal: DonationGoal | null;
    if (goalId !== null) {
      goal = await db.donationGoal.findUnique({ where: { id: goalId } });
      if (goal && !visible(goal)) goal = null;
    } else {
      goal = (await this.goals()).find((g) => visible(g) && goalPeriod(g, now, tz).state === "active") ?? null;
    }
    if (!goal) return null;
    const p = goalPeriod(goal, now, tz);
    const where: Prisma.MemberDonationWhereInput = { status: "CONFIRMED", currency: goal.currency, donatedAt: { gte: p.start, lt: p.end } };
    const [sum, donors, last] = await Promise.all([
      db.memberDonation.aggregate({ where, _sum: { amount: true } }),
      db.memberDonation.findMany({ where, select: { id: true, userId: true, donorName: true } }),
      db.memberDonation.findFirst({ where, orderBy: [{ donatedAt: "desc" }, { id: "desc" }], include: userInclude }),
    ]);
    const raised = sum._sum.amount ?? 0;
    const keys = new Set(donors.map((d) => (d.userId ? `u:${d.userId}` : d.donorName ? `n:${normalizeUsername(d.donorName)}` : `d:${d.id}`)));
    const endDay = new Date(Date.parse(`${p.nextDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return {
      id: goal.id,
      title: goal.title,
      target: goal.target,
      raised,
      currency: goal.currency,
      percent: goal.target > 0 ? Math.min(100, Math.floor((raised / goal.target) * 100)) : 0,
      donors: keys.size,
      last: last ? publicDonation(last) : null,
      period: { kind: goal.period, autoRenew: goal.autoRenew, startDay: p.startDay, endDay, state: p.state },
    };
  }
}
