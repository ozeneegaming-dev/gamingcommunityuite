import { Prisma, type MemberRemoval, type MemberRemovalStatus, type PrismaClient } from "@gcs/db";
import type { GcsAcpRoleService } from "../../acp/roles";
import { writeAudit } from "../../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../../errors";
import type { GcsEventBus } from "../../events";
import { assertCanManageUser, rootUsersWhere } from "../../groups/rootGuard";
import type { GcsJobQueue } from "../../jobs/queue";
import type { GcsActor } from "../../permissions/types";
import type { GcsSettingsService } from "../../settings/service";
import type { GcsMemberDataHandler, GcsMemberDataItem, GcsMemberDataNote, GcsRemovalMode, GcsRemovalStepState } from "./types";

/** Jobul care rulează o operație (`{ id }`) și cel periodic care pornește cererile ajunse la termen. */
export const MEMBER_REMOVAL_RUN_JOB = "members.removal.run";
export const MEMBER_REMOVAL_SWEEP_JOB = "members.removal.sweep";
/** Ștergerea și unirea cer dreptul `delete` pe fișa membrilor (specul §3). */
export const MEMBER_REMOVAL_ACP_SECTION = "members.members";
/** ACP → Membri → Cereri GDPR: lista (`view`), rularea / anularea cererilor și setarea (`edit`). */
export const GDPR_ACP_SECTION = "members.gdpr";
/** Perioada de răzgândire a cererii membrului, în zile (0–90). */
export const DELETION_COOLING_SETTING = "members.deletion_cooling_days";
/** Domeniul adreselor puse în locul emailului unui cont blocat (`.invalid` nu primește niciodată email). */
export const DELETED_EMAIL_DOMAIN = "@deleted.invalid";

const ACTIVE: MemberRemovalStatus[] = ["SCHEDULED", "QUEUED", "RUNNING", "FAILED"];
/** O rulare fără heartbeat de atâta timp e considerată căzută (o poate prelua alt job). */
const STALE_RUNNING_MS = 10 * 60_000;
/** O operație rămasă în coadă de atâta timp e repusă în coadă (ex. jobul s-a pierdut). */
const STALE_QUEUED_MS = 2 * 60_000;
/** După atâtea încercări eșuate, operația rămâne `FAILED` (staff-ul o reia din ACP). */
const MAX_ATTEMPTS = 3;
const SWEEP_EVERY_MS = 5 * 60_000;
const PAGE_SIZE = 30;

export type GcsRemovalItem = GcsMemberDataItem & { step: string };
export type GcsRemovalNote = GcsMemberDataNote & { step: string };
type GcsRemovalUser = { id: string; name: string; groupKey: string; groupName: string; email: string; isRoot: boolean };
export type GcsRemovalPreview = { user: GcsRemovalUser; items: GcsRemovalItem[]; notes: GcsRemovalNote[]; total: number };
/** Ce se întâmplă cu un furnizor de login la unire. */
export type GcsLoginMove = { providerId: string; action: "move" | "drop" };
export type GcsMergePreview = { source: GcsRemovalUser; target: GcsRemovalUser; items: GcsRemovalItem[]; notes: GcsRemovalNote[]; logins: GcsLoginMove[]; total: number };

export type GcsRemovalView = MemberRemoval & { stepsState: Record<string, GcsRemovalStepState & { cursor?: string | null }>; stepKeys: string[] };

type Tx = Prisma.TransactionClient;

/** Starea pașilor salvată în `steps` (cu cursorul opțional al handler-ului). */
type StepsState = Record<string, GcsRemovalStepState & { cursor?: string | null }>;

/**
 * Ștergerea și unirea conturilor (specul 2026-10-09-stergere-unire-membri). Serviciul doar orchestrează: regulile de
 * siguranță, blocarea contului, coada, progresul pe pași, jurnalul și evenimentele; datele fiecărei aplicații le tratează
 * handler-ele ei (`register`), în ordinea înregistrării.
 */
