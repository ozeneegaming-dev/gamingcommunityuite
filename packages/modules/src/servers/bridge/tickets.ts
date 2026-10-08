import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, writeAudit, type GcsActor, type GcsEventBus, type GcsPermissionService, type GcsRendered } from "@gcs/core";
import type { GameTicketKind, GameTicketStatus, Prisma, PrismaClient } from "@gcs/db";
import type { GcsBridgeAdmins } from "./admins";
import { BRIDGE_PERMISSION } from "./config";
import { sanctionActive, type GcsBridgeSanctions } from "./sanctions";
import { plainText } from "./types";

export const TICKET_TITLE_MIN = 3;
export const TICKET_TITLE_MAX = 120;
const MAX_OPEN_PER_KIND = 3;
const MAX_PER_HOUR = 5;
const MAX_EVIDENCE = 10;
const MAX_RECIPIENTS = 100;
const PAGE_SIZE = 30;
const KINDS: GameTicketKind[] = ["APPEAL", "CHEATER", "ADMIN"];
/** Stările „deschise” (limitele pe autor și pe sancțiune). */
const OPEN_STATES: GameTicketStatus[] = ["OPEN", "REVIEW"];
/** Fluxul stărilor (§14). */
const FLOW: Record<GameTicketStatus, GameTicketStatus[]> = {
  OPEN: ["REVIEW", "ACCEPTED", "REJECTED", "CLOSED"],
  REVIEW: ["ACCEPTED", "REJECTED", "CLOSED", "OPEN"],
  ACCEPTED: ["CLOSED", "REVIEW"],
  REJECTED: ["CLOSED", "REVIEW"],
  CLOSED: ["REVIEW"],
};

export type GcsTicketInput = {
  kind: GameTicketKind;
  title: string;
  content: unknown;
  serverId?: number | null;
  sanctionId?: number | null;
  targetPlayerId?: number | null;
  targetUserId?: string | null;
  targetAdminId?: number | null;
  targetName?: string | null;
  evidence?: string[];
};

type TicketRow = Prisma.GameTicketGetPayload<{
  include: { author: { select: { id: true; name: true } }; server: { select: { id: true; name: true } }; sanction: { select: { id: true; type: true; reason: true; createdAt: true; expiresAt: true; unbannedAt: true } } };
}>;

export type GcsTicketSummary = {
  id: number;
  kind: GameTicketKind;
  status: GameTicketStatus;
  title: string;
  author: { id: string; name: string };
  server: { id: number; name: string } | null;
  targetName: string;
  assigneeId: string | null;
  createdAt: string;
  lastActivityAt: string;
};

export type GcsTicketMessageView = { id: number; kind: string; author: { id: string; name: string } | null; contentHtml: string; internal: boolean; data: unknown; createdAt: string };

export type GcsTicketView = GcsTicketSummary & {
  contentHtml: string;
  evidence: { url: string }[];
  sanction: { id: number; type: string; reason: string; createdAt: string; expiresAt: string | null; lifted: boolean } | null;
  targetPlayerId: number | null;
  targetUserId: string | null;
  targetAdminId: number | null;
  closedAt: string | null;
  messages: GcsTicketMessageView[];
  canHandle: boolean;
  canReply: boolean;
  transitions: GameTicketStatus[];
};

const TICKET_INCLUDE = {
  author: { select: { id: true, name: true } },
  server: { select: { id: true, name: true } },
  sanction: { select: { id: true, type: true, reason: true, createdAt: true, expiresAt: true, unbannedAt: true } },
} as const;

/**
 * Contestațiile bannurilor și reclamațiile (specul 2026-10-08-servere-bridge §14): crearea (cu limitele), discuția
 * (mesaje cu documentul editorului, note interne ale staff-ului, intrări de sistem), fluxul stărilor, responsabilul.
 * Cine vede: autorul, staff-ul cu `servers.tickets_manage` și adminii serverului (cu `d`) pentru contestațiile și
 * reclamațiile de cheater ale serverului lor; reclamațiile de admin doar staff-ul. Nimeni nu tratează un tichet despre el.
 */
