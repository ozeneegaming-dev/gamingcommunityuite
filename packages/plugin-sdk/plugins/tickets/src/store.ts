/**
 * Accesul la baza de date a pluginului (schema proprie): ticketele, mesajele, evenimentele și citirile. Tot SQL-ul e
 * parametrizat; verificarea drepturilor e în `server.ts`, înainte de orice apel de aici.
 */
import type { GcsPluginContext } from "../../../src/index";
import type { NewTicket, Priority, Status } from "./model";

export type Ticket = {
  id: number;
  userId: string;
  subject: string;
  category: string;
  priority: Priority;
  status: Status;
  assigneeId: string | null;
  replies: number;
  createdAt: string;
  updatedAt: string;
  lastReplyAt: string;
  lastReplyBy: string | null;
  firstStaffReplyAt: string | null;
  closedAt: string | null;
  /** Doar în liste: are mesaje noi pentru vizitator. */
  unread?: boolean;
};

export type Message = { id: number; userId: string | null; body: string; staff: boolean; internal: boolean; createdAt: string };
export type TicketEvent = { id: number; actorId: string | null; action: string; value: string; createdAt: string };

/** O dată din PostgreSQL (text sau `Date`, după cum o transmite gazda) ca ISO 8601. */
export function isoOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(typeof v === "string" && /^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") : v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
  }
  return "";
}
const isoOrNull = (v: unknown) => (v === null || v === undefined ? null : isoOf(v));

const TICKET_COLUMNS =
  "t.id, t.user_id, t.subject, t.category, t.priority, t.status, t.assignee_id, t.replies, t.created_at, t.updated_at, t.last_reply_at, t.last_reply_by, t.first_staff_reply_at, t.closed_at";

type TicketRow = {
  id: number;
  user_id: string;
  subject: string;
  category: string;
  priority: Priority;
  status: Status;
  assignee_id: string | null;
  replies: number;
  created_at: unknown;
  updated_at: unknown;
  last_reply_at: unknown;
  last_reply_by: string | null;
  first_staff_reply_at: unknown;
  closed_at: unknown;
  unread?: boolean;
};

function toTicket(r: TicketRow): Ticket {
  return {
    id: Number(r.id),
    userId: r.user_id,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    assigneeId: r.assignee_id,
    replies: Number(r.replies),
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
    lastReplyAt: isoOf(r.last_reply_at),
    lastReplyBy: r.last_reply_by,
    firstStaffReplyAt: isoOrNull(r.first_staff_reply_at),
    closedAt: isoOrNull(r.closed_at),
    ...(r.unread !== undefined ? { unread: Boolean(r.unread) } : {}),
  };
}

export async function getTicket(ctx: GcsPluginContext, id: number): Promise<Ticket | null> {
  const [row] = await ctx.db.query<TicketRow>(`SELECT ${TICKET_COLUMNS} FROM tickets t WHERE t.id = $1`, [id]);
  return row ? toTicket(row) : null;
}

export async function countOpenOf(ctx: GcsPluginContext, userId: string): Promise<number> {
  const [row] = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM tickets WHERE user_id = $1 AND status <> 'closed'", [userId]);
  return Number(row?.n ?? 0);
}

export async function createTicket(ctx: GcsPluginContext, userId: string, t: NewTicket): Promise<number> {
  const [row] = await ctx.db.query<{ id: number }>(
    `WITH t AS (
       INSERT INTO tickets (user_id, subject, category, priority, last_reply_by) VALUES ($1, $2, $3, $4, $1) RETURNING id
     ), m AS (
       INSERT INTO messages (ticket_id, user_id, body) SELECT id, $1, $5 FROM t
     ), r AS (
       INSERT INTO reads (ticket_id, user_id) SELECT id, $1 FROM t
     )
     SELECT id FROM t`,
    [userId, t.subject, t.category, t.priority, t.body],
  );
  return Number(row!.id);
}