export class GcsMemberRemovalService {
  private readonly steps: GcsMemberDataHandler[] = [];

  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      acp: GcsAcpRoleService;
      settings: Pick<GcsSettingsService, "get">;
      /** `null` în teste: operațiile mari rămân în coadă până la `run`. */
      jobs: GcsJobQueue | null;
      now?: () => Date;
      /** Rândurile „grele” pe lot (implicit 100). */
      batchSize?: number;
      /** Până la câte rânduri numărate se rulează imediat, în cererea staff-ului (implicit 500). */
      inlineLimit?: number;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Înregistrează handler-ul unei aplicații; ordinea înregistrării e ordinea pașilor. */
  register(handler: GcsMemberDataHandler): void {
    if (this.steps.some((h) => h.key === handler.key)) throw new Error(`Pasul „${handler.key}” e deja înregistrat`);
    this.steps.push(handler);
  }

  stepKeys(): string[] {
    return this.steps.map((h) => h.key);
  }

  // ─── Regulile de siguranță ─────────────────────────────────────────────────────────────────────────────────

  private async loadUser(userId: string): Promise<GcsRemovalUser> {
    const { db } = this.deps;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, primaryGroup: { select: { key: true, name: true } }, groups: { select: { group: { select: { key: true } } } } },
    });
    if (!user) throw new GcsNotFound({ entity: "user" });
    const isRoot = user.primaryGroup.key === "root_admin" || user.groups.some((g) => g.group.key === "root_admin");
    return { id: user.id, name: user.name, email: user.email, groupKey: user.primaryGroup.key, groupName: user.primaryGroup.name, isRoot };
  }

  /** O operație activă pe cont (ca sursă sau ca țintă a unei uniri). */
  async activeFor(userId: string): Promise<MemberRemoval | null> {
    return this.deps.db.memberRemoval.findFirst({
      where: { status: { in: ACTIVE }, OR: [{ userId }, { targetId: userId }] },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Nicio altă operație activă pe cont. `supersede`: cererea membrului încă în perioada de răzgândire nu blochează (o
   * operație pornită de staff o înlocuiește, vezi `supersedeScheduled`).
   */
  private async assertFree(userId: string, opts: { supersede?: boolean } = {}): Promise<void> {
    const active = await this.activeFor(userId);
    if (!active) return;
    if (opts.supersede && active.status === "SCHEDULED" && active.userId === userId) return;
    throw new GcsConflict({ reason: "removal_in_progress" });
  }

  /** Cererea membrului în așteptare e înlocuită de operația pornită de staff (se anulează, în aceeași tranzacție). */
  private async supersedeScheduled(tx: Tx, userId: string): Promise<void> {
    await tx.memberRemoval.updateMany({ where: { userId, status: "SCHEDULED" }, data: { status: "CANCELLED", finishedAt: this.now(), error: "superseded" } });
  }

  /**
   * `remove`: contul dispare (ștergere sau sursa unirii) → nu pe tine, protecția Root Admin, nu ultimul Root Admin.
   * `keep`: ținta unirii → doar protecția Root Admin.
   */
  private async assertManageable(actor: GcsActor, userId: string, role: "remove" | "keep"): Promise<void> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    if (role === "remove" && actor.userId === userId) throw new GcsConflict({ reason: "removal_self" });
    await assertCanManageUser(this.deps.db, actor, userId, { removesRoot: role === "remove" });
  }

  private async assertRight(actor: GcsActor): Promise<void> {
    await this.deps.acp.assert(actor, MEMBER_REMOVAL_ACP_SECTION, "delete");
  }

  // ─── Previzualizarea ───────────────────────────────────────────────────────────────────────────────────────

  private async collect(userId: string): Promise<{ items: GcsRemovalItem[]; total: number }> {
    const items: GcsRemovalItem[] = [];
    for (const h of this.steps) {
      for (const item of await h.summary(userId)) if (item.count > 0) items.push({ ...item, step: h.key });
    }
    return { items, total: items.reduce((s, i) => s + i.count, 0) };
  }

  /** Ce are membrul în fiecare aplicație (cardul „Conținut pe aplicații” din fișa ACP); doar citire, fără drept propriu. */
  async contentSummary(userId: string): Promise<GcsRemovalItem[]> {
    return (await this.collect(userId)).items;
  }

  /**
   * Exportul GDPR al datelor personale (Membri v2; dreptul de acces din GDPR): un fișier JSON pe aplicație (`export` al
   * handler-ului, altfel numerele din `summary`), plus `summary.json`. Cere dreptul pe Cereri GDPR și protecția Root;
   * intră în jurnal.
   */
  async exportData(actor: GcsActor, userId: string): Promise<{ user: GcsRemovalUser; files: { name: string; data: unknown }[] }> {
    await this.deps.acp.assert(actor, GDPR_ACP_SECTION, "view");
    await assertCanManageUser(this.deps.db, actor, userId);
    const user = await this.loadUser(userId);
    const files: { name: string; data: unknown }[] = [];
    const summary: Record<string, Record<string, number>> = {};
    for (const h of this.steps) {
      const items = await h.summary(userId);
      summary[h.key] = Object.fromEntries(items.map((i) => [i.key, i.count]));
      if (h.export) files.push({ name: `${h.key}.json`, data: await h.export(userId) });
    }
    files.push({ name: "summary.json", data: { exportedAt: this.now().toISOString(), user: { id: user.id, name: user.name, email: user.email }, apps: summary } });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "member.gdpr_export", targetType: "user", targetId: userId, ip: actor.ip });
    return { user, files };
  }

  /** Ce are membrul și ce se va întâmpla (ecranul de confirmare al ștergerii). */
  async preview(actor: GcsActor, userId: string): Promise<GcsRemovalPreview> {
    await this.assertRight(actor);
    const user = await this.loadUser(userId);
    const { items, total } = await this.collect(userId);
    const notes: GcsRemovalNote[] = [];
    for (const h of this.steps) for (const n of (await h.deleteNotes?.(userId)) ?? []) notes.push({ ...n, step: h.key });
    return { user, items, notes, total };
  }

  /** Ce se mută la unire, pe aplicații, cu conflictele (previzualizarea „ce se mută”). */
  async mergePreview(actor: GcsActor, sourceId: string, targetId: string): Promise<GcsMergePreview> {
    await this.assertRight(actor);
    if (sourceId === targetId) throw new GcsValidationError({ target: "same_account" });
    const [source, target] = await Promise.all([this.loadUser(sourceId), this.loadUser(targetId)]);
    const { items, total } = await this.collect(sourceId);
    const notes: GcsRemovalNote[] = [];
    for (const h of this.steps) for (const n of (await h.mergeNotes?.(sourceId, targetId)) ?? []) notes.push({ ...n, step: h.key });
    return { source, target, items, notes, logins: await this.loginMoves(this.deps.db, sourceId, targetId), total };
  }

  // ─── Cererile ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Blochează contul pe loc: sesiunile, conturile de login și 2FA se șterg, iar emailul devine o adresă `.invalid`
   * (eliberează adresa și oprește legarea automată a unui login social pe același email). Rândul `users` rămâne până la
   * finalul jobului. La unire, conturile Discord / Google / Steam pe care ținta nu le are trec întâi în țintă.
   */
  private async block(tx: Tx, removal: Pick<MemberRemoval, "id" | "userId" | "targetId">): Promise<void> {
    const { userId, targetId } = removal;
    if (targetId) {
      for (const move of await this.loginMoves(tx, userId, targetId)) {
        if (move.action === "move") await tx.account.updateMany({ where: { userId, providerId: move.providerId }, data: { userId: targetId } });
      }
    }
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.user.updateMany({
      where: { id: userId },
      data: { email: `deleted-${removal.id}${DELETED_EMAIL_DOMAIN}`, emailVerified: false, twoFactorEnabled: false, twoFactorSecret: null },
    });
  }

  /** Conturile de login: ale sursei trec în țintă doar pentru furnizorii pe care ținta nu-i are (parola nu se mută). */
  private async loginMoves(db: Pick<PrismaClient, "account"> | Tx, sourceId: string, targetId: string): Promise<GcsLoginMove[]> {
    const [source, target] = await Promise.all([
      db.account.findMany({ where: { userId: sourceId }, select: { providerId: true } }),
      db.account.findMany({ where: { userId: targetId }, select: { providerId: true } }),
    ]);
    const has = new Set(target.map((a) => a.providerId));
    return source.map((a) => ({ providerId: a.providerId, action: a.providerId !== "credential" && !has.has(a.providerId) ? "move" : "drop" }));
  }

  /** Creează rândul operației; indexul unic parțial prinde o a doua operație pornită simultan pe același cont. */
  private async createRemoval(tx: Tx, data: Prisma.MemberRemovalUncheckedCreateInput): Promise<MemberRemoval> {
    try {
      return await tx.memberRemoval.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new GcsConflict({ reason: "removal_in_progress" });
      throw e;
    }
  }

  /**
   * Ștergerea din ACP (specul §2, §3): dreptul `delete`, regulile de siguranță, blocarea imediată, apoi jobul (un cont
   * mic se procesează pe loc). Întoarce operația (pentru pagina de progres).
   */
  async requestDelete(actor: GcsActor, userId: string, input: { mode: GcsRemovalMode; keepMessages: boolean }): Promise<MemberRemoval> {
    await this.assertRight(actor);
    if (input.mode !== "KEEP_CONTENT" && input.mode !== "DELETE_CONTENT") throw new GcsValidationError({ mode: "invalid_choice" });
    await this.assertManageable(actor, userId, "remove");
    const user = await this.loadUser(userId);
    await this.assertFree(userId, { supersede: true });
    const { total } = await this.collect(userId);
    const removal = await this.deps.db.$transaction(async (tx) => {
      await this.supersedeScheduled(tx, userId);
      const row = await this.createRemoval(tx, {
        kind: "DELETE",
        status: "QUEUED",
        source: "ACP",
        mode: input.mode,
        keepMessages: input.mode === "KEEP_CONTENT" && input.keepMessages,
        userId,
        userName: user.name,
        requestedById: actor.userId,
      });
      await this.block(tx, row);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.delete.request",
        targetType: "user",
        targetId: userId,
        before: { name: user.name },
        after: { mode: row.mode, keepMessages: row.keepMessages, removalId: row.id },
        ip: actor.ip,
      });
      return row;
    });
    await this.blocked(userId);
    await this.dispatch(removal, total);
    return (await this.deps.db.memberRemoval.findUnique({ where: { id: removal.id } })) ?? removal;
  }

  /** Unirea din ACP (specul §4): sursa se mută în țintă, apoi se șterge. */
  async requestMerge(actor: GcsActor, sourceId: string, targetId: string): Promise<MemberRemoval> {
    await this.assertRight(actor);
    if (sourceId === targetId) throw new GcsValidationError({ target: "same_account" });
    await this.assertManageable(actor, sourceId, "remove");
    await this.assertManageable(actor, targetId, "keep");
    const [source, target] = await Promise.all([this.loadUser(sourceId), this.loadUser(targetId)]);
    await this.assertFree(sourceId, { supersede: true });
    await this.assertFree(targetId);
    const { total } = await this.collect(sourceId);
    const removal = await this.deps.db.$transaction(async (tx) => {
      await this.supersedeScheduled(tx, sourceId);
      const row = await this.createRemoval(tx, {
        kind: "MERGE",
        status: "QUEUED",
        source: "ACP",
        userId: sourceId,
        userName: source.name,
        targetId,
        targetName: target.name,
        requestedById: actor.userId,
      });
      await this.block(tx, row);
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.merge.request",
        targetType: "user",
        targetId: sourceId,
        before: { name: source.name },
        after: { targetId, removalId: row.id },
        ip: actor.ip,
      });
      return row;
    });
    await this.blocked(sourceId, targetId);
    await this.dispatch(removal, total);
    return (await this.deps.db.memberRemoval.findUnique({ where: { id: removal.id } })) ?? removal;
  }

  /** Cache-ul userului blocat (cardul, profilul), ca să nu mai apară cu datele vechi. */
  private async blocked(...userIds: string[]): Promise<void> {
    await this.deps.bus.emit({ name: "user.blocked", payload: { userIds }, tags: userIds.map((id) => `user:${id}`) });
  }

  /** Un cont mic rulează imediat (în aceeași cerere); unul mare doar intră în coadă. */
  private async dispatch(removal: MemberRemoval, total: number): Promise<void> {
    if (total <= (this.deps.inlineLimit ?? 500)) await this.run(removal.id);
    else await this.enqueue(removal);
  }

  private async enqueue(removal: Pick<MemberRemoval, "id" | "attempts">): Promise<void> {
    // BullMQ nu acceptă `:` în id; o încercare nouă are alt id (unul terminat sau eșuat nu blochează repunerea).
    await this.deps.jobs?.enqueue(MEMBER_REMOVAL_RUN_JOB, { id: removal.id }, { jobId: `member-removal-${removal.id}-${removal.attempts}` });
  }

  // ─── Cererea membrului (Setări → Cont) ─────────────────────────────────────────────────────────────────────

  /** Cererea membrului în perioada de răzgândire (sau `null`). */
  async pendingFor(userId: string): Promise<MemberRemoval | null> {
    return this.deps.db.memberRemoval.findFirst({ where: { userId, status: "SCHEDULED" } });
  }

  /**
   * Cererea membrului (specul §5). Parola / autentificarea recentă și 2FA le verifică apelantul (stratul web). Modul e
   * mereu „Păstrează conținutul”; ultimul Root Admin nu poate cere ștergerea.
   */
  async requestSelf(userId: string, ip: string | null): Promise<MemberRemoval> {
    const { db, settings } = this.deps;
    const user = await this.loadUser(userId);
    if (user.isRoot) {
      const root = await db.group.findUniqueOrThrow({ where: { key: "root_admin" }, select: { id: true } });
      if ((await db.user.count({ where: rootUsersWhere(root.id) })) <= 1) throw new GcsConflict({ reason: "last_root" });
    }
    await this.assertFree(userId);
    const days = Math.min(90, Math.max(0, Math.floor(Number(await settings.get<number>(DELETION_COOLING_SETTING)) || 0)));
    const runAfter = new Date(this.now().getTime() + days * 86_400_000);
    const removal = await db.$transaction(async (tx) => {
      const row = await this.createRemoval(tx, { kind: "DELETE", status: "SCHEDULED", source: "SELF", mode: "KEEP_CONTENT", userId, userName: user.name, requestedById: userId, runAfter });
      await writeAudit(tx, { actorId: userId, action: "user.delete.self_request", targetType: "user", targetId: userId, before: { name: user.name }, after: { runAfter: runAfter.toISOString(), removalId: row.id }, ip });
      return row;
    });
    await this.deps.bus.emit({ name: "user.deletion_requested", payload: { userId, removalId: removal.id }, tags: [`user:${userId}`] });
    return removal;
  }

  /** Membrul își anulează cererea (în perioada de răzgândire). */
  async cancelSelf(userId: string, ip: string | null): Promise<void> {
    const pending = await this.pendingFor(userId);
    if (!pending) throw new GcsNotFound();
    await this.deps.db.$transaction(async (tx) => {
      const { count } = await tx.memberRemoval.updateMany({ where: { id: pending.id, status: "SCHEDULED" }, data: { status: "CANCELLED", finishedAt: this.now() } });
      if (count === 0) throw new GcsConflict({ reason: "removal_started" });
      await writeAudit(tx, { actorId: userId, action: "user.delete.self_cancel", targetType: "user", targetId: userId, after: { removalId: pending.id }, ip });
    });
    await this.deps.bus.emit({ name: "user.deletion_cancelled", payload: { userId, removalId: pending.id }, tags: [`user:${userId}`] });
  }

  // ─── ACP → Cereri GDPR ─────────────────────────────────────────────────────────────────────────────────────

  async list(q: { status?: MemberRemovalStatus | "active"; page: number }): Promise<{ items: MemberRemoval[]; total: number; page: number; pages: number }> {
    const where: Prisma.MemberRemovalWhereInput = q.status === "active" ? { status: { in: ACTIVE } } : q.status ? { status: q.status } : {};
    const page = Math.max(1, Math.floor(q.page) || 1);
    const [total, items] = await Promise.all([
      this.deps.db.memberRemoval.count({ where }),
      this.deps.db.memberRemoval.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  async get(id: string): Promise<GcsRemovalView | null> {
    const row = await this.deps.db.memberRemoval.findUnique({ where: { id } });
    return row ? { ...row, stepsState: (row.steps ?? {}) as StepsState, stepKeys: this.stepKeys() } : null;
  }

  private async load(id: string): Promise<MemberRemoval> {
    const row = await this.deps.db.memberRemoval.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    return row;
  }

  /** Staff-ul anulează o cerere a membrului încă în perioada de răzgândire. */
  async cancel(actor: GcsActor, id: string): Promise<void> {
    await this.deps.acp.assert(actor, GDPR_ACP_SECTION, "edit");
    const row = await this.load(id);
    await this.deps.db.$transaction(async (tx) => {
      const { count } = await tx.memberRemoval.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "CANCELLED", finishedAt: this.now() } });
      if (count === 0) throw new GcsConflict({ reason: "removal_started" });
      await writeAudit(tx, { actorId: actor.userId, action: "user.delete.cancel", targetType: "user", targetId: row.userId, before: { name: row.userName }, after: { removalId: id }, ip: actor.ip });
    });
    await this.deps.bus.emit({ name: "user.deletion_cancelled", payload: { userId: row.userId, removalId: id }, tags: [`user:${row.userId}`] });
  }

  /** Staff-ul rulează acum o cerere a membrului (fără să mai aștepte perioada de răzgândire). */
  async runNow(actor: GcsActor, id: string): Promise<void> {
    await this.deps.acp.assert(actor, GDPR_ACP_SECTION, "edit");
    const row = await this.load(id);
    if (row.status !== "SCHEDULED") throw new GcsConflict({ reason: "removal_started" });
    await this.assertManageable(actor, row.userId, "remove");
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "user.delete.run_now", targetType: "user", targetId: row.userId, before: { name: row.userName }, after: { removalId: id }, ip: actor.ip });
    await this.start(row);
  }

  /** Reia o operație eșuată (de la pasul la care a rămas). */
  async retry(actor: GcsActor, id: string): Promise<void> {
    await this.deps.acp.assert(actor, GDPR_ACP_SECTION, "edit");
    const row = await this.load(id);
    const { count } = await this.deps.db.memberRemoval.updateMany({ where: { id, status: "FAILED" }, data: { status: "QUEUED", attempts: 0, error: null } });
    if (count === 0) throw new GcsConflict({ reason: "removal_not_failed" });
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "user.delete.retry", targetType: "user", targetId: row.userId, before: { name: row.userName }, after: { removalId: id }, ip: actor.ip });
    await this.enqueue({ id, attempts: 0 });
  }

  /** O cerere ajunsă la termen (sau rulată acum): blocarea, apoi jobul. */
  private async start(row: MemberRemoval): Promise<void> {
    const started = await this.deps.db.$transaction(async (tx) => {
      const { count } = await tx.memberRemoval.updateMany({ where: { id: row.id, status: "SCHEDULED" }, data: { status: "QUEUED" } });
      if (count === 0) return false;
      await this.block(tx, row);
      return true;
    });
    if (!started) return;
    await this.blocked(row.userId);
    await this.enqueue(row);
  }

  /**
   * Jobul periodic: pornește cererile ajunse la termen și repune în coadă operațiile agățate (jobul pierdut, procesul
   * căzut în timpul rulării).
   */
  async sweep(now = this.now()): Promise<{ started: number; requeued: number }> {
    const { db } = this.deps;
    const due = await db.memberRemoval.findMany({ where: { status: "SCHEDULED", runAfter: { lte: now } }, orderBy: { runAfter: "asc" }, take: 50 });
    for (const row of due) await this.start(row);
    const stuck = await db.memberRemoval.findMany({
      where: {
        OR: [
          { status: "QUEUED", updatedAt: { lt: new Date(now.getTime() - STALE_QUEUED_MS) } },
          { status: "RUNNING", OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } }] },
        ],
      },
      take: 50,
    });
    for (const row of stuck) {
      // Atinge rândul, ca un job încă în așteptare să nu fie repus la fiecare trecere.
      if (row.status === "QUEUED") await db.memberRemoval.updateMany({ where: { id: row.id, status: "QUEUED" }, data: { updatedAt: now } });
      await this.enqueue(row);
    }
    return { started: due.length, requeued: stuck.length };
  }

  registerJobs(jobs: GcsJobQueue): void {
    jobs.register({ name: MEMBER_REMOVAL_RUN_JOB, handler: async (data) => void (typeof data.id === "string" ? await this.run(data.id) : undefined) });
    jobs.register({ name: MEMBER_REMOVAL_SWEEP_JOB, everyMs: SWEEP_EVERY_MS, handler: async () => void (await this.sweep()) });
  }

  // ─── Rularea ───────────────────────────────────────────────────────────────────────────────────────────────

  /** Revendică rularea: din coadă sau o rulare căzută (fără heartbeat). Doi alergători nu lucrează simultan. */
  private async claim(id: string): Promise<MemberRemoval | null> {
    const now = this.now();
    const stale = new Date(now.getTime() - STALE_RUNNING_MS);
    const { count } = await this.deps.db.memberRemoval.updateMany({
      where: { id, OR: [{ status: "QUEUED" }, { status: "RUNNING", OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: stale } }] }] },
      data: { status: "RUNNING", heartbeatAt: now, attempts: { increment: 1 } },
    });
    if (count === 0) return null;
    const row = await this.deps.db.memberRemoval.findUniqueOrThrow({ where: { id } });
    if (!row.startedAt) await this.deps.db.memberRemoval.update({ where: { id }, data: { startedAt: now } });
    return row;
  }

  private async save(id: string, steps: StepsState, currentStep: string | null): Promise<void> {
    await this.deps.db.memberRemoval.update({ where: { id }, data: { steps: steps as Prisma.InputJsonValue, currentStep, heartbeatAt: this.now() } });
  }

  /**
   * Rulează (sau reia) o operație: fiecare pas al handler-elor, pe loturi, cu progresul salvat după fiecare lot; apoi
   * pasul final (rândul `users` se șterge), jurnalul și evenimentele. O eroare lasă operația în coadă pentru o nouă
   * încercare (sweep-ul o repune), iar după `MAX_ATTEMPTS` o marchează `FAILED`.
   */
  async run(id: string): Promise<void> {
    const row = await this.claim(id);
    if (!row) return;
    const steps: StepsState = { ...((row.steps ?? {}) as StepsState) };
    const batchSize = this.deps.batchSize ?? 100;
    try {
      if (Object.keys(steps).length === 0) {
        await this.deps.bus.emit(
          row.kind === "DELETE"
            ? { name: "user.deleting", payload: { userId: row.userId, removalId: row.id, mode: row.mode }, tags: [] }
            : { name: "user.merging", payload: { sourceId: row.userId, targetId: row.targetId, removalId: row.id }, tags: [] },
        );
      }
      for (const h of this.steps) {
        const state = steps[h.key] ?? { done: false, processed: 0 };
        steps[h.key] = state;
        if (state.done) continue;
        await this.save(row.id, steps, h.key);
        const cursor = { value: state.cursor ?? null };
        for (;;) {
          const n =
            row.kind === "DELETE"
              ? await h.erase({ userId: row.userId, mode: row.mode, keepMessages: row.keepMessages, batchSize, cursor })
              : await h.merge({ sourceId: row.userId, targetId: row.targetId!, batchSize, cursor });
          state.cursor = cursor.value;
          if (n === 0) break;
          state.processed += n;
          await this.save(row.id, steps, h.key);
        }
        state.done = true;
        await this.save(row.id, steps, h.key);
      }
      await this.finish(row, steps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.db.memberRemoval.update({
        where: { id: row.id },
        // `attempts` numără deja rularea curentă (crescut la revendicare).
        data: { status: row.attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED", error: message.slice(0, 1000), heartbeatAt: null, steps: steps as Prisma.InputJsonValue },
      });
      console.error(`[gcs] operația ${row.id} (${row.kind}) a eșuat`, error);
    }
  }

  /** Pasul final: rândul `users` se șterge (relațiile rămase în cascadă), jurnalul și evenimentele. */
  private async finish(row: MemberRemoval, steps: StepsState): Promise<void> {
    const { db, bus } = this.deps;
    await db.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { id: row.userId } });
      await tx.memberRemoval.update({ where: { id: row.id }, data: { status: "DONE", finishedAt: this.now(), currentStep: null, error: null, steps: steps as Prisma.InputJsonValue } });
      await writeAudit(tx, {
        actorId: row.requestedById,
        action: row.kind === "DELETE" ? "user.delete.done" : "user.merge.done",
        targetType: "user",
        targetId: row.userId,
        before: { name: row.userName },
        after: row.kind === "DELETE" ? { mode: row.mode, removalId: row.id } : { targetId: row.targetId, removalId: row.id },
        ip: null,
      });
    });
    const tags = [`user:${row.userId}`, "forums-tree", "clans", "members"];
    if (row.kind === "DELETE") {
      await bus.emit({ name: "user.deleted", payload: { userId: row.userId, removalId: row.id, mode: row.mode }, tags });
    } else {
      await bus.emit({ name: "user.merged", payload: { sourceId: row.userId, targetId: row.targetId, removalId: row.id }, tags: [...tags, `user:${row.targetId}`] });
    }
  }
}
