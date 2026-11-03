import { writeAudit, type GcsAcpRoleService, type GcsActor, type GcsSettingDef, type GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { toRef, userRefSelect, type GcsUserRef } from "../forums/queries";

/** Rapoartele zonei Statistici (ACP › Statistici); cheia = ultimul segment al adresei `/admin/stats/<cheie>`. */
export const GCS_STATS_REPORTS = ["registrations", "members", "content", "online", "clans", "servers", "vip"] as const;
export type GcsStatsReportKey = (typeof GCS_STATS_REPORTS)[number];
/** Aplicația de care depinde un raport (oprită → raportul nu există). */
export const STATS_REPORT_APP: Partial<Record<GcsStatsReportKey, string>> = { clans: "clans", servers: "servers", vip: "vip" };
export const statsReportSection = (key: GcsStatsReportKey) => `stats.${key}`;

export const STATS_SETTING = "stats.config";
export type GcsStatsConfig = {
  /** Staff-ul (admini și moderatori) nu se numără în rapoartele de activitate. */
  excludeStaff: boolean;
  /** Prima zi a săptămânii la gruparea pe săptămâni. */
  weekStart: "monday" | "sunday";
  /** Perioada implicită a rapoartelor (zile). */
  defaultDays: 7 | 30 | 90 | 365;
};
export const DEFAULT_STATS: GcsStatsConfig = { excludeStaff: false, weekStart: "monday", defaultDays: 30 };
export function statsConfigError(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "invalid";
  const c = v as Partial<GcsStatsConfig>;
  if (typeof c.excludeStaff !== "boolean" || (c.weekStart !== "monday" && c.weekStart !== "sunday") || ![7, 30, 90, 365].includes(c.defaultDays as number)) return "invalid";
  return null;
}
export const statsSetting: GcsSettingDef = { key: STATS_SETTING, type: "json", default: DEFAULT_STATS, section: "stats", labelKey: "settings.stats.config", validate: statsConfigError };

export type GcsStatsGroup = "day" | "week" | "month";
/** Cum se adună punctele unei serii într-un interval: numărate, însumate, valoarea maximă sau membri distincți. */
type GcsAgg = "count" | "sum" | "max" | "distinct";
export type GcsStatsUnit = "count" | "hours" | "money";
type SeriesDef = { key: string; agg: GcsAgg; unit: GcsStatsUnit };
/** Un punct: momentul, seria, valoarea (pentru `sum` / `max`) și id-ul (pentru `distinct`). */
type Point = { s: number; at: Date; n?: number; id?: string };

export type GcsStatsTopRow = { label: string; value: number; user?: GcsUserRef | null; href?: string };
export type GcsStatsTop = { key: string; unit: GcsStatsUnit; rows: GcsStatsTopRow[] };
export type GcsStatsTile = { key: string; value: number; unit: GcsStatsUnit };

export type GcsStatsResult = {
  report: GcsStatsReportKey;
  from: string;
  to: string;
  group: GcsStatsGroup;
  series: { key: string; unit: GcsStatsUnit; total: number; previous: number }[];
  buckets: { key: string; values: number[] }[];
  tiles: GcsStatsTile[];
  tops: GcsStatsTop[];
};

const STAFF_KEYS = ["root_admin", "admin", "super_moderator", "moderator"];
const DAY_MS = 86_400_000;

type Ctx = { db: PrismaClient; from: Date; to: Date; staff: Set<string> | null; settings: Pick<GcsSettingsService, "get"> };
type ReportDef = {
  series: SeriesDef[];
  points: (c: Ctx) => Promise<Point[]>;
  extra?: (c: Ctx) => Promise<{ tiles?: GcsStatsTile[]; tops?: GcsStatsTop[] }>;
};

const notStaff = (c: Ctx, id: string | null | undefined) => !!id && !(c.staff?.has(id) ?? false);

/** Membrii cu numele lor (pentru topuri), în ordinea primită. */
async function userRows(db: PrismaClient, rows: { id: string; value: number }[]): Promise<GcsStatsTopRow[]> {
  const users = rows.length > 0 ? await db.user.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: userRefSelect }) : [];
  const refs = new Map(users.map((u) => [u.id, toRef(u)] as const));
  return rows.map((r) => ({ label: refs.get(r.id)?.name ?? "—", value: r.value, user: refs.get(r.id) ?? null }));
}
const topOf = (counts: Map<string, number>, n = 10) =>
  [...counts]
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

