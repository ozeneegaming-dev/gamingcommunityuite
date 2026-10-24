import { type Prisma, type PrismaClient, isMysql, sql } from "@gcs/db";
import { writeAudit } from "../audit";
import type { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import type { GcsAcpRoleService } from "./roles";
import type { GcsPresenceService } from "../presence/presence";

/**
 * Widgeturile dashboard-ului ACP (spec §12.2): cele din etapa 1, coada de moderare (etapa 2), expirările VIP (etapa 3)
 * și listele rapide din etapa 6 (ultimii membri, conținutul în așteptare, rapoartele deschise, jurnalul ACP).
 */
export const ACP_WIDGETS = [
  "registrations",
  "vip_expiring",
  "moderation_queue",
  "system_health",
  "admin_notes",
  "online_users",
  "online_admins",
  "failed_acp_logins",
  "latest_members",
  "pending_content",
  "open_reports",
  "acp_log",
] as const;
export type GcsAcpWidget = (typeof ACP_WIDGETS)[number];

/** Layout-ul salvat pe admin: două coloane de widgeturi, widgeturile pliate și ordinea aplicațiilor. */
export type GcsAcpLayout = {
  main: GcsAcpWidget[];
  side: GcsAcpWidget[];
  collapsed: GcsAcpWidget[];
  appOrder: string[];
};

/** Seriile zilnice ale dashboard-ului (aceeași ordine ca `days`). */
export type GcsAcpOverviewSeries = {
  registrations: number[];
  posts: number[];
  topics: number[];
  reports: number[];
  vips: number[];
  /** Membrii activi pe zi: autorii distincți ai postărilor din ziua respectivă. */
  active: number[];
};

/**
 * Rezumatul dashboard-ului ACP (etapa 6 §1.2), cache-uit ~60 s: totalurile, seriile pe ultimele 2 × 30 de zile
 * (perioada curentă și cea anterioară, pentru variații), ultimii membri și jurnalul ACP recent. Datele sunt simple
 * (JSON), ca să treacă prin cache fără pierderi.
 */
export type GcsAcpOverview = {
  generatedAt: string;
  /** Zilele perioadei curente (`YYYY-MM-DD`, în fusul orar al site-ului), cea mai veche prima. */
  days: string[];
  /** Valorile pe zi pentru `days`. */
  series: GcsAcpOverviewSeries;
  /** Sumele perioadei curente și ale celei anterioare, pe fiecare serie. */
  periods: Record<keyof GcsAcpOverviewSeries, { current: number; previous: number }>;
  totals: { members: number; posts: number; topics: number; vips: number; openReports: number; reports: number; active30: number };
  latestMembers: { id: string; name: string; image: string | null; groupKey: string; groupName: string; createdAt: string }[];
  audit: { id: string; action: string; actorId: string | null; actorName: string | null; targetType: string; targetId: string; createdAt: string }[];
};

const SERIES = ["registrations", "posts", "topics", "reports", "vips", "active"] as const;

export const DEFAULT_ACP_LAYOUT: GcsAcpLayout = {
  main: ["registrations", "latest_members", "pending_content", "open_reports", "acp_log", "system_health", "vip_expiring"],
  side: ["moderation_queue", "admin_notes", "online_users", "online_admins", "failed_acp_logins"],
  collapsed: [],
  appOrder: [],
};

const ACP_APPS = new Set(["system", "community", "members", "vip", "gaming", "pages", "stats", "appearance"]);
const ONLINE_MINUTES = 15;
/** Fereastra graficelor din dashboard (zile) și cât stă rezumatul în cache (secunde). */
export const ACP_OVERVIEW_DAYS = 30;
const OVERVIEW_TTL = 60;
const OVERVIEW_TAG = "acp-dashboard";
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
  constructor(
    private readonly deps: { db: PrismaClient; acp: GcsAcpRoleService; presence?: Pick<GcsPresenceService, "online">; cache?: GcsCache },
  ) {}

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

  /**
   * Rezumatul dashboard-ului: un număr constant de interogări (seriile grupate pe zi cu `date_trunc`, totalurile,
   * ultimii membri, jurnalul ACP), cache-uit 60 s în Redis. Fără Redis, se calculează direct.
   */
  async overview(now = new Date(), timeZone = "Europe/Bucharest"): Promise<GcsAcpOverview> {
    const key = `acp:dashboard:overview:${timeZone}`;
    const { cache } = this.deps;
    const cached = cache ? await cache.get<GcsAcpOverview>(key).catch(() => null) : null;
    if (cached) return cached;
    const fresh = await this.computeOverview(now, timeZone);
    if (cache) await cache.set(key, fresh, { ttlSec: OVERVIEW_TTL, tags: [OVERVIEW_TAG] }).catch(() => undefined);
    return fresh;
  }

  /**
   * Seriile pe zile fără funcțiile de dată ale PostgreSQL (MySQL pe shared hosting nu are de obicei tabelele de fusuri
   * orare): momentele se aduc și se numără în aplicație, în fusul site-ului.
   */
  private async portableSeries(since: Date, timeZone: string): Promise<{ s: string; d: string; n: number }[]> {
    const { db } = this.deps;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const [users, posts, topics, reports, vips] = await Promise.all([
      db.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      db.post.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, visibility: true, authorId: true } }),
      db.topic.findMany({ where: { createdAt: { gte: since }, visibility: "VISIBLE" }, select: { createdAt: true } }),
      db.report.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      db.vipSubscription.findMany({ where: { startsAt: { gte: since } }, select: { startsAt: true } }),
    ]);
    const counts = new Map<string, number>();
    const add = (s: string, at: Date) => {
      const k = `${s}:${day.format(at)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (const u of users) add("registrations", u.createdAt);
    for (const p of posts) if (p.visibility === "VISIBLE") add("posts", p.createdAt);
    const active = new Set<string>();
    for (const p of posts) if (p.authorId) active.add(`${day.format(p.createdAt)}|${p.authorId}`);
    for (const a of active) add("active", new Date(`${a.slice(0, 10)}T12:00:00Z`));
    for (const t of topics) add("topics", t.createdAt);
    for (const r of reports) add("reports", r.createdAt);
    for (const v of vips) add("vips", v.startsAt);
    return [...counts].map(([k, n]) => ({ s: k.slice(0, k.indexOf(":")), d: k.slice(k.indexOf(":") + 1), n }));
  }

  private async portableTotals(since30: Date): Promise<GcsAcpOverview["totals"][]> {
    const { db } = this.deps;
    const [members, posts, topics, vips, openReports, reports, active30] = await Promise.all([
      db.user.count(),
      db.post.count({ where: { visibility: "VISIBLE" } }),
      db.topic.count({ where: { visibility: "VISIBLE" } }),
      db.vipSubscription.count({ where: { status: "ACTIVE" } }),
      db.report.count({ where: { status: "OPEN" } }),
      db.report.count(),
      db.user.count({ where: { lastActiveAt: { gte: since30 } } }),
    ]);
    return [{ members, posts, topics, vips, openReports, reports, active30 }];
  }

  private async computeOverview(now: Date, timeZone: string): Promise<GcsAcpOverview> {
    const { db } = this.deps;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    // Două perioade de câte 30 de zile (inclusiv azi): cea curentă se afișează, cea anterioară dă variația.
    const keys: string[] = [];
    for (let i = ACP_OVERVIEW_DAYS * 2 - 1; i >= 0; i--) keys.push(day.format(new Date(now.getTime() - i * 86_400_000)));
    const since = new Date(now.getTime() - (ACP_OVERVIEW_DAYS * 2 + 1) * 86_400_000);
    const since30 = new Date(now.getTime() - ACP_OVERVIEW_DAYS * 86_400_000);

    const [rows, [totals], latest, audit] = await Promise.all([
      isMysql() ? this.portableSeries(since, timeZone) : db.$queryRaw<{ s: string; d: string; n: number }[]>(sql`
        SELECT 'registrations'::text AS s, to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD') AS d, count(*)::int AS n
          FROM users WHERE "createdAt" >= ${since} GROUP BY 2
        UNION ALL
        SELECT 'posts'::text, to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD'), count(*)::int
          FROM posts WHERE "createdAt" >= ${since} AND visibility = 'VISIBLE' GROUP BY 2
        UNION ALL
        SELECT 'active'::text, to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD'), count(DISTINCT "authorId")::int
          FROM posts WHERE "createdAt" >= ${since} AND "authorId" IS NOT NULL GROUP BY 2
        UNION ALL
        SELECT 'topics'::text, to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD'), count(*)::int
          FROM topics WHERE "createdAt" >= ${since} AND visibility = 'VISIBLE' GROUP BY 2
        UNION ALL
        SELECT 'reports'::text, to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD'), count(*)::int
          FROM reports WHERE "createdAt" >= ${since} GROUP BY 2
        UNION ALL
        SELECT 'vips'::text, to_char(date_trunc('day', ("startsAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD'), count(*)::int
          FROM vip_subscriptions WHERE "startsAt" >= ${since} GROUP BY 2`),
      isMysql() ? this.portableTotals(since30) : db.$queryRaw<GcsAcpOverview["totals"][]>(sql`
        SELECT (SELECT count(*) FROM users)::int AS members,
               (SELECT count(*) FROM posts WHERE visibility = 'VISIBLE')::int AS posts,
               (SELECT count(*) FROM topics WHERE visibility = 'VISIBLE')::int AS topics,
               (SELECT count(*) FROM vip_subscriptions WHERE status = 'ACTIVE')::int AS vips,
               (SELECT count(*) FROM reports WHERE status = 'OPEN')::int AS "openReports",
               (SELECT count(*) FROM reports)::int AS reports,
               (SELECT count(*) FROM users WHERE "lastActiveAt" >= ${since30})::int AS active30`),
      db.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, name: true, image: true, createdAt: true, primaryGroup: { select: { key: true, name: true } } },
      }),
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ]);

    const counts = new Map<string, number>();
    for (const r of rows) counts.set(`${r.s}:${r.d}`, Number(r.n));
    const previousKeys = keys.slice(0, ACP_OVERVIEW_DAYS);
    const days = keys.slice(ACP_OVERVIEW_DAYS);
    const sum = (s: string, list: string[]) => list.reduce((acc, d) => acc + (counts.get(`${s}:${d}`) ?? 0), 0);
    const series = Object.fromEntries(SERIES.map((s) => [s, days.map((d) => counts.get(`${s}:${d}`) ?? 0)])) as GcsAcpOverviewSeries;
    const periods = Object.fromEntries(SERIES.map((s) => [s, { current: sum(s, days), previous: sum(s, previousKeys) }])) as GcsAcpOverview["periods"];

    const actorIds = [...new Set(audit.map((a) => a.actorId).filter((id): id is string => id !== null))];
    const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(actors.map((u) => [u.id, u.name]));

    return {
      generatedAt: now.toISOString(),
      days,
      series,
      periods,
      totals: totals ?? { members: 0, posts: 0, topics: 0, vips: 0, openReports: 0, reports: 0, active30: 0 },
      latestMembers: latest.map((u) => ({
        id: u.id,
        name: u.name,
        image: u.image,
        groupKey: u.primaryGroup.key,
        groupName: u.primaryGroup.name,
        createdAt: u.createdAt.toISOString(),
      })),
      audit: audit.map((a) => ({
        id: a.id,
        action: a.action,
        actorId: a.actorId,
        actorName: a.actorId ? (names.get(a.actorId) ?? null) : null,
        targetType: a.targetType,
        targetId: a.targetId,
        createdAt: a.createdAt.toISOString(),
      })),
    };
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

  /** Membrii online: din prezența Redis (etapa 4), altfel după `lastActiveAt`. */
  async onlineCount(now = new Date()): Promise<number> {
    if (this.deps.presence) {
      const online = await this.deps.presence.online(now.getTime()).catch(() => null);
      if (online) return online.users.length;
    }
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