export class GcsBridgeTickets {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      admins: GcsBridgeAdmins;
      sanctions: GcsBridgeSanctions;
      render: (content: unknown) => Promise<GcsRendered>;
      now?: () => number;
    },
  ) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  /** Tichetul e despre acest membru (reclamația unui admin)? */
  private async isAbout(userId: string, t: { targetUserId: string | null; targetAdminId: number | null }): Promise<boolean> {
    if (t.targetUserId === userId) return true;
    if (t.targetAdminId === null) return false;
    const admin = await this.deps.db.gameAdmin.findUnique({ where: { id: t.targetAdminId }, select: { userId: true } });
    return admin?.userId === userId;
  }

  private async serverHandler(actor: GcsActor, t: { kind: GameTicketKind; serverId: number | null }): Promise<boolean> {
    if (!actor.userId || t.kind === "ADMIN" || t.serverId === null) return false;
    return (await this.deps.admins.userFlags(actor.userId, t.serverId)).includes("d");
  }

  async canHandle(actor: GcsActor, t: { kind: GameTicketKind; serverId: number | null; authorId: string; targetUserId: string | null; targetAdminId: number | null }): Promise<boolean> {
    if (!actor.userId || actor.isBanned || actor.userId === t.authorId) return false;
    if (await this.isAbout(actor.userId, t)) return false;
    if (await this.deps.permissions.can(actor, BRIDGE_PERMISSION.ticketsManage)) return true;
    return this.serverHandler(actor, t);
  }

  async canView(actor: GcsActor, t: { kind: GameTicketKind; serverId: number | null; authorId: string; targetUserId: string | null; targetAdminId: number | null }): Promise<boolean> {
    if (!actor.userId || actor.isBanned) return false;
    if (actor.userId === t.authorId) return true;
    if (await this.deps.permissions.can(actor, BRIDGE_PERMISSION.ticketsManage)) return true;
    return (await this.serverHandler(actor, t)) && !(await this.isAbout(actor.userId, t));
  }

  async canViewId(actor: GcsActor, id: number): Promise<boolean> {
    const t = await this.deps.db.gameTicket.findUnique({ where: { id }, select: { kind: true, serverId: true, authorId: true, targetUserId: true, targetAdminId: true } });
    return t !== null && (await this.canView(actor, t));
  }

  async create(actor: GcsActor, input: GcsTicketInput): Promise<{ id: number }> {
    const { db, permissions, render, bus } = this.deps;
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.ticketsCreate });
    await permissions.assert(actor, BRIDGE_PERMISSION.ticketsCreate);
    const now = this.now();
    const errors: Record<string, string> = {};
    if (!KINDS.includes(input.kind)) throw new GcsValidationError({ kind: "invalid" });
    const title = plainText(input.title, TICKET_TITLE_MAX + 1);
    if (title.length < TICKET_TITLE_MIN) errors.title = "too_short";
    else if (title.length > TICKET_TITLE_MAX) errors.title = "too_long";
    const evidence = this.cleanEvidence(input.evidence, errors);

    const data: Prisma.GameTicketUncheckedCreateInput = { kind: input.kind, authorId: actor.userId, title, contentJson: {}, contentHtml: "", evidence, createdAt: now, lastActivityAt: now };
    if (input.kind === "APPEAL") {
      const sanction = Number.isInteger(input.sanctionId) ? await db.gameSanction.findUnique({ where: { id: input.sanctionId! }, include: { player: { select: { userId: true } } } }) : null;
      const own = sanction && (sanction.player?.userId === actor.userId || (sanction.targetKind && sanction.targetValue && (await db.gamePlayer.count({ where: { kind: sanction.targetKind, value: sanction.targetValue, userId: actor.userId } })) > 0));
      if (!sanction || !own) errors.sanctionId = "invalid";
      else if (!sanctionActive(sanction, now)) errors.sanctionId = "not_active";
      else {
        data.sanctionId = sanction.id;
        data.serverId = sanction.serverId;
        data.targetPlayerId = sanction.playerId;
        data.targetName = sanction.name ?? "";
      }
    } else {
      const server = Number.isInteger(input.serverId) ? await db.gameServer.findUnique({ where: { id: input.serverId! }, select: { id: true } }) : null;
      if (!server) errors.serverId = "required";
      else data.serverId = server.id;
      if (input.kind === "CHEATER") {
        const player = Number.isInteger(input.targetPlayerId) ? await db.gamePlayer.findUnique({ where: { id: input.targetPlayerId! }, select: { id: true, name: true } }) : null;
        const name = plainText(input.targetName, 32);
        if (!player && !name) errors.target = "required";
        data.targetPlayerId = player?.id ?? null;
        data.targetName = name || player?.name || "";
      } else {
        const admin = Number.isInteger(input.targetAdminId) ? await db.gameAdmin.findUnique({ where: { id: input.targetAdminId! }, include: { user: { select: { id: true, name: true } }, player: { select: { name: true, value: true } } } }) : null;
        const user = !admin && typeof input.targetUserId === "string" ? await db.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, name: true } }) : null;
        if (!admin && !user) errors.target = "required";
        else if ((admin?.userId ?? user?.id) === actor.userId) errors.target = "self";
        data.targetAdminId = admin?.id ?? null;
        data.targetUserId = admin?.userId ?? user?.id ?? null;
        data.targetName = admin ? (admin.user?.name ?? admin.player?.name ?? admin.name ?? admin.player?.value ?? "") : (user?.name ?? "");
      }
    }
    let rendered: GcsRendered | null = null;
    try {
      rendered = await render(input.content);
      if (rendered.text.trim().length === 0) errors.content = "required";
    } catch (error) {
      if (error instanceof GcsValidationError) Object.assign(errors, error.fields);
      else throw error;
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    data.contentJson = rendered!.json as Prisma.InputJsonValue;
    data.contentHtml = rendered!.html;

    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`game-ticket:${actor.userId}`}))`;
      const recent = await tx.gameTicket.count({ where: { authorId: actor.userId!, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } });
      if (recent >= MAX_PER_HOUR) throw new GcsRateLimited({ retryAfter: "3600" });
      const open = await tx.gameTicket.count({ where: { authorId: actor.userId!, kind: input.kind, status: { in: OPEN_STATES } } });
      if (open >= MAX_OPEN_PER_KIND) throw new GcsValidationError({ kind: "too_many_open" }, { max: String(MAX_OPEN_PER_KIND) });
      if (data.sanctionId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`game-appeal:${data.sanctionId}`}))`;
        if ((await tx.gameTicket.count({ where: { kind: "APPEAL", sanctionId: data.sanctionId, status: { in: OPEN_STATES } } })) > 0) throw new GcsValidationError({ sanctionId: "appeal_open" });
      }
      const created = await tx.gameTicket.create({ data });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.ticket.create", targetType: "game_ticket", targetId: String(created.id), after: { kind: created.kind, serverId: created.serverId, sanctionId: created.sanctionId }, ip: actor.ip });
      return created;
    });
    const recipients = (await this.handlers(row)).filter((id) => id !== actor.userId);
    await bus.emit({ name: "servers.ticket.created", payload: { ticketId: row.id, actorId: actor.userId, recipients }, tags: [] });
    return { id: row.id };
  }

  private cleanEvidence(list: unknown, errors: Record<string, string>): { url: string }[] {
    const urls = [...new Set((Array.isArray(list) ? list : []).map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))];
    if (urls.length > MAX_EVIDENCE) errors.evidence = "too_many";
    for (const u of urls) if (u.length > 500 || !URL.canParse(u) || new URL(u).protocol !== "https:") errors.evidence = "invalid_url";
    return urls.slice(0, MAX_EVIDENCE).map((url) => ({ url }));
  }

  /**
   * Cine poate trata tichetul (destinatarii notificării `servers.ticket_new`): staff-ul cu `servers.tickets_manage` și,
   * pentru contestații / reclamații de cheater, adminii serverului cu `d`; fără cel despre care e tichetul.
   */
  private async handlers(t: { kind: GameTicketKind; serverId: number | null; targetUserId: string | null; targetAdminId: number | null }): Promise<string[]> {
    const { db } = this.deps;
    const groups = await db.groupSetting.findMany({ where: { key: BRIDGE_PERMISSION.ticketsManage, value: { equals: true } }, select: { groupId: true } });
    const root = await db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } });
    const groupIds = [...new Set([...groups.map((g) => g.groupId), ...(root ? [root.id] : [])])];
    const staff = await db.user.findMany({
      where: { OR: [{ primaryGroupId: { in: groupIds } }, { groups: { some: { groupId: { in: groupIds } } } }], NOT: { primaryGroup: { key: "banned" } } },
      select: { id: true },
      take: MAX_RECIPIENTS,
    });
    const ids = new Set(staff.map((u) => u.id));
    if (t.kind !== "ADMIN" && t.serverId !== null) {
      const entries = await db.gameAdmin.findMany({
        where: { subject: "USER", userId: { not: null }, AND: [{ OR: [{ serverId: t.serverId }, { serverId: null }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: this.now() } }] }] },
        include: { preset: { select: { flags: true } } },
      });
      for (const e of entries) if ((e.flags ?? e.preset?.flags ?? "").includes("d")) ids.add(e.userId!);
    }
    const about = t.targetAdminId !== null ? (await db.gameAdmin.findUnique({ where: { id: t.targetAdminId }, select: { userId: true } }))?.userId : null;
    for (const id of [t.targetUserId, about]) if (id) ids.delete(id);
    return [...ids].slice(0, MAX_RECIPIENTS);
  }

  /** Tichetele autorului (`mine`) sau cele pe care actorul le poate trata (`handle`). */
  async list(actor: GcsActor, filter: { scope: "mine" | "handle"; kind?: GameTicketKind; status?: GameTicketStatus | "open"; serverId?: number; page?: number }): Promise<{ items: GcsTicketSummary[]; total: number; page: number; pages: number }> {
    const { db, permissions, admins } = this.deps;
    if (!actor.userId || actor.isBanned) throw new GcsForbidden();
    const and: Prisma.GameTicketWhereInput[] = [];
    if (filter.scope === "mine") and.push({ authorId: actor.userId });
    else if (!(await permissions.can(actor, BRIDGE_PERMISSION.ticketsManage))) {
      const servers = await admins.userServers(actor.userId, "d");
      if (servers.length === 0) return { items: [], total: 0, page: 1, pages: 1 };
      and.push({ kind: { in: ["APPEAL", "CHEATER"] } }, { NOT: { authorId: actor.userId } });
      if (!servers.includes(null)) and.push({ serverId: { in: servers.filter((s): s is number => s !== null) } });
    }
    if (filter.kind && KINDS.includes(filter.kind)) and.push({ kind: filter.kind });
    if (filter.status === "open") and.push({ status: { in: OPEN_STATES } });
    else if (filter.status) and.push({ status: filter.status });
    if (typeof filter.serverId === "number") and.push({ serverId: filter.serverId });
    const where: Prisma.GameTicketWhereInput = { AND: and };
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const [total, rows] = await Promise.all([
      db.gameTicket.count({ where }),
      db.gameTicket.findMany({ where, include: TICKET_INCLUDE, orderBy: { lastActivityAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    return { items: rows.map((r) => this.summary(r)), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  private summary(t: TicketRow): GcsTicketSummary {
    return {
      id: t.id,
      kind: t.kind,
      status: t.status,
      title: t.title,
      author: t.author,
      server: t.server,
      targetName: t.targetName,
      assigneeId: t.assigneeId,
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: t.lastActivityAt.toISOString(),
    };
  }

  /** Tichetul cu discuția; notele interne doar pentru cine îl poate trata. */
  async get(actor: GcsActor, id: number): Promise<GcsTicketView | null> {
    const { db } = this.deps;
    const t = await db.gameTicket.findUnique({ where: { id }, include: TICKET_INCLUDE });
    if (!t || !(await this.canView(actor, t))) return null;
    const handle = await this.canHandle(actor, t);
    const messages = await db.gameTicketMessage.findMany({ where: { ticketId: id, ...(handle ? {} : { internal: false }) }, orderBy: { id: "asc" } });
    const authors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(messages.flatMap((m) => (m.authorId ? [m.authorId] : [])))] } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
    const isAuthor = actor.userId === t.authorId;
    return {
      ...this.summary(t),
      contentHtml: t.contentHtml,
      evidence: (Array.isArray(t.evidence) ? t.evidence : []) as { url: string }[],
      sanction: t.sanction ? { id: t.sanction.id, type: t.sanction.type, reason: t.sanction.reason, createdAt: t.sanction.createdAt.toISOString(), expiresAt: t.sanction.expiresAt?.toISOString() ?? null, lifted: t.sanction.unbannedAt !== null } : null,
      targetPlayerId: t.targetPlayerId,
      targetUserId: handle ? t.targetUserId : null,
      targetAdminId: handle ? t.targetAdminId : null,
      closedAt: t.closedAt?.toISOString() ?? null,
      messages: messages.map((m) => ({ id: m.id, kind: m.kind, author: m.authorId ? (authors.get(m.authorId) ?? null) : null, contentHtml: m.contentHtml, internal: m.internal, data: m.data, createdAt: m.createdAt.toISOString() })),
      canHandle: handle,
      canReply: handle || (isAuthor && t.status !== "CLOSED"),
      transitions: handle ? FLOW[t.status] : isAuthor && t.status !== "CLOSED" ? ["CLOSED"] : [],
    };
  }

  /** Un răspuns: public (autorul sau staff-ul) sau notă internă (doar cine tratează). */
  async reply(actor: GcsActor, id: number, input: { content: unknown; internal?: boolean }): Promise<{ id: number }> {
    const { db, render, bus } = this.deps;
    const t = await db.gameTicket.findUnique({ where: { id } });
    if (!t || !(await this.canView(actor, t))) throw new GcsNotFound();
    const handle = await this.canHandle(actor, t);
    const isAuthor = actor.userId === t.authorId;
    if (!handle && !(isAuthor && t.status !== "CLOSED")) throw new GcsForbidden();
    const internal = input.internal === true;
    if (internal && !handle) throw new GcsForbidden();
    const rendered = await render(input.content);
    if (rendered.text.trim().length === 0) throw new GcsValidationError({ content: "required" });
    const now = this.now();
    const msg = await db.$transaction(async (tx) => {
      const created = await tx.gameTicketMessage.create({ data: { ticketId: id, authorId: actor.userId, kind: "MESSAGE", contentJson: rendered.json as Prisma.InputJsonValue, contentHtml: rendered.html, internal, createdAt: now } });
      await tx.gameTicket.update({ where: { id }, data: { lastActivityAt: now } });
      return created;
    });
    if (!internal) {
      // Răspunsul staff-ului ajunge la autor; răspunsul autorului ajunge la responsabil.
      const recipients = isAuthor ? (t.assigneeId ? [t.assigneeId] : []) : [t.authorId];
      if (recipients.length > 0) await bus.emit({ name: "servers.ticket.updated", payload: { ticketId: id, actorId: actor.userId, recipients, kind: "reply" }, tags: [] });
    }
    return { id: msg.id };
  }

  /**
   * Schimbarea stării (fluxul din §14); autorul își poate doar închide tichetul. Acceptarea unei contestații poate
   * ridica sancțiunea în același pas (`lift`), dacă actorul are dreptul s-o ridice.
   */
  async setStatus(actor: GcsActor, id: number, status: GameTicketStatus, opts: { lift?: boolean; reason?: string } = {}): Promise<void> {
    const { db, sanctions, bus } = this.deps;
    const t = await db.gameTicket.findUnique({ where: { id }, include: { sanction: true } });
    if (!t || !(await this.canView(actor, t))) throw new GcsNotFound();
    const handle = await this.canHandle(actor, t);
    const isAuthor = actor.userId === t.authorId;
    const allowed = handle ? FLOW[t.status].includes(status) : isAuthor && status === "CLOSED" && t.status !== "CLOSED";
    if (!allowed) throw new GcsValidationError({ status: "invalid_transition" });
    const lift = opts.lift === true && status === "ACCEPTED" && t.kind === "APPEAL" && t.sanction !== null && t.sanction.unbannedAt === null;
    if (lift && !(await sanctions.canSanction(actor, { type: t.sanction!.type, scope: t.sanction!.scope, serverId: t.sanction!.serverId, minutes: 1 }))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.sanction });
    const now = this.now();
    const actorName = (await db.user.findUnique({ where: { id: actor.userId! }, select: { name: true } }))?.name ?? "";
    const reason = plainText(opts.reason, 200);
    await db.$transaction(async (tx) => {
      const changed = await tx.gameTicket.updateMany({ where: { id, status: t.status }, data: { status, lastActivityAt: now, closedAt: status === "CLOSED" ? now : null } });
      if (changed.count === 0) throw new GcsValidationError({ status: "invalid_transition" });
      await tx.gameTicketMessage.create({ data: { ticketId: id, authorId: actor.userId, kind: "STATUS", data: { from: t.status, to: status, ...(lift ? { lifted: true } : {}), ...(reason ? { reason } : {}) }, createdAt: now } });
      if (lift) await sanctions.liftTx(t.sanction!.id, { at: now, byId: actor.userId, byName: actorName, reason: reason || `#${id}` }, undefined, tx);
      await writeAudit(tx, { actorId: actor.userId, action: "servers.ticket.status", targetType: "game_ticket", targetId: String(id), before: { status: t.status }, after: { status, lift }, ip: actor.ip });
    });
    if (!isAuthor) await bus.emit({ name: "servers.ticket.updated", payload: { ticketId: id, actorId: actor.userId, recipients: [t.authorId], kind: "status", status }, tags: [] });
    if (lift) await bus.emit({ name: "servers.sanction.changed", payload: { id: t.sanction!.id }, tags: ["servers:sanctions"] });
  }

  /** Responsabilul (`null` = nimeni); trebuie să poată trata tichetul. */
  async assign(actor: GcsActor, id: number, assigneeId: string | null): Promise<void> {
    const { db, bus } = this.deps;
    const t = await db.gameTicket.findUnique({ where: { id } });
    if (!t || !(await this.canHandle(actor, t))) throw new GcsNotFound();
    if (t.assigneeId === assigneeId) return;
    if (assigneeId !== null) {
      const user = await db.user.findUnique({ where: { id: assigneeId }, include: { groups: true } });
      const assignee = user ? { userId: user.id, groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId)], primaryGroupId: user.primaryGroupId, isBanned: false, ip: "" } : null;
      if (!assignee || !(await this.canHandle(assignee, t))) throw new GcsValidationError({ assigneeId: "invalid" });
    }
    const now = this.now();
    await db.$transaction(async (tx) => {
      await tx.gameTicket.update({ where: { id }, data: { assigneeId, lastActivityAt: now } });
      await tx.gameTicketMessage.create({ data: { ticketId: id, authorId: actor.userId, kind: "ASSIGN", internal: true, data: { from: t.assigneeId, to: assigneeId }, createdAt: now } });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.ticket.assign", targetType: "game_ticket", targetId: String(id), before: { assigneeId: t.assigneeId }, after: { assigneeId }, ip: actor.ip });
    });
    if (assigneeId && assigneeId !== actor.userId) await bus.emit({ name: "servers.ticket.updated", payload: { ticketId: id, actorId: actor.userId, recipients: [assigneeId], kind: "assign" }, tags: [] });
  }
}
