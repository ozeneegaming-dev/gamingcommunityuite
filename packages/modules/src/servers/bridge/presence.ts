import { GcsForbidden, type GcsActor, type GcsAppService, type GcsPermissionService, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { SERVERS_APP } from "../poller";
import { BRIDGE_PERMISSION, BRIDGE_SETTING } from "./config";
import { isPowerAdmin, normalizeFlags } from "./flags";
import type { GcsBridgeStore, GcsRoster } from "./store";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOWS = { d1: DAY, d7: 7 * DAY, d30: 30 * DAY } as const;

/**
 * Un admin în lista prezenței (§11). `subject` = `USER` / `PLAYER` / `NAME` pentru intrările GCS (`game_admins`) sau
 * `SERVER` pentru un admin raportat de sistemul de admini al serverului (specul plugin-v2 §2): atunci `id` = −id-ul
 * identității de joc, `playerId` = identitatea, `flags` = flag-urile raportate.
 */
export type GcsAdminPresence = {
  id: number;
  subject: string;
  /** Identitatea de joc (doar adminii raportați de servere). */
  playerId: number | null;
  name: string;
  user: { id: string; name: string } | null;
  label: string | null;
  flags: string;
  server: { id: number; name: string } | null;
  /** Online acum: serverul și ora intrării (sesiunea deschisă). */
  online: { serverId: number; serverName: string; since: string | null } | null;
  seen24h: boolean;
  seen7d: boolean;
  /** Timpul de joc (secunde) pe 24 h / 7 zile / 30 de zile. */
  playtime: { d1: number; d7: number; d30: number };
  lastSeenAt: string | null;
  /** Acțiunile din joc (ban, kick, mute…) pe 7 / 30 de zile și tichetele tratate pe 30 de zile. */
  actions: { d7: number; d30: number };
  ticketsHandled30: number;
  inactive: boolean;
};

/** Un admin online acum (widget-ul „Admini online”); `adminId` gol = admin raportat de server (flag-urile lui). */
export type GcsOnlineAdmin = {
  adminId: number | null;
  /** Flag-urile raportate de server (doar adminii fără intrare GCS). */
  flags: string | null;
  name: string;
  user: { id: string; name: string } | null;
  label: string | null;
  /** Identitatea cu care e în joc (profilul de jucător). */
  playerId: number;
  server: { id: number; name: string };
  /** Ora intrării (sesiunea deschisă). */
  since: string | null;
};

const ENTRY_INCLUDE = {
  preset: { select: { name: true, flags: true } },
  user: { select: { id: true, name: true, gamePlayers: { select: { id: true, kind: true } } } },
  player: { select: { id: true, kind: true, name: true, value: true } },
  server: { select: { id: true, name: true } },
} as const;
type Entry = Prisma.GameAdminGetPayload<{ include: typeof ENTRY_INCLUDE }>;

/** Identitățile prin care un admin e recunoscut în joc (ca la lista `/admins`). */
function playerIdsOf(e: Entry): number[] {
  if (e.subject === "USER") return (e.user?.gamePlayers ?? []).filter((p) => p.kind === "STEAM" || (p.kind === "NONSTEAM" && e.allowNonSteam)).map((p) => p.id);
  if (e.subject === "PLAYER" && e.player) return [e.player.id];
  return [];
}

/** Secundele unei sesiuni care cad în ultima fereastră de `ms` (o sesiune deschisă ține până acum). */
const overlap = (start: number, end: number, now: number, ms: number) => Math.max(0, Math.min(end, now) - Math.max(start, now - ms)) / 1000;

/**
 * Prezența adminilor (specul 2026-10-08-servere-bridge §11): cine e online acum (lista ultimului heartbeat, max 2 ×
 * intervalul), văzut în ultimele 24 h / 7 zile, timpul de joc pe 24 h / 7 / 30 de zile, ultima apariție, acțiunile din
 * joc și tichetele tratate; inactiv = ultima apariție mai veche de `servers.admin_inactive_days` (sau niciodată).
 */
export class GcsBridgePresence {
  constructor(
    private readonly deps: { db: PrismaClient; permissions: GcsPermissionService; settings: GcsSettingsService; apps: GcsAppService; store: GcsBridgeStore; now?: () => number },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * `visibleServers` (paginile publice): doar adminii acestor servere (și cei „toate serverele”), iar online, sesiunile și
   * acțiunile doar pe ele, ca prezența să nu arate activitatea de pe un server ascuns viewer-ului.
   */
  async list(actor: GcsActor, opts: { serverId?: number; visibleServers?: number[] } = {}): Promise<GcsAdminPresence[]> {
    const { db, permissions, settings, apps, store } = this.deps;
    if (actor.isBanned || !(await apps.enabled(SERVERS_APP)) || !(await permissions.can(actor, BRIDGE_PERMISSION.statsView))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.statsView });
    const now = this.now();
    const nowDate = new Date(now);
    const visible = opts.visibleServers;
    const where: Prisma.GameAdminWhereInput = { AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: nowDate } }] }] };
    if (typeof opts.serverId === "number") (where.AND as Prisma.GameAdminWhereInput[]).push({ OR: [{ serverId: opts.serverId }, { serverId: null }] });
    if (visible) (where.AND as Prisma.GameAdminWhereInput[]).push({ OR: [{ serverId: { in: visible } }, { serverId: null }] });
    const entries = await db.gameAdmin.findMany({ where, include: ENTRY_INCLUDE, orderBy: { id: "asc" }, take: 500 });

    const [heartbeat, inactiveDays] = await Promise.all([settings.get<number>(BRIDGE_SETTING.heartbeat), settings.get<number>(BRIDGE_SETTING.adminInactiveDays)]);
    const servers = await db.gameServer.findMany({
      where: { enabled: true, ...(typeof opts.serverId === "number" ? { id: opts.serverId } : {}), ...(visible ? { AND: [{ id: { in: visible } }] } : {}) },
      select: { id: true, name: true },
    });
    const onServers: Prisma.GameSessionWhereInput = visible ? { serverId: { in: visible } } : {};
    const serverName = new Map(servers.map((s) => [s.id, s.name]));
    const rosters = await store.rosters(servers.map((s) => s.id));

    const idsOf = new Map(entries.map((e) => [e.id, playerIdsOf(e)]));
    const allPlayers = [...new Set([...idsOf.values()].flat())];
    const entryIds = entries.map((e) => e.id);
    const userIds = [...new Set(entries.flatMap((e) => (e.userId ? [e.userId] : [])))];
    const since30 = new Date(now - WINDOWS.d30);

    const [sessions, lastSeen, actions, tickets] = await Promise.all([
      db.gameSession.findMany({
        where: { AND: [{ OR: [{ adminId: { in: entryIds } }, { playerId: { in: allPlayers } }] }, { OR: [{ disconnectedAt: null }, { disconnectedAt: { gte: since30 } }] }, onServers] },
        select: { serverId: true, playerId: true, adminId: true, connectedAt: true, disconnectedAt: true },
      }),
      // Ultima apariție, din toate sesiunile păstrate (și cele mai vechi de 30 de zile).
      db.gameSession.groupBy({ by: ["playerId", "adminId"], where: { AND: [{ OR: [{ adminId: { in: entryIds } }, { playerId: { in: allPlayers } }] }, onServers] }, _max: { disconnectedAt: true } }),
      db.gameAdminAction.findMany({
        where: {
          at: { gte: since30 },
          OR: [{ adminId: { in: entryIds } }, { adminPlayerId: { in: allPlayers } }, ...(userIds.length > 0 ? [{ adminUserId: { in: userIds } }] : [])],
          ...(visible ? { serverId: { in: visible } } : {}),
        },
        select: { adminId: true, adminPlayerId: true, adminUserId: true, at: true },
      }),
      userIds.length === 0
        ? Promise.resolve([] as { authorId: string | null }[])
        : db.gameTicketMessage.findMany({ where: { kind: "STATUS", createdAt: { gte: since30 }, authorId: { in: userIds } }, select: { authorId: true } }),
    ]);
    const fresh = 2 * heartbeat * 1000;

    const fromEntries = entries.map((e) => {
      const ids = new Set(idsOf.get(e.id)!);
      const mine = sessions.filter((s) => s.adminId === e.id || ids.has(s.playerId));
      let online: GcsAdminPresence["online"] = null;
      for (const [serverId, roster] of rosters) {
        if (now - roster.at > fresh) continue;
        if (e.serverId !== null && e.serverId !== serverId) continue;
        const hit = roster.players.find((p) => p.adminId === e.id || ids.has(p.playerId));
        if (!hit) continue;
        const open = mine.find((s) => s.serverId === serverId && s.playerId === hit.playerId && s.disconnectedAt === null);
        online = { serverId, serverName: serverName.get(serverId) ?? "", since: open?.connectedAt.toISOString() ?? null };
        break;
      }
      const playtime = { d1: 0, d7: 0, d30: 0 };
      let last = 0;
      for (const s of mine) {
        const start = s.connectedAt.getTime();
        const end = s.disconnectedAt?.getTime() ?? now;
        playtime.d1 += overlap(start, end, now, WINDOWS.d1);
        playtime.d7 += overlap(start, end, now, WINDOWS.d7);
        playtime.d30 += overlap(start, end, now, WINDOWS.d30);
        last = Math.max(last, end);
      }
      for (const g of lastSeen) if (g.adminId === e.id || ids.has(g.playerId)) last = Math.max(last, g._max.disconnectedAt?.getTime() ?? 0);
      if (online) last = now;
      const myActions = actions.filter((a) => a.adminId === e.id || (a.adminPlayerId !== null && ids.has(a.adminPlayerId)) || (e.userId !== null && a.adminUserId === e.userId));
      const name = e.subject === "USER" ? (e.user?.name ?? "") : e.subject === "PLAYER" ? e.player?.name || e.player?.value || "" : (e.name ?? "");
      return {
        id: e.id,
        subject: e.subject,
        name,
        user: e.user ? { id: e.user.id, name: e.user.name } : null,
        label: e.preset?.name ?? null,
        flags: normalizeFlags(e.flags ?? e.preset?.flags ?? ""),
        server: e.server,
        online,
        seen24h: last > 0 && now - last <= WINDOWS.d1,
        seen7d: last > 0 && now - last <= WINDOWS.d7,
        playtime: { d1: Math.round(playtime.d1), d7: Math.round(playtime.d7), d30: Math.round(playtime.d30) },
        lastSeenAt: last > 0 ? new Date(last).toISOString() : null,
        actions: { d7: myActions.filter((a) => now - a.at.getTime() <= WINDOWS.d7).length, d30: myActions.length },
        ticketsHandled30: e.userId ? tickets.filter((t) => t.authorId === e.userId).length : 0,
        inactive: last === 0 || now - last > inactiveDays * DAY,
        playerId: null,
      };
    });
    const covered = new Set(allPlayers);
    const reported = await this.reportedAdmins({ now, fresh, inactiveDays, rosters, serverName, covered, onServers, serverId: opts.serverId });
    return [...fromEntries, ...reported];
  }

  /**
   * Adminii raportați de servere (specul plugin-v2 §2): identitățile cu flag-uri de putere în sesiunile din ultimele 30
   * de zile (`game_sessions.adminFlags`) sau în lista online, fără cele acoperite deja de o intrare GCS. Timpul de joc și
   * ultima apariție vin doar din sesiunile în care au fost admini.
   */
  private async reportedAdmins(ctx: {
    now: number;
    fresh: number;
    inactiveDays: number;
    rosters: Map<number, GcsRoster>;
    serverName: Map<number, string>;
    covered: Set<number>;
    onServers: Prisma.GameSessionWhereInput;
    serverId?: number;
  }): Promise<GcsAdminPresence[]> {
    const { db } = this.deps;
    const { now, fresh, rosters, serverName, covered } = ctx;
    const since30 = new Date(now - WINDOWS.d30);
    const sessions = (
      await db.gameSession.findMany({
        where: {
          adminFlags: { not: null },
          serverId: { in: [...serverName.keys()] },
          AND: [{ OR: [{ disconnectedAt: null }, { disconnectedAt: { gte: since30 } }] }, ctx.onServers],
          ...(covered.size > 0 ? { playerId: { notIn: [...covered] } } : {}),
        },
        select: { serverId: true, playerId: true, connectedAt: true, disconnectedAt: true, adminFlags: true },
        orderBy: { connectedAt: "desc" },
        take: 5000,
      })
    ).filter((s) => isPowerAdmin(s.adminFlags));
    // Online acum: lista ultimului heartbeat (și adminii fără sesiune salvată încă).
    const onlineBy = new Map<number, { serverId: number; flags: string; name: string }>();
    for (const [serverId, roster] of rosters) {
      if (now - roster.at > fresh) continue;
      for (const p of roster.players) if (p.flags && isPowerAdmin(p.flags) && !covered.has(p.playerId) && !onlineBy.has(p.playerId)) onlineBy.set(p.playerId, { serverId, flags: p.flags, name: p.name });
    }
    const ids = [...new Set([...sessions.map((s) => s.playerId), ...onlineBy.keys()])].slice(0, 500);
    if (ids.length === 0) return [];
    const players = await db.gamePlayer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, value: true, user: { select: { id: true, name: true } } } });
    const actions = await db.gameAdminAction.findMany({ where: { at: { gte: since30 }, adminPlayerId: { in: ids }, ...(ctx.serverId !== undefined ? { serverId: ctx.serverId } : {}) }, select: { adminPlayerId: true, at: true } });
    return players.map((p) => {
      const mine = sessions.filter((s) => s.playerId === p.id);
      const live = onlineBy.get(p.id) ?? null;
      const open = live ? mine.find((s) => s.serverId === live.serverId && s.disconnectedAt === null) : undefined;
      const playtime = { d1: 0, d7: 0, d30: 0 };
      let last = 0;
      for (const s of mine) {
        const start = s.connectedAt.getTime();
        const end = s.disconnectedAt?.getTime() ?? now;
        playtime.d1 += overlap(start, end, now, WINDOWS.d1);
        playtime.d7 += overlap(start, end, now, WINDOWS.d7);
        playtime.d30 += overlap(start, end, now, WINDOWS.d30);
        last = Math.max(last, end);
      }
      if (live) last = now;
      // Serverul și flag-urile: unde e acum, altfel ultima sesiune de admin.
      const where = live?.serverId ?? mine[0]?.serverId ?? null;
      const myActions = actions.filter((a) => a.adminPlayerId === p.id);
      return {
        id: -p.id,
        subject: "SERVER",
        playerId: p.id,
        name: p.name || live?.name || p.value,
        user: p.user ? { id: p.user.id, name: p.user.name } : null,
        label: null,
        flags: normalizeFlags(live?.flags ?? mine[0]?.adminFlags ?? ""),
        server: where !== null ? { id: where, name: serverName.get(where) ?? "" } : null,
        online: live ? { serverId: live.serverId, serverName: serverName.get(live.serverId) ?? "", since: open?.connectedAt.toISOString() ?? null } : null,
        seen24h: last > 0 && now - last <= WINDOWS.d1,
        seen7d: last > 0 && now - last <= WINDOWS.d7,
        playtime: { d1: Math.round(playtime.d1), d7: Math.round(playtime.d7), d30: Math.round(playtime.d30) },
        lastSeenAt: last > 0 ? new Date(last).toISOString() : null,
        actions: { d7: myActions.filter((a) => now - a.at.getTime() <= WINDOWS.d7).length, d30: myActions.length },
        ticketsHandled30: 0,
        inactive: last === 0 || now - last > ctx.inactiveDays * DAY,
      };
    });
  }

  /** Listele jucătorilor proaspete (din ultimul heartbeat, max 2 × intervalul) ale serverelor date. */
  private async freshRosters(serverIds: number[]): Promise<Map<number, GcsRoster>> {
    const heartbeat = await this.deps.settings.get<number>(BRIDGE_SETTING.heartbeat);
    const now = this.now();
    const out = new Map<number, GcsRoster>();
    for (const [id, roster] of await this.deps.store.rosters(serverIds)) if (now - roster.at <= 2 * heartbeat * 1000) out.set(id, roster);
    return out;
  }

  /** Câți admini recunoscuți sunt acum pe fiecare server dat (indicatorul „Admin online”); serverele fără admin lipsesc. */
  async onlineCounts(serverIds: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    for (const [id, roster] of await this.freshRosters(serverIds)) {
      // Intrările GCS recunoscute și adminii raportați de sistemul de admini al serverului (specul plugin-v2 §2).
      const n = new Set(roster.players.flatMap((p) => (p.adminId !== null ? [`a${p.adminId}`] : isPowerAdmin(p.flags) ? [`p${p.playerId}`] : []))).size;
      if (n > 0) out.set(id, n);
    }
    return out;
  }

  /**
   * Adminii online acum pe serverele date (widget-ul „Admini online”), citire ușoară: lista ultimului heartbeat (Redis),
   * intrările de admin și sesiunile deschise (ora intrării). Fără verificarea dreptului: o face cine cheamă.
   */
  async online(serverIds: number[], limit = 50): Promise<GcsOnlineAdmin[]> {
    const { db } = this.deps;
    const rosters = await this.freshRosters(serverIds);
    // Intrările GCS recunoscute și adminii raportați de sistemul de admini al serverului (specul plugin-v2 §2).
    const hits = [...rosters].flatMap(([serverId, r]) =>
      r.players.flatMap((p) => (p.adminId !== null || isPowerAdmin(p.flags) ? [{ serverId, playerId: p.playerId, adminId: p.adminId, name: p.name, flags: p.flags ?? null }] : [])),
    );
    if (hits.length === 0) return [];
    const adminIds = [...new Set(hits.flatMap((h) => (h.adminId === null ? [] : [h.adminId])))];
    const reportedIds = [...new Set(hits.flatMap((h) => (h.adminId === null ? [h.playerId] : [])))];
    const [entries, servers, sessions, players] = await Promise.all([
      adminIds.length === 0
        ? Promise.resolve([])
        : db.gameAdmin.findMany({
            where: { id: { in: adminIds } },
            include: { preset: { select: { name: true } }, user: { select: { id: true, name: true } }, player: { select: { name: true, value: true } } },
          }),
      db.gameServer.findMany({ where: { id: { in: [...rosters.keys()] } }, select: { id: true, name: true } }),
      db.gameSession.findMany({ where: { disconnectedAt: null, OR: hits.map((h) => ({ serverId: h.serverId, playerId: h.playerId })) }, select: { serverId: true, playerId: true, connectedAt: true } }),
      reportedIds.length === 0 ? Promise.resolve([]) : db.gamePlayer.findMany({ where: { id: { in: reportedIds } }, select: { id: true, user: { select: { id: true, name: true } } } }),
    ]);
    const entryBy = new Map(entries.map((e) => [e.id, e]));
    const serverBy = new Map(servers.map((s) => [s.id, s]));
    const userOf = new Map(players.map((p) => [p.id, p.user]));
    const seen = new Set<string>();
    const out: GcsOnlineAdmin[] = [];
    for (const h of hits) {
      const server = serverBy.get(h.serverId);
      if (!server) continue;
      const since = sessions.find((s) => s.serverId === h.serverId && s.playerId === h.playerId)?.connectedAt.toISOString() ?? null;
      if (h.adminId === null) {
        const user = userOf.get(h.playerId) ?? null;
        const key = `${h.serverId}:${user?.id ?? `p${h.playerId}`}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ adminId: null, flags: normalizeFlags(h.flags ?? ""), name: user?.name ?? h.name, user, label: null, playerId: h.playerId, server, since });
        continue;
      }
      const e = entryBy.get(h.adminId);
      // Un membru cu mai multe identități (sau intrări) apare o singură dată pe server.
      const key = `${h.serverId}:${e?.userId ?? `a${h.adminId}`}`;
      if (!e || seen.has(key)) continue;
      seen.add(key);
      const name = e.subject === "USER" ? (e.user?.name ?? h.name) : e.subject === "PLAYER" ? e.player?.name || h.name || e.player?.value || "" : (e.name ?? h.name);
      out.push({ adminId: e.id, flags: null, name, user: e.user, label: e.preset?.name ?? null, playerId: h.playerId, server, since });
    }
    return out.sort((a, b) => (a.since ?? "").localeCompare(b.since ?? "")).slice(0, limit);
  }

  /**
   * Jobul de curățenie: sesiunile rămase deschise pe un server care nu mai trimite heartbeat (> 3 minute) se închid la
   * ultimul heartbeat (cu timpul de joc), iar lista jucătorilor lui dispare.
   */
  async closeSilent(closeSession: (serverId: number, playerId: number, at: Date) => Promise<unknown>): Promise<number> {
    const { db, store } = this.deps;
    const cutoff = new Date(this.now() - 3 * 60_000);
    const servers = await db.gameServer.findMany({
      where: { OR: [{ bridgeSeenAt: null }, { bridgeSeenAt: { lt: cutoff } }], sessions: { some: { disconnectedAt: null } } },
      select: { id: true, bridgeSeenAt: true },
    });
    let closed = 0;
    for (const s of servers) {
      const open = await db.gameSession.findMany({ where: { serverId: s.id, disconnectedAt: null }, select: { playerId: true, connectedAt: true } });
      for (const o of open) {
        const at = s.bridgeSeenAt && s.bridgeSeenAt > o.connectedAt ? s.bridgeSeenAt : o.connectedAt;
        await closeSession(s.id, o.playerId, at);
        closed++;
      }
      await store.clearRoster(s.id);
    }
    return closed;
  }
}