const REPORTS: Record<GcsStatsReportKey, ReportDef> = {
  registrations: {
    series: [{ key: "registrations", agg: "count", unit: "count" }],
    points: async ({ db, from, to }) => (await db.user.findMany({ where: { createdAt: { gte: from, lt: to }, isBot: false }, select: { createdAt: true } })).map((u) => ({ s: 0, at: u.createdAt })),
    extra: async ({ db, from, to }) => {
      const [total, accounts] = await Promise.all([
        db.user.count({ where: { isBot: false } }),
        db.account.findMany({ where: { user: { createdAt: { gte: from, lt: to }, isBot: false } }, select: { providerId: true, userId: true } }),
      ]);
      const by = new Map<string, number>();
      for (const a of accounts) bump(by, a.providerId);
      return { tiles: [{ key: "members", value: total, unit: "count" }], tops: [{ key: "methods", unit: "count", rows: topOf(by).map((r) => ({ label: r.id, value: r.value })) }] };
    },
  },
  members: {
    series: [
      { key: "posters", agg: "distinct", unit: "count" },
      { key: "online", agg: "distinct", unit: "count" },
    ],
    points: async (c) => {
      const { db, from, to } = c;
      const [posts, online] = await Promise.all([
        db.post.findMany({ where: { createdAt: { gte: from, lt: to }, visibility: "VISIBLE" }, select: { createdAt: true, authorId: true } }),
        db.memberOnlineDay.findMany({ where: { day: { gte: dayKey(from), lte: dayKey(new Date(to.getTime() - 1)) } }, select: { day: true, userId: true } }),
      ]);
      return [
        ...posts.filter((p) => notStaff(c, p.authorId)).map((p) => ({ s: 0, at: p.createdAt, id: p.authorId! })),
        ...online.filter((o) => notStaff(c, o.userId)).map((o) => ({ s: 1, at: new Date(`${o.day}T12:00:00Z`), id: o.userId })),
      ];
    },
    extra: async (c) => {
      const { db, from, to } = c;
      const now = to.getTime();
      const [total, active30, inactive90, posts] = await Promise.all([
        db.user.count({ where: { isBot: false } }),
        db.user.count({ where: { isBot: false, lastActiveAt: { gte: new Date(now - 30 * DAY_MS) } } }),
        db.user.count({ where: { isBot: false, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: new Date(now - 90 * DAY_MS) } }] } }),
        db.post.findMany({ where: { createdAt: { gte: from, lt: to }, visibility: "VISIBLE" }, select: { authorId: true } }),
      ]);
      const by = new Map<string, number>();
      for (const p of posts) if (notStaff(c, p.authorId)) bump(by, p.authorId!);
      return {
        tiles: [
          { key: "members", value: total, unit: "count" },
          { key: "active30", value: active30, unit: "count" },
          { key: "inactive90", value: inactive90, unit: "count" },
        ],
        tops: [{ key: "posters", unit: "count", rows: await userRows(db, topOf(by)) }],
      };
    },
  },
  content: {
    series: [
      { key: "topics", agg: "count", unit: "count" },
      { key: "posts", agg: "count", unit: "count" },
      { key: "reactions", agg: "count", unit: "count" },
    ],
    points: async (c) => {
      const { db, from, to } = c;
      const [topics, posts, reactions] = await Promise.all([
        db.topic.findMany({ where: { createdAt: { gte: from, lt: to }, visibility: "VISIBLE" }, select: { createdAt: true } }),
        db.post.findMany({ where: { createdAt: { gte: from, lt: to }, visibility: "VISIBLE" }, select: { createdAt: true, authorId: true } }),
        db.contentReaction.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { createdAt: true, userId: true } }),
      ]);
      return [
        ...topics.map((t) => ({ s: 0, at: t.createdAt })),
        ...posts.filter((p) => c.staff === null || notStaff(c, p.authorId)).map((p) => ({ s: 1, at: p.createdAt })),
        ...reactions.filter((r) => c.staff === null || notStaff(c, r.userId)).map((r) => ({ s: 2, at: r.createdAt })),
      ];
    },
    extra: async ({ db, from, to }) => {
      const posts = await db.post.findMany({ where: { createdAt: { gte: from, lt: to }, visibility: "VISIBLE" }, select: { topic: { select: { forumId: true, id: true, title: true } } } });
      const forums = new Map<string, number>();
      const topics = new Map<string, number>();
      const titles = new Map<string, string>();
      for (const p of posts) {
        bump(forums, String(p.topic.forumId));
        bump(topics, String(p.topic.id));
        titles.set(String(p.topic.id), p.topic.title);
      }
      const topForums = topOf(forums);
      const names = topForums.length > 0 ? await db.forum.findMany({ where: { id: { in: topForums.map((f) => Number(f.id)) } }, select: { id: true, name: true } }) : [];
      const forumName = new Map(names.map((f) => [String(f.id), f.name] as const));
      return {
        tops: [
          { key: "forums", unit: "count", rows: topForums.map((f) => ({ label: forumName.get(f.id) ?? `#${f.id}`, value: f.value, href: `/forum/${f.id}` })) },
          { key: "topics", unit: "count", rows: topOf(topics).map((t) => ({ label: titles.get(t.id) ?? `#${t.id}`, value: t.value, href: `/topic/${t.id}` })) },
        ],
      };
    },
  },
  online: {
    series: [
      { key: "members", agg: "distinct", unit: "count" },
      { key: "hours", agg: "sum", unit: "hours" },
    ],
    points: async (c) => {
      const rows = await c.db.memberOnlineDay.findMany({ where: { day: { gte: dayKey(c.from), lte: dayKey(new Date(c.to.getTime() - 1)) } }, select: { day: true, userId: true, seconds: true } });
      return rows
        .filter((r) => c.staff === null || notStaff(c, r.userId))
        .flatMap((r) => {
          const at = new Date(`${r.day}T12:00:00Z`);
          return [
            { s: 0, at, id: r.userId },
            { s: 1, at, n: r.seconds / 3600 },
          ];
        });
    },
    extra: async (c) => {
      const rows = await c.db.memberOnlineDay.findMany({ where: { day: { gte: dayKey(c.from), lte: dayKey(new Date(c.to.getTime() - 1)) } }, select: { userId: true, seconds: true } });
      const by = new Map<string, number>();
      for (const r of rows) if (c.staff === null || notStaff(c, r.userId)) bump(by, r.userId, r.seconds / 3600);
      const record = await c.db.setting.findUnique({ where: { key: "presence.record" } });
      const count = Number((record?.value as { count?: unknown } | null)?.count ?? 0);
      return {
        tiles: [{ key: "record", value: Number.isFinite(count) ? count : 0, unit: "count" }],
        tops: [{ key: "online", unit: "hours", rows: await userRows(c.db, topOf(by).map((r) => ({ id: r.id, value: Math.round(r.value * 10) / 10 }))) }],
      };
    },
  },
  clans: {
    series: [
      { key: "clans", agg: "count", unit: "count" },
      { key: "joins", agg: "count", unit: "count" },
    ],
    points: async ({ db, from, to }) => {
      const [clans, joins] = await Promise.all([
        db.clan.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { createdAt: true } }),
        db.clanMember.findMany({ where: { joinedAt: { gte: from, lt: to } }, select: { joinedAt: true } }),
      ]);
      return [...clans.map((c) => ({ s: 0, at: c.createdAt })), ...joins.map((j) => ({ s: 1, at: j.joinedAt }))];
    },
    extra: async ({ db }) => {
      const [total, groups] = await Promise.all([db.clan.count({ where: { status: "ACTIVE" } }), db.clanMember.groupBy({ by: ["clanId"], _count: { _all: true }, orderBy: { _count: { clanId: "desc" } }, take: 10 })]);
      const clans = groups.length > 0 ? await db.clan.findMany({ where: { id: { in: groups.map((g) => g.clanId) } }, select: { id: true, name: true, tag: true } }) : [];
      const byId = new Map(clans.map((c) => [c.id, c] as const));
      return {
        tiles: [{ key: "clans", value: total, unit: "count" }],
        tops: [{ key: "clans", unit: "count", rows: groups.map((g) => ({ label: byId.get(g.clanId) ? `[${byId.get(g.clanId)!.tag}] ${byId.get(g.clanId)!.name}` : `#${g.clanId}`, value: g._count._all, href: `/admin/gaming/clans/${g.clanId}` })) }],
      };
    },
  },
  servers: {
    series: [
      { key: "players", agg: "max", unit: "count" },
      { key: "matches", agg: "count", unit: "count" },
    ],
    points: async ({ db, from, to }) => {
      const [snaps, matches] = await Promise.all([
        db.serverSnapshot.findMany({ where: { at: { gte: from, lt: to }, hourly: true }, select: { at: true, peak: true } }),
        db.gameMatch.findMany({ where: { startedAt: { gte: from, lt: to } }, select: { startedAt: true } }),
      ]);
      // Jucătorii de pe toate serverele în aceeași oră, apoi maximul pe interval.
      const hours = new Map<number, number>();
      for (const s of snaps) {
        const h = Math.floor(s.at.getTime() / 3_600_000);
        hours.set(h, (hours.get(h) ?? 0) + s.peak);
      }
      return [...[...hours].map(([h, n]) => ({ s: 0, at: new Date(h * 3_600_000), n })), ...matches.map((m) => ({ s: 1, at: m.startedAt }))];
    },
    extra: async ({ db, from, to }) => {
      const snaps = await db.serverSnapshot.findMany({ where: { at: { gte: from, lt: to }, hourly: true }, select: { serverId: true, peak: true, map: true } });
      const peak = new Map<string, number>();
      const maps = new Map<string, number>();
      for (const s of snaps) {
        peak.set(String(s.serverId), Math.max(peak.get(String(s.serverId)) ?? 0, s.peak));
        if (s.map) bump(maps, s.map);
      }
      const top = topOf(peak);
      const servers = top.length > 0 ? await db.gameServer.findMany({ where: { id: { in: top.map((t) => Number(t.id)) } }, select: { id: true, name: true } }) : [];
      const name = new Map(servers.map((s) => [String(s.id), s.name] as const));
      return {
        tiles: [{ key: "servers", value: await db.gameServer.count({ where: { enabled: true } }), unit: "count" }],
        tops: [
          { key: "servers", unit: "count", rows: top.map((t) => ({ label: name.get(t.id) ?? `#${t.id}`, value: t.value, href: `/admin/gaming/servers/${t.id}` })) },
          { key: "maps", unit: "count", rows: topOf(maps).map((m) => ({ label: m.id, value: m.value })) },
        ],
      };
    },
  },
  vip: {
    series: [
      { key: "subscriptions", agg: "count", unit: "count" },
      { key: "donations", agg: "sum", unit: "money" },
    ],
    points: async ({ db, from, to }) => {
      const [subs, donations] = await Promise.all([
        db.vipSubscription.findMany({ where: { startsAt: { gte: from, lt: to } }, select: { startsAt: true } }),
        db.memberDonation.findMany({ where: { donatedAt: { gte: from, lt: to }, status: "CONFIRMED" }, select: { donatedAt: true, amount: true } }),
      ]);
      return [...subs.map((s) => ({ s: 0, at: s.startsAt })), ...donations.map((d) => ({ s: 1, at: d.donatedAt, n: d.amount / 100 }))];
    },
    extra: async ({ db, from, to }) => {
      const now = to.getTime();
      const [active, expiring, donors] = await Promise.all([
        db.vipSubscription.count({ where: { status: "ACTIVE" } }),
        db.vipSubscription.count({ where: { status: "ACTIVE", expiresAt: { gte: new Date(now), lt: new Date(now + 7 * DAY_MS) } } }),
        db.memberDonation.findMany({ where: { donatedAt: { gte: from, lt: to }, status: "CONFIRMED", userId: { not: null }, anonymous: false }, select: { userId: true, amount: true } }),
      ]);
      const by = new Map<string, number>();
      for (const d of donors) bump(by, d.userId!, d.amount / 100);
      return {
        tiles: [
          { key: "active", value: active, unit: "count" },
          { key: "expiring", value: expiring, unit: "count" },
        ],
        tops: [{ key: "donors", unit: "money", rows: await userRows(db, topOf(by)) }],
      };
    },
  },
};