/**
 * Un răspuns (sau o notă internă): mesajul, starea nouă, ultima activitate și, pentru primul răspuns public al
 * staff-ului, momentul lui (timpul de răspuns din ACP). Totul într-o tranzacție.
 */
export async function addReply(
  ctx: GcsPluginContext,
  ticket: Ticket,
  input: { userId: string; body: string; staff: boolean; internal: boolean; status: Status },
): Promise<void> {
  const publicReply = !input.internal;
  await ctx.db.batch([
    { sql: "INSERT INTO messages (ticket_id, user_id, body, staff, internal) VALUES ($1, $2, $3, $4, $5)", params: [ticket.id, input.userId, input.body, input.staff, input.internal] },
    {
      sql: `UPDATE tickets SET
              status = $2,
              replies = replies + $3,
              updated_at = now(),
              last_reply_at = CASE WHEN $4 THEN now() ELSE last_reply_at END,
              last_reply_by = CASE WHEN $4 THEN $5 ELSE last_reply_by END,
              first_staff_reply_at = CASE WHEN $6 AND first_staff_reply_at IS NULL THEN now() ELSE first_staff_reply_at END,
              closed_at = CASE WHEN $2 = 'closed' THEN COALESCE(closed_at, now()) ELSE NULL END
            WHERE id = $1`,
      params: [ticket.id, input.status, publicReply ? 1 : 0, publicReply, input.userId, publicReply && input.staff],
    },
    ...(input.status !== ticket.status ? [{ sql: "INSERT INTO events (ticket_id, actor_id, action, value) VALUES ($1, $2, 'status', $3)", params: [ticket.id, input.userId, input.status] }] : []),
    markReadStatement(ticket.id, input.userId),
  ]);
}

function markReadStatement(ticketId: number, userId: string) {
  return {
    sql: "INSERT INTO reads (ticket_id, user_id, read_at) VALUES ($1, $2, now()) ON CONFLICT (ticket_id, user_id) DO UPDATE SET read_at = now()",
    params: [ticketId, userId],
  };
}

export async function markRead(ctx: GcsPluginContext, ticketId: number, userId: string): Promise<void> {
  const s = markReadStatement(ticketId, userId);
  await ctx.db.execute(s.sql, s.params);
}

/** Schimbările staff-ului (stare, prioritate, categorie, responsabil): doar câmpurile date, fiecare cu evenimentul lui. */
export async function updateTicket(
  ctx: GcsPluginContext,
  ticket: Ticket,
  actorId: string,
  patch: { status?: Status; priority?: Priority; category?: string; assigneeId?: string | null },
): Promise<number> {
  const statements: { sql: string; params: unknown[] }[] = [];
  const event = (action: string, value: string) => statements.push({ sql: "INSERT INTO events (ticket_id, actor_id, action, value) VALUES ($1, $2, $3, $4)", params: [ticket.id, actorId, action, value] });
  if (patch.status && patch.status !== ticket.status) {
    statements.push({
      sql: "UPDATE tickets SET status = $2, updated_at = now(), closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END WHERE id = $1",
      params: [ticket.id, patch.status],
    });
    event("status", patch.status);
  }
  if (patch.priority && patch.priority !== ticket.priority) {
    statements.push({ sql: "UPDATE tickets SET priority = $2, updated_at = now() WHERE id = $1", params: [ticket.id, patch.priority] });
    event("priority", patch.priority);
  }
  if (patch.category && patch.category !== ticket.category) {
    statements.push({ sql: "UPDATE tickets SET category = $2, updated_at = now() WHERE id = $1", params: [ticket.id, patch.category] });
    event("category", patch.category);
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== ticket.assigneeId) {
    statements.push({ sql: "UPDATE tickets SET assignee_id = $2, updated_at = now() WHERE id = $1", params: [ticket.id, patch.assigneeId] });
    event(patch.assigneeId ? "assign" : "unassign", patch.assigneeId ?? "");
  }
  if (statements.length > 0) await ctx.db.batch(statements);
  return statements.length;
}

