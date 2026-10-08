import { GcsForbidden, type GcsActor, type GcsAppService, type GcsPermissionService, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { SERVERS_APP } from "../poller";
import { BRIDGE_PERMISSION, BRIDGE_SETTING } from "./config";
import { normalizeFlags } from "./flags";
import type { GcsBridgeStore } from "./store";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOWS = { d1: DAY, d7: 7 * DAY, d30: 30 * DAY } as const;

/** Un admin în lista prezenței (§11). */
export type GcsAdminPresence = {
  id: number;
  subject: string;
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

  async list(actor: GcsActor, opts: { serverId?: number } = {}): Promise<GcsAdminPresence[]> {
    const { db, permissions, settings, apps, store } = this.deps;
    if (actor.isBanned || !(await apps.enabled(SERVERS_APP)) || !(await permissions.can(actor, BRIDGE_PERMISSION.statsView))) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.statsView });
    const now = this.now();
    const nowDate = new Date(now);
    const where: Prisma.GameAdminWhereInput = { AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: nowDate } }] }] };
    if (typeof opts.serverId === "number") (where.AND as Prisma.GameAdminWhereInput[]).push({ OR: [{ serverId: opts.serverId }, { serverId: null }] });
    const entries = await db.gameAdmin.findMany({ where, include: ENTRY_INCLUDE, orderBy: { id: "asc" }, take: 500 });
    if (entries.length === 0) return [];

    const [heartbeat, inactiveDays] = await Promise.all([settings.get<number>(BRIDGE_SETTING.heartbeat), settings.get<number>(BRIDGE_SETTING.adminInactiveDays)]);
    const servers = await db.gameServer.findMany({ where: { enabled: true, ...(typeof opts.serverId === "number" ? { id: opts.serverId } : {}) }, select: { id: true, name: true } });
    const serverName = new Map(servers.map((s) => [s.id, s.name]));
    const rosters = await store.rosters(servers.map((s) => s.id));

    const idsOf = new Map(entries.map((e) => [e.id, playerIdsOf(e)]));
    const allPlayers = [...new Set([...idsOf.values()].flat())];
    const entryIds = entries.map((e) => e.id);
    const userIds = [...new Set(entries.flatMap((e) => (e.userId ? [e.userId] : [])))];
    const since30 = new Date(now - WINDOWS.d30);

    const [sessions, lastSeen, actions, tickets] = await Promise.all([
      db.gameSession.findMany({
        where: { AND: [{ OR: [{ adminId: { in: entryIds } }, { playerId: { in: allPlayers } }] }, { OR: [{ disconnectedAt: null }, { disconnectedAt: { gte: since30 } }] }] },
        select: { serverId: true, playerId: true, adminId: true, connectedAt: true, disconnectedAt: true },
      }),
      // Ultima apariție, din toate sesiunile păstrate (și cele mai vechi de 30 de zile).
      db.gameSession.groupBy({ by: ["playerId", "adminId"], where: { OR: [{ adminId: { in: entryIds } }, { playerId: { in: allPlayers } }] }, _max: { disconnectedAt: true } }),
      db.gameAdminAction.findMany({
        where: { at: { gte: since30 }, OR: [{ adminId: { in: entryIds } }, { adminPlayerId: { in: allPlayers } }, ...(userIds.length > 0 ? [{ adminUserId: { in: userIds } }] : [])] },
        select: { adminId: true, adminPlayerId: true, adminUserId: true, at: true },
      }),
      userIds.length === 0
        ? Promise.resolve([] as { authorId: string | null }[])
        : db.gameTicketMessage.findMany({ where: { kind: "STATUS", createdAt: { gte: since30 }, authorId: { in: userIds } }, select: { authorId: true } }),
    ]);
    const fresh = 2 * heartbeat * 1000;

    return entries.map((e) => {
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
      };
    });
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
