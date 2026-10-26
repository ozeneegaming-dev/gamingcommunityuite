import { isIP } from "node:net";
import { GcsValidationError, type GcsAcpRoleService, type GcsActor, type GcsBanService, type GcsEventBus, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";

/** ACP › Membri › Unelte IP: căutarea (`view`) și setarea de păstrare a IP-urilor (`edit`). */
export const IP_TOOLS_ACP_SECTION = "members.ip_tools";
/** După câte zile se șterg IP-urile din conținut, jurnale și conturi (0 = se păstrează). */
export const IP_RETENTION_SETTING = "members.ip_retention_days";

const LIST = 50;
const SHARED_DAYS = 30;

export type GcsIpSource = "registration" | "last" | "session" | "device" | "post" | "pm" | "status";
export type GcsIpAccount = { id: string; name: string; isSpammer: boolean; banned: boolean; sources: GcsIpSource[]; lastSeen: Date | null };
export type GcsIpLookup = {
  query: string;
  accounts: GcsIpAccount[];
  posts: { id: number; topicId: number; title: string; authorName: string | null; createdAt: Date }[];
  counts: { posts: number; pms: number; statuses: number; sessions: number };
  ban: { id: string; value: string; reason: string } | null;
};
export type GcsMemberIp = { ip: string; sources: GcsIpSource[]; lastSeen: Date | null; others: number };
export type GcsSharedIp = { ip: string; lastSeen: Date | null; users: { id: string; name: string; isSpammer: boolean; banned: boolean }[] };

/** Un IP exact sau un prefix cu `*` la final (`203.0.113.*`); filtrul Prisma pentru o coloană. */
function ipFilter(query: string): { equals: string } | { startsWith: string } {
  return query.endsWith("*") ? { startsWith: query.slice(0, -1) } : { equals: query };
}

const later = (a: Date | null, b: Date | null | undefined) => (b && (!a || b > a) ? b : a);

/**
 * Uneltele IP (spec anti-spam & moderare §3): căutarea după IP (conturi, postări, mesaje private, sesiuni), IP-urile
 * unui membru, IP-urile comune mai multor conturi (multi-conturi) cu alerta pentru staff la înregistrare și ștergerea
 * IP-urilor vechi (GDPR).
 */
export class GcsIpToolsService {
  constructor(
    private readonly deps: { db: PrismaClient; acp: GcsAcpRoleService; bans: GcsBanService; bus: GcsEventBus; settings: GcsSettingsService },
  ) {}

  private normalize(raw: string): string {
    const q = raw.trim().toLowerCase();
    const base = q.endsWith("*") ? q.slice(0, -1).replace(/[.:]$/, "") : q;
    const ok = q.endsWith("*") ? /^[0-9a-f.:]{2,45}$/.test(base) && base.length >= 3 : isIP(q) !== 0;
    if (!ok) throw new GcsValidationError({ ip: "invalid_ip" });
    return q.endsWith("*") ? `${q.slice(0, -1)}*` : q;
  }

  private async bannedSet(userIds: string[]): Promise<Set<string>> {
    const now = new Date();
    const rows = await this.deps.db.ban.findMany({
      where: { type: "ACCOUNT", userId: { in: userIds }, liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId!).filter(Boolean));
  }

  /** Căutarea după IP: conturile (de unde vine potrivirea), ultimele postări și numărul de mesaje / sesiuni. */
  async lookupIp(actor: GcsActor, raw: string): Promise<GcsIpLookup> {
    await this.deps.acp.assert(actor, IP_TOOLS_ACP_SECTION, "view");
    const { db } = this.deps;
    const query = this.normalize(raw);
    const f = ipFilter(query);
    const [registered, last, sessions, devices, postAuthors, pmAuthors, statusAuthors, posts, counts] = await Promise.all([
      db.user.findMany({ where: { registrationIp: f }, select: { id: true, createdAt: true }, take: 200 }),
      db.user.findMany({ where: { lastIp: f }, select: { id: true, lastActiveAt: true }, take: 200 }),
      db.session.findMany({ where: { ipAddress: f }, select: { userId: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
      db.userDevice.findMany({ where: { ip: f }, select: { userId: true, lastSeenAt: true }, take: 500 }),
      db.post.groupBy({ by: ["authorId"], where: { ip: f, authorId: { not: null } }, _max: { createdAt: true }, orderBy: { authorId: "asc" }, take: 200 }),
      db.conversationMessage.groupBy({ by: ["authorId"], where: { ip: f, authorId: { not: null } }, _max: { createdAt: true }, orderBy: { authorId: "asc" }, take: 200 }),
      db.statusUpdate.groupBy({ by: ["authorId"], where: { ip: f, authorId: { not: null } }, _max: { createdAt: true }, orderBy: { authorId: "asc" }, take: 200 }),
      db.post.findMany({
        where: { ip: f },
        orderBy: { id: "desc" },
        take: 20,
        select: { id: true, topicId: true, createdAt: true, topic: { select: { title: true } }, author: { select: { name: true } } },
      }),
      Promise.all([db.post.count({ where: { ip: f } }), db.conversationMessage.count({ where: { ip: f } }), db.statusUpdate.count({ where: { ip: f } }), db.session.count({ where: { ipAddress: f } })]),
    ]);
    const found = new Map<string, { sources: Set<GcsIpSource>; lastSeen: Date | null }>();
    const add = (id: string | null, source: GcsIpSource, at: Date | null | undefined) => {
      if (!id) return;
      const cur = found.get(id) ?? { sources: new Set<GcsIpSource>(), lastSeen: null };
      cur.sources.add(source);
      cur.lastSeen = later(cur.lastSeen, at);
      found.set(id, cur);
    };
    for (const u of registered) add(u.id, "registration", u.createdAt);
    for (const u of last) add(u.id, "last", u.lastActiveAt);
    for (const s of sessions) add(s.userId, "session", s.updatedAt);
    for (const d of devices) add(d.userId, "device", d.lastSeenAt);
    for (const p of postAuthors) add(p.authorId, "post", p._max.createdAt);
    for (const p of pmAuthors) add(p.authorId, "pm", p._max.createdAt);
    for (const p of statusAuthors) add(p.authorId, "status", p._max.createdAt);
    const ids = [...found.keys()];
    const [users, banned] = await Promise.all([db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isSpammer: true } }), this.bannedSet(ids)]);
    const accounts = users
      .map((u) => ({ id: u.id, name: u.name, isSpammer: u.isSpammer, banned: banned.has(u.id), sources: [...found.get(u.id)!.sources], lastSeen: found.get(u.id)!.lastSeen }))
      .sort((a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0))
      .slice(0, LIST);
    const exact = query.endsWith("*") ? null : await this.deps.bans.activeFor({ ip: query });
    return {
      query,
      accounts,
      posts: posts.map((p) => ({ id: p.id, topicId: p.topicId, title: p.topic.title, authorName: p.author?.name ?? null, createdAt: p.createdAt })),
      counts: { posts: counts[0], pms: counts[1], statuses: counts[2], sessions: counts[3] },
      ban: exact ? { id: exact.id, value: exact.value, reason: exact.reason } : null,
    };
  }

  /** IP-urile unui membru (de unde vin, când au fost văzute ultima dată, câte alte conturi le folosesc). */
  async memberIps(actor: GcsActor, userId: string): Promise<GcsMemberIp[]> {
    await this.deps.acp.assert(actor, IP_TOOLS_ACP_SECTION, "view");
    const { db } = this.deps;
    const [user, sessions, devices, posts, pms, statuses] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { registrationIp: true, createdAt: true, lastIp: true, lastActiveAt: true } }),
      db.session.findMany({ where: { userId, ipAddress: { not: null } }, select: { ipAddress: true, updatedAt: true }, take: 200 }),
      db.userDevice.findMany({ where: { userId, ip: { not: null } }, select: { ip: true, lastSeenAt: true }, take: 200 }),
      db.post.groupBy({ by: ["ip"], where: { authorId: userId, ip: { not: null } }, _max: { createdAt: true }, orderBy: { ip: "asc" }, take: 200 }),
      db.conversationMessage.groupBy({ by: ["ip"], where: { authorId: userId, ip: { not: null } }, _max: { createdAt: true }, orderBy: { ip: "asc" }, take: 200 }),
      db.statusUpdate.groupBy({ by: ["ip"], where: { authorId: userId, ip: { not: null } }, _max: { createdAt: true }, orderBy: { ip: "asc" }, take: 200 }),
    ]);
    const found = new Map<string, { sources: Set<GcsIpSource>; lastSeen: Date | null }>();
    const add = (ip: string | null | undefined, source: GcsIpSource, at: Date | null | undefined) => {
      if (!ip || ip === "0.0.0.0") return;
      const cur = found.get(ip) ?? { sources: new Set<GcsIpSource>(), lastSeen: null };
      cur.sources.add(source);
      cur.lastSeen = later(cur.lastSeen, at);
      found.set(ip, cur);
    };
    add(user?.registrationIp, "registration", user?.createdAt);
    add(user?.lastIp, "last", user?.lastActiveAt);
    for (const s of sessions) add(s.ipAddress, "session", s.updatedAt);
    for (const d of devices) add(d.ip, "device", d.lastSeenAt);
    for (const p of posts) add(p.ip, "post", p._max.createdAt);
    for (const p of pms) add(p.ip, "pm", p._max.createdAt);
    for (const p of statuses) add(p.ip, "status", p._max.createdAt);
    const ips = [...found.keys()].slice(0, 200);
    const others = await this.otherAccounts(ips, userId);
    return ips
      .map((ip) => ({ ip, sources: [...found.get(ip)!.sources], lastSeen: found.get(ip)!.lastSeen, others: others.get(ip)?.size ?? 0 }))
      .sort((a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0));
  }

  /** Pentru fiecare IP, celelalte conturi care l-au folosit (înregistrare, ultimul IP, dispozitive, sesiuni). */
  private async otherAccounts(ips: string[], exclude: string | null): Promise<Map<string, Set<string>>> {
    const { db } = this.deps;
    const out = new Map<string, Set<string>>();
    if (ips.length === 0) return out;
    const notMe = exclude ? { not: exclude } : undefined;
    const [reg, last, dev, ses] = await Promise.all([
      db.user.findMany({ where: { registrationIp: { in: ips }, ...(notMe ? { id: notMe } : {}), isBot: false }, select: { id: true, registrationIp: true }, take: 2000 }),
      db.user.findMany({ where: { lastIp: { in: ips }, ...(notMe ? { id: notMe } : {}), isBot: false }, select: { id: true, lastIp: true }, take: 2000 }),
      db.userDevice.findMany({ where: { ip: { in: ips }, ...(notMe ? { userId: notMe } : {}) }, select: { userId: true, ip: true }, take: 2000 }),
      db.session.findMany({ where: { ipAddress: { in: ips }, ...(notMe ? { userId: notMe } : {}) }, select: { userId: true, ipAddress: true }, take: 2000 }),
    ]);
    const add = (ip: string | null, id: string) => {
      if (!ip) return;
      const set = out.get(ip) ?? new Set<string>();
      set.add(id);
      out.set(ip, set);
    };
    for (const u of reg) add(u.registrationIp, u.id);
    for (const u of last) add(u.lastIp, u.id);
    for (const d of dev) add(d.ip, d.userId);
    for (const s of ses) add(s.ipAddress, s.userId);
    return out;
  }

  /** IP-urile folosite de mai multe conturi în ultimele `days` zile (cele cu un cont banat sau spammer, primele). */
  async sharedIps(actor: GcsActor, days = SHARED_DAYS, now = new Date()): Promise<GcsSharedIp[]> {
    await this.deps.acp.assert(actor, IP_TOOLS_ACP_SECTION, "view");
    const { db } = this.deps;
    const since = new Date(now.getTime() - days * 86_400_000);
    const [devices, registered] = await Promise.all([
      db.userDevice.findMany({ where: { ip: { not: null }, lastSeenAt: { gte: since } }, select: { userId: true, ip: true, lastSeenAt: true }, take: 20_000 }),
      db.user.findMany({ where: { registrationIp: { not: null }, createdAt: { gte: since }, isBot: false }, select: { id: true, registrationIp: true, createdAt: true }, take: 20_000 }),
    ]);
    const byIp = new Map<string, { users: Set<string>; lastSeen: Date | null }>();
    const add = (ip: string | null, id: string, at: Date) => {
      if (!ip || ip === "0.0.0.0" || ip === "127.0.0.1" || ip === "::1") return;
      const cur = byIp.get(ip) ?? { users: new Set<string>(), lastSeen: null };
      cur.users.add(id);
      cur.lastSeen = later(cur.lastSeen, at);
      byIp.set(ip, cur);
    };
    for (const d of devices) add(d.ip, d.userId, d.lastSeenAt);
    for (const u of registered) add(u.registrationIp, u.id, u.createdAt);
    const shared = [...byIp.entries()].filter(([, v]) => v.users.size > 1);
    const ids = [...new Set(shared.flatMap(([, v]) => [...v.users]))];
    const [users, banned] = await Promise.all([db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isSpammer: true } }), this.bannedSet(ids)]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return shared
      .map(([ip, v]) => ({
        ip,
        lastSeen: v.lastSeen,
        users: [...v.users].map((id) => byId.get(id)).filter((u): u is NonNullable<typeof u> => !!u).map((u) => ({ id: u.id, name: u.name, isSpammer: u.isSpammer, banned: banned.has(u.id) })),
      }))
      .filter((s) => s.users.length > 1)
      .sort((a, b) => Number(b.users.some((u) => u.banned || u.isSpammer)) - Number(a.users.some((u) => u.banned || u.isSpammer)) || (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0))
      .slice(0, LIST);
  }

  /**
   * Alerta de multi-cont: un cont nou cu IP-ul altor conturi (înregistrare, ultimul IP, dispozitive) emite
   * `antispam.multi_account` (notificarea staff-ului), cu conturile găsite.
   */
  async checkNewAccount(userId: string): Promise<string[]> {
    const user = await this.deps.db.user.findUnique({ where: { id: userId }, select: { registrationIp: true } });
    const ip = user?.registrationIp;
    if (!ip || ip === "0.0.0.0" || ip === "127.0.0.1" || ip === "::1") return [];
    const others = [...((await this.otherAccounts([ip], userId)).get(ip) ?? [])].slice(0, 10);
    if (others.length === 0) return [];
    const banned = await this.bannedSet(others);
    await this.deps.bus.emit({ name: "antispam.multi_account", payload: { userId, ip, others, banned: [...banned] }, tags: [`user:${userId}`] });
    return others;
  }

  listen(bus: GcsEventBus): void {
    bus.on("user.registered", async (e) => {
      const userId = typeof e.payload.userId === "string" ? e.payload.userId : null;
      if (userId) await this.checkNewAccount(userId).catch(() => []);
    });
  }

  /**
   * Ștergerea IP-urilor vechi (GDPR): după `members.ip_retention_days` zile, IP-urile din postări, mesaje private,
   * statusuri, jurnale, dispozitive, sesiuni și conturi se golesc. Banurile pe IP rămân (sunt intenționate).
   */
  async stripOldIps(now = new Date()): Promise<number> {
    const days = await this.deps.settings.get<number>(IP_RETENTION_SETTING).catch(() => 0);
    if (!days || days <= 0) return 0;
    const { db } = this.deps;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const before = { lt: cutoff };
    const results = await Promise.all([
      db.post.updateMany({ where: { ip: { not: null }, createdAt: before }, data: { ip: null } }),
      db.conversationMessage.updateMany({ where: { ip: { not: null }, createdAt: before }, data: { ip: null } }),
      db.statusUpdate.updateMany({ where: { ip: { not: null }, createdAt: before }, data: { ip: null } }),
      db.auditLog.updateMany({ where: { ip: { not: null }, createdAt: before }, data: { ip: null } }),
      db.spamLog.updateMany({ where: { ip: { not: null }, createdAt: before }, data: { ip: null } }),
      db.userDevice.updateMany({ where: { ip: { not: null }, lastSeenAt: before }, data: { ip: null } }),
      db.session.updateMany({ where: { ipAddress: { not: null }, updatedAt: before }, data: { ipAddress: null } }),
      db.user.updateMany({ where: { registrationIp: { not: null }, createdAt: before }, data: { registrationIp: null } }),
      db.user.updateMany({ where: { lastIp: { not: null }, OR: [{ lastActiveAt: before }, { lastActiveAt: null }] } as Prisma.UserWhereInput, data: { lastIp: null } }),
    ]);
    return results.reduce((sum, r) => sum + r.count, 0);
  }
}