export async function listMessages(ctx: GcsPluginContext, ticketId: number, withInternal: boolean): Promise<Message[]> {
  const rows = await ctx.db.query<{ id: number; user_id: string | null; body: string; staff: boolean; internal: boolean; created_at: unknown }>(
    `SELECT id, user_id, body, staff, internal, created_at FROM messages WHERE ticket_id = $1 ${withInternal ? "" : "AND internal = false"} ORDER BY id`,
    [ticketId],
  );
  return rows.map((r) => ({ id: Number(r.id), userId: r.user_id, body: r.body, staff: r.staff, internal: r.internal, createdAt: isoOf(r.created_at) }));
}

export async function listEvents(ctx: GcsPluginContext, ticketId: number): Promise<TicketEvent[]> {
  const rows = await ctx.db.query<{ id: number; actor_id: string | null; action: string; value: string; created_at: unknown }>(
    "SELECT id, actor_id, action, value, created_at FROM events WHERE ticket_id = $1 ORDER BY id",
    [ticketId],
  );
  return rows.map((r) => ({ id: Number(r.id), actorId: r.actor_id, action: r.action, value: r.value, createdAt: isoOf(r.created_at) }));
}

export type ListFilter = {
  /** Doar ticketele acestui membru (lista „Ticketele mele”). */
  ownerId?: string;
  status?: Status | "active";
  category?: string;
  /** Id-ul responsabilului, `"none"` = nepreluate. */
  assignee?: string;
  search?: string;
};

function where(f: ListFilter, params: unknown[]): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.ownerId) parts.push(`t.user_id = ${add(f.ownerId)}`);
  if (f.status === "active") parts.push("t.status <> 'closed'");
  else if (f.status) parts.push(`t.status = ${add(f.status)}`);
  if (f.category) parts.push(`t.category = ${add(f.category)}`);
  if (f.assignee === "none") parts.push("t.assignee_id IS NULL");
  else if (f.assignee) parts.push(`t.assignee_id = ${add(f.assignee)}`);
  if (f.search) {
    const id = /^#?(\d{1,9})$/.exec(f.search.trim());
    if (id) parts.push(`t.id = ${add(Number(id[1]))}`);
    else parts.push(`t.subject ILIKE ${add(`%${f.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)}`);
  }
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

/**
 * Ticketele, cu marcajul „nou” pentru vizitator. Ordinea: cele active întâi, apoi urgența (în coada staff-ului) și
 * ultima activitate.
 */
export async function listTickets(ctx: GcsPluginContext, f: ListFilter, viewerId: string, opts: { limit: number; offset: number; byPriority: boolean }): Promise<{ items: Ticket[]; total: number }> {
  const params: unknown[] = [];
  const clause = where(f, params);
  const [count] = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tickets t ${clause}`, params);
  const priorityOrder = opts.byPriority ? "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END," : "";
  const listParams = [...params, viewerId, opts.limit, opts.offset];
  const v = params.length + 1;
  const rows = await ctx.db.query<TicketRow>(
    `SELECT ${TICKET_COLUMNS},
            (t.last_reply_by IS DISTINCT FROM $${v} AND (r.read_at IS NULL OR r.read_at < t.last_reply_at)) AS unread
       FROM tickets t
       LEFT JOIN reads r ON r.ticket_id = t.id AND r.user_id = $${v}
       ${clause}
      ORDER BY (t.status = 'closed'), ${priorityOrder} t.last_reply_at DESC, t.id DESC
      LIMIT $${v + 1} OFFSET $${v + 2}`,
    listParams,
  );
  return { items: rows.map(toTicket), total: Number(count?.n ?? 0) };
}

/** Numărul ticketelor pe stări (toate sau ale unui membru). */
export async function countByStatus(ctx: GcsPluginContext, ownerId?: string): Promise<Record<Status, number>> {
  const rows = await ctx.db.query<{ status: Status; n: number }>(
    `SELECT status, count(*)::int AS n FROM tickets ${ownerId ? "WHERE user_id = $1" : ""} GROUP BY status`,
    ownerId ? [ownerId] : [],
  );
  const out: Record<Status, number> = { open: 0, in_progress: 0, answered: 0, closed: 0 };
  for (const r of rows) if (r.status in out) out[r.status] = Number(r.n);
  return out;
}