/** Cheia unei zile (`YYYY-MM-DD`) în fusul dat. */
function dayKey(d: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Cheia intervalului unui moment: ziua, luni / duminica săptămânii sau prima zi a lunii (în fusul site-ului). */
export function bucketKey(at: Date, group: GcsStatsGroup, timeZone: string, weekStart: "monday" | "sunday" = "monday"): string {
  const day = dayKey(at, timeZone);
  if (group === "day") return day;
  if (group === "month") return `${day.slice(0, 7)}-01`;
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay();
  const back = weekStart === "monday" ? (dow + 6) % 7 : dow;
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** Toate cheile intervalelor dintre două momente (inclusiv), în ordine. */
export function bucketKeys(from: Date, to: Date, group: GcsStatsGroup, timeZone: string, weekStart: "monday" | "sunday" = "monday"): string[] {
  const keys: string[] = [];
  const last = bucketKey(new Date(to.getTime() - 1), group, timeZone, weekStart);
  for (let t = from.getTime(); ; t += DAY_MS) {
    const k = bucketKey(new Date(t), group, timeZone, weekStart);
    if (keys[keys.length - 1] !== k) keys.push(k);
    if (k === last || t > to.getTime()) break;
  }
  return keys;
}

/** Adună punctele pe intervale, după felul fiecărei serii. */
export function aggregate(points: Point[], series: SeriesDef[], keys: string[], key: (at: Date) => string): number[][] {
  const idx = new Map(keys.map((k, i) => [k, i] as const));
  const values = keys.map(() => series.map(() => 0));
  const distinct = keys.map(() => series.map(() => new Set<string>()));
  for (const p of points) {
    const i = idx.get(key(p.at));
    if (i === undefined) continue;
    const def = series[p.s]!;
    const row = values[i]!;
    if (def.agg === "count") row[p.s]! += 1;
    else if (def.agg === "sum") row[p.s]! += p.n ?? 0;
    else if (def.agg === "max") row[p.s] = Math.max(row[p.s]!, p.n ?? 0);
    else if (p.id) distinct[i]![p.s]!.add(p.id);
  }
  series.forEach((def, s) => {
    if (def.agg === "distinct") keys.forEach((_, i) => (values[i]![s] = distinct[i]![s]!.size));
  });
  return values.map((row) => row.map((v) => Math.round(v * 10) / 10));
}

/** Totalul unei serii pe toată perioada (`distinct` = membri distincți pe toată perioada, nu suma zilelor). */
function totalOf(points: Point[], s: number, def: SeriesDef): number {
  const mine = points.filter((p) => p.s === s);
  if (def.agg === "count") return mine.length;
  if (def.agg === "sum") return Math.round(mine.reduce((n, p) => n + (p.n ?? 0), 0) * 10) / 10;
  if (def.agg === "max") return mine.reduce((n, p) => Math.max(n, p.n ?? 0), 0);
  return new Set(mine.map((p) => p.id)).size;
}

/**
 * Rapoartele ACP › Statistici: seriile pe intervale (zi / săptămână / lună, în fusul site-ului) pentru perioada aleasă,
 * totalul fiecărei serii comparat cu perioada anterioară de aceeași lungime, plăcile și topurile raportului. Datele se
 * numără în aplicație (nu cu funcțiile de dată ale bazei), deci merg la fel pe PostgreSQL și MySQL.
 */
export class GcsStatsReportService {
  constructor(private readonly deps: { db: PrismaClient; acp: Pick<GcsAcpRoleService, "assert">; settings: Pick<GcsSettingsService, "get" | "set"> }) {}

  async config(): Promise<GcsStatsConfig> {
    const v = await this.deps.settings.get<GcsStatsConfig | null>(STATS_SETTING).catch(() => null);
    return v && statsConfigError(v) === null ? v : DEFAULT_STATS;
  }

  async saveConfig(actor: GcsActor, value: GcsStatsConfig): Promise<void> {
    await this.deps.acp.assert(actor, "stats.overview", "edit");
    await this.deps.settings.set(STATS_SETTING, value, actor);
    await writeAudit(this.deps.db, { actorId: actor.userId, action: "stats.config", targetType: "setting", targetId: STATS_SETTING, after: value, ip: actor.ip });
  }

  private async staff(): Promise<Set<string>> {
    const rows = await this.deps.db.user.findMany({ where: { OR: [{ primaryGroup: { key: { in: STAFF_KEYS } } }, { groups: { some: { group: { key: { in: STAFF_KEYS } } } } }] }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  async run(actor: GcsActor, report: GcsStatsReportKey, q: { from: Date; to: Date; group: GcsStatsGroup; timeZone: string }): Promise<GcsStatsResult> {
    await this.deps.acp.assert(actor, statsReportSection(report), "view");
    const def = REPORTS[report];
    const cfg = await this.config();
    const staff = cfg.excludeStaff ? await this.staff() : null;
    const length = q.to.getTime() - q.from.getTime();
    const ctx: Ctx = { db: this.deps.db, from: q.from, to: q.to, staff, settings: this.deps.settings };
    const prev: Ctx = { ...ctx, from: new Date(q.from.getTime() - length), to: q.from };
    const [points, before, extra] = await Promise.all([def.points(ctx), def.points(prev), def.extra?.(ctx) ?? Promise.resolve({})]);
    const keys = bucketKeys(q.from, q.to, q.group, q.timeZone, cfg.weekStart);
    const values = aggregate(points, def.series, keys, (at) => bucketKey(at, q.group, q.timeZone, cfg.weekStart));
    return {
      report,
      from: dayKey(q.from, q.timeZone),
      to: dayKey(new Date(q.to.getTime() - 1), q.timeZone),
      group: q.group,
      series: def.series.map((s, i) => ({ key: s.key, unit: s.unit, total: totalOf(points, i, s), previous: totalOf(before, i, s) })),
      buckets: keys.map((key, i) => ({ key, values: values[i]! })),
      tiles: extra.tiles ?? [],
      tops: extra.tops ?? [],
    };
  }

  /** CSV-ul raportului (intervalul și valorile seriilor). */
  static csv(r: GcsStatsResult): string {
    const head = ["period", ...r.series.map((s) => s.key)].join(",");
    return [head, ...r.buckets.map((b) => [b.key, ...b.values].join(","))].join("\n") + "\n";
  }
}
