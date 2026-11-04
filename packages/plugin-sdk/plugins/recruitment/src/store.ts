/**
 * Baza pluginului (schema proprie): posturile și aplicațiile. Tot SQL-ul e parametrizat; drepturile se verifică în
 * `server.ts`, înainte de orice apel de aici.
 */
import type { GcsPluginContext } from "../../../src/index";
import { isAppStatus, isApplyMode, isStatus, type AppStatus, type ApplyMode, type PositionInput, type Status } from "./model";

export type Position = {
  id: number;
  name: string;
  description: string;
  status: Status;
  groupId: number | null;
  icon: string;
  applyMode: ApplyMode;
  applyForumId: number | null;
  applyUrl: string;
  questions: string;
  sort: number;
  pending: number;
};

export type Application = { id: number; positionId: number; positionName: string; userId: string; answers: string; status: AppStatus; note: string; handledBy: string | null; createdAt: string; handledAt: string | null };

export function isoOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(typeof v === "string" && /^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") : v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
  }
  return "";
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function position(r: Record<string, unknown>): Position {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
    status: isStatus(r.status) ? r.status : "open",
    groupId: num(r.group_id),
    icon: String(r.icon ?? ""),
    applyMode: isApplyMode(r.apply_mode) ? r.apply_mode : "form",
    applyForumId: num(r.apply_forum_id),
    applyUrl: String(r.apply_url ?? ""),
    questions: String(r.questions ?? ""),
    sort: Number(r.sort ?? 0),
    pending: Number(r.pending ?? 0),
  };
}

const POSITION_COLS = `p.id, p.name, p.description, p.status, p.group_id, p.icon, p.apply_mode, p.apply_forum_id, p.apply_url, p.questions, p.sort,
  (SELECT count(*) FROM applications a WHERE a.position_id = p.id AND a.status = 'pending')::int AS pending`;

export async function listPositions(ctx: GcsPluginContext, opts: { openOnly?: boolean } = {}): Promise<Position[]> {
  const rows = await ctx.db.query(`SELECT ${POSITION_COLS} FROM positions p ${opts.openOnly ? "WHERE p.status <> 'closed'" : ""} ORDER BY p.sort, p.id LIMIT 100`);
  return rows.map(position);
}

export async function getPosition(ctx: GcsPluginContext, id: number): Promise<Position | null> {
  const rows = await ctx.db.query(`SELECT ${POSITION_COLS} FROM positions p WHERE p.id = $1`, [id]);
  return rows[0] ? position(rows[0]) : null;
}

export async function countPositions(ctx: GcsPluginContext): Promise<number> {
  const rows = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM positions");
  return Number(rows[0]?.n ?? 0);
}

/** Adaugă sau actualizează un post; întoarce id-ul (`null` = postul de editat nu există). */
export async function savePosition(ctx: GcsPluginContext, p: PositionInput): Promise<number | null> {
  const values = [p.name, p.description, p.status, p.groupId, p.icon, p.applyMode, p.applyForumId, p.applyUrl, p.questions, p.sort];
  if (p.id === null) {
    const rows = await ctx.db.query<{ id: number }>(
      `INSERT INTO positions (name, description, status, group_id, icon, apply_mode, apply_forum_id, apply_url, questions, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      values,
    );
    return Number(rows[0]!.id);
  }
  const changed = await ctx.db.execute(
    `UPDATE positions SET name = $1, description = $2, status = $3, group_id = $4, icon = $5, apply_mode = $6, apply_forum_id = $7, apply_url = $8, questions = $9, sort = $10, updated_at = now() WHERE id = $11`,
    [...values, p.id],
  );
  return changed > 0 ? p.id : null;
}

export async function deletePosition(ctx: GcsPluginContext, id: number): Promise<boolean> {
  return (await ctx.db.execute("DELETE FROM positions WHERE id = $1", [id])) > 0;
}

export async function hasPending(ctx: GcsPluginContext, positionId: number, userId: string): Promise<boolean> {
  const rows = await ctx.db.query("SELECT 1 FROM applications WHERE position_id = $1 AND user_id = $2 AND status = 'pending' LIMIT 1", [positionId, userId]);
  return rows.length > 0;
}

export async function createApplication(ctx: GcsPluginContext, positionId: number, userId: string, answers: string): Promise<number> {
  const rows = await ctx.db.query<{ id: number }>("INSERT INTO applications (position_id, user_id, answers) VALUES ($1, $2, $3) RETURNING id", [positionId, userId, answers]);
  return Number(rows[0]!.id);
}

function application(r: Record<string, unknown>): Application {
  return {
    id: Number(r.id),
    positionId: Number(r.position_id),
    positionName: String(r.position_name ?? ""),
    userId: String(r.user_id ?? ""),
    answers: String(r.answers ?? ""),
    status: isAppStatus(r.status) ? r.status : "pending",
    note: String(r.note ?? ""),
    handledBy: r.handled_by === null || r.handled_by === undefined ? null : String(r.handled_by),
    createdAt: isoOf(r.created_at),
    handledAt: r.handled_at === null || r.handled_at === undefined ? null : isoOf(r.handled_at),
  };
}

export async function listApplications(ctx: GcsPluginContext, filter: { status?: AppStatus; positionId?: number; userId?: string }, limit = 50): Promise<Application[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) where.push(`a.status = $${params.push(filter.status)}`);
  if (filter.positionId) where.push(`a.position_id = $${params.push(filter.positionId)}`);
  if (filter.userId) where.push(`a.user_id = $${params.push(filter.userId)}`);
  const rows = await ctx.db.query(
    `SELECT a.id, a.position_id, p.name AS position_name, a.user_id, a.answers, a.status, a.note, a.handled_by, a.created_at, a.handled_at
     FROM applications a JOIN positions p ON p.id = a.position_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY (a.status = 'pending') DESC, a.created_at DESC LIMIT ${Math.max(1, Math.min(200, limit))}`,
    params,
  );
  return rows.map(application);
}

export async function setApplicationStatus(ctx: GcsPluginContext, id: number, status: AppStatus, note: string, by: string): Promise<boolean> {
  return (await ctx.db.execute("UPDATE applications SET status = $1, note = $2, handled_by = $3, handled_at = now() WHERE id = $4", [status, note, by, id])) > 0;
}

export async function pendingCount(ctx: GcsPluginContext): Promise<number> {
  const rows = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM applications WHERE status = 'pending'");
  return Number(rows[0]?.n ?? 0);
}
