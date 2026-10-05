import type { Prisma, PrismaClient } from "@gcs/db";
import { writeAudit } from "../audit";
import { GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import type { GcsAcpRoleService } from "./roles";

/** Widgeturile dashboard-ului ACP (spec §12.2): cele din etapa 1, coada de moderare (etapa 2) și expirările VIP (etapa 3). */
export const ACP_WIDGETS = [
  "registrations",
  "vip_expiring",
  "moderation_queue",
  "system_health",
  "admin_notes",
  "online_users",
  "online_admins",
  "failed_acp_logins",
] as const;
export type GcsAcpWidget = (typeof ACP_WIDGETS)[number];

/** Layout-ul salvat pe admin: două coloane de widgeturi, widgeturile pliate și ordinea aplicațiilor. */
export type GcsAcpLayout = {
  main: GcsAcpWidget[];
  side: GcsAcpWidget[];
  collapsed: GcsAcpWidget[];
  appOrder: string[];
};

export const DEFAULT_ACP_LAYOUT: GcsAcpLayout = {
  main: ["registrations", "system_health", "vip_expiring"],
  side: ["moderation_queue", "admin_notes", "online_users", "online_admins", "failed_acp_logins"],
  collapsed: [],
  appOrder: [],
};

const ACP_APPS = new Set(["system", "community", "members", "vip", "gaming", "pages", "stats", "appearance"]);
const ONLINE_MINUTES = 15;
const NOTE_MAX = 10_000;
const isWidget = (v: unknown): v is GcsAcpWidget => ACP_WIDGETS.includes(v as GcsAcpWidget);

/** Normalizează un layout primit (din client sau din DB): elimină necunoscutele și dublurile, readaugă ce lipsește. */
export function normalizeAcpLayout(input: unknown): GcsAcpLayout {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const seen = new Set<GcsAcpWidget>();
  const take = (v: unknown) =>
    list(v).filter((w): w is GcsAcpWidget => {
      if (!isWidget(w) || seen.has(w)) return false;
      seen.add(w);
      return true;
    });

  const main = take(raw.main);
  const side = take(raw.side);
  // Widgeturile lipsă revin în coloana lor implicită, ca niciunul să nu dispară definitiv.
  for (const [column, defaults] of [
    [main, DEFAULT_ACP_LAYOUT.main],
    [side, DEFAULT_ACP_LAYOUT.side],
  ] as const) {
    for (const w of defaults) {
      if (seen.has(w)) continue;
      seen.add(w);
      column.push(w);
    }
  }

  const collapsed = [...new Set(list(raw.collapsed).filter(isWidget))];
  const appOrder = [...new Set(list(raw.appOrder).filter((a): a is string => typeof a === "string" && ACP_APPS.has(a)))];
  return { main, side, collapsed, appOrder };
}

/** Datele dashboard-ului ACP: layout-ul fiecărui admin și conținutul widgeturilor. */
export class GcsAcpDashboardService {
  constructor(private readonly deps: { db: PrismaClient; acp: GcsAcpRoleService }) {}

  async getLayout(userId: string): Promise<GcsAcpLayout> {
    const row = await this.deps.db.acpDashboardLayout.findUnique({ where: { userId } });
    return row ? normalizeAcpLayout(row.layout) : structuredClone(DEFAULT_ACP_LAYOUT);
  }

  async saveLayout(userId: string, layout: unknown): Promise<GcsAcpLayout> {
    const normalized = normalizeAcpLayout(layout);
    const json = normalized as unknown as Prisma.InputJsonValue;
    await this.deps.db.acpDashboardLayout.upsert({
      where: { userId },
      create: { userId, layout: json },
      update: { layout: json },
    });
    return normalized;
  }

  /** Înregistrările pe zi, pe ultimele `days` zile (inclusiv azi), în fusul orar al site-ului. */
  async registrations(days: number, now = new Date(), timeZone = "Europe/Bucharest"): Promise<{ x: string; y: number }[]> {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(day.format(new Date(now.getTime() - i * 86_400_000)));
    const since = new Date(now.getTime() - (days + 1) * 86_400_000);
    const users = await this.deps.db.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } });
    const counts = new Map(keys.map((k) => [k, 0]));
    for (const u of users) {
      const key = day.format(u.createdAt);
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }
    return keys.map((x) => ({ x, y: counts.get(x)! }));
  }

  async totals(now = new Date()): Promise<{ members: number; today: number; online: number }> {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const [members, today, online] = await Promise.all([
      this.deps.db.user.count(),
      this.deps.db.user.count({ where: { createdAt: { gte: startOfDay } } }),
      this.onlineCount(now),
    ]);
    return { members, today, online };
  }

  async getNote(): Promise<{ body: string; updatedBy: string | null; updatedAt: Date | null }> {
    const note = await this.deps.db.adminNote.findUnique({ where: { id: 1 } });
    if (!note) return { body: "", updatedBy: null, updatedAt: null };
    const author = note.updatedById
      ? await this.deps.db.user.findUnique({ where: { id: note.updatedById }, select: { name: true } })
      : null;
    return { body: note.body, updatedBy: author?.name ?? null, updatedAt: note.updatedAt };
  }

  async saveNote(body: string, actor: GcsActor): Promise<void> {
    await this.deps.acp.assert(actor, "system.dashboard", "edit");
    if (body.length > NOTE_MAX) throw new GcsValidationError({ body: "too_long" });
    await this.deps.db.$transaction(async (tx) => {
      const before = await tx.adminNote.findUnique({ where: { id: 1 } });
      await tx.adminNote.upsert({
        where: { id: 1 },
        create: { id: 1, body, updatedById: actor.userId },
        update: { body, updatedById: actor.userId },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "acp.note.update",
        targetType: "admin_note",
        targetId: "1",
        before: before?.body ?? "",
        after: body,
        ip: actor.ip,
      });
    });
  }

  /** O autentificare în ACP (parolă + 2FA): reușita salvează data și IP-ul, eșecul intră în jurnal. */
  async recordAcpLogin(userId: string, ip: string, success: boolean, now = new Date()): Promise<void> {
    const { db } = this.deps;
    if (success) await db.user.update({ where: { id: userId }, data: { lastAcpAuthAt: now, lastAcpAuthIp: ip } });
    await writeAudit(db, {
      actorId: userId,
      action: success ? "acp.login" : "acp.login_failed",
      targetType: "user",
      targetId: userId,
      ip,
    });
  }

  async failedAcpLogins(limit: number): Promise<{ userName: string | null; ip: string | null; at: Date }[]> {
    const rows = await this.deps.db.auditLog.findMany({
      where: { action: "acp.login_failed" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
    const users = await this.deps.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ userName: r.actorId ? (names.get(r.actorId) ?? null) : null, ip: r.ip, at: r.createdAt }));
  }

  async onlineCount(now = new Date()): Promise<number> {
    return this.deps.db.user.count({ where: { lastActiveAt: { gte: new Date(now.getTime() - ONLINE_MINUTES * 60_000) } } });
  }

  /** Adminii activi recent: userii din grupurile cu `acp.access` (principal sau secundar). */
  async onlineAdmins(now = new Date()): Promise<{ id: string; name: string; groupKey: string }[]> {
    const { db } = this.deps;
    const acpGroups = await db.group.findMany({
      where: { OR: [{ key: "root_admin" }, { settings: { some: { key: "acp.access", value: { equals: true } } } }] },
      select: { id: true },
    });
    const groupIds = acpGroups.map((g) => g.id);
    const users = await db.user.findMany({
      where: {
        lastActiveAt: { gte: new Date(now.getTime() - ONLINE_MINUTES * 60_000) },
        OR: [{ primaryGroupId: { in: groupIds } }, { groups: { some: { groupId: { in: groupIds } } } }],
      },
      select: { id: true, name: true, primaryGroup: { select: { key: true } } },
      orderBy: { lastActiveAt: "desc" },
      take: 20,
    });
    return users.map((u) => ({ id: u.id, name: u.name, groupKey: u.primaryGroup.key }));
  }
}