/** Ticketele active preluate de un membru al staff-ului și cele nepreluate (coada). */
export async function queueCounts(ctx: GcsPluginContext, staffId: string): Promise<{ mine: number; unassigned: number; waiting: number }> {
  const [row] = await ctx.db.query<{ mine: number; unassigned: number; waiting: number }>(
    `SELECT count(*) FILTER (WHERE assignee_id = $1 AND status <> 'closed')::int AS mine,
            count(*) FILTER (WHERE assignee_id IS NULL AND status <> 'closed')::int AS unassigned,
            count(*) FILTER (WHERE status = 'open')::int AS waiting
       FROM tickets`,
    [staffId],
  );
  return { mine: Number(row?.mine ?? 0), unassigned: Number(row?.unassigned ?? 0), waiting: Number(row?.waiting ?? 0) };
}

export type Overview = {
  byStatus: Record<Status, number>;
  byCategory: { category: string; total: number; active: number }[];
  byAssignee: { assigneeId: string; active: number; closed: number }[];
  avgFirstResponseSec: number | null;
  last7: number;
  closed7: number;
};

/** Statisticile din ACP. */
export async function overview(ctx: GcsPluginContext): Promise<Overview> {
  const [byStatus, byCategory, byAssignee, [times]] = await Promise.all([
    countByStatus(ctx),
    ctx.db.query<{ category: string; total: number; active: number }>(
      "SELECT category, count(*)::int AS total, count(*) FILTER (WHERE status <> 'closed')::int AS active FROM tickets GROUP BY category ORDER BY total DESC, category LIMIT 30",
    ),
    ctx.db.query<{ assignee_id: string; active: number; closed: number }>(
      `SELECT assignee_id, count(*) FILTER (WHERE status <> 'closed')::int AS active, count(*) FILTER (WHERE status = 'closed')::int AS closed
         FROM tickets WHERE assignee_id IS NOT NULL GROUP BY assignee_id ORDER BY active DESC, closed DESC LIMIT 20`,
    ),
    ctx.db.query<{ avg: number | null; last7: number; closed7: number }>(
      `SELECT avg(extract(epoch FROM first_staff_reply_at - created_at)) FILTER (WHERE first_staff_reply_at IS NOT NULL)::float8 AS avg,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
              count(*) FILTER (WHERE closed_at > now() - interval '7 days')::int AS closed7
         FROM tickets`,
    ),
  ]);
  return {
    byStatus,
    byCategory: byCategory.map((r) => ({ category: r.category, total: Number(r.total), active: Number(r.active) })),
    byAssignee: byAssignee.map((r) => ({ assigneeId: r.assignee_id, active: Number(r.active), closed: Number(r.closed) })),
    avgFirstResponseSec: times?.avg === null || times?.avg === undefined ? null : Number(times.avg),
    last7: Number(times?.last7 ?? 0),
    closed7: Number(times?.closed7 ?? 0),
  };
}

/** Închide ticketele „răspunse” fără reacția membrului de `days` zile (jobul `autoclose`). */
export async function autoClose(ctx: GcsPluginContext, days: number): Promise<number> {
  const rows = await ctx.db.query<{ id: number }>(
    `UPDATE tickets SET status = 'closed', closed_at = now(), updated_at = now()
      WHERE status = 'answered' AND last_reply_at < now() - make_interval(days => $1)
      RETURNING id`,
    [days],
  );
  if (rows.length > 0) {
    await ctx.db.batch(rows.map((r) => ({ sql: "INSERT INTO events (ticket_id, actor_id, action, value) VALUES ($1, NULL, 'autoclose', 'closed')", params: [r.id] })));
  }
  return rows.length;
}
