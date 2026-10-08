import type { GcsActorResolver, GcsEventBus, GcsNotificationService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsBridgeTickets } from "./tickets";

/** Ținta notificărilor despre un tichet (contestație / reclamație): o vede cine vede tichetul. */
export const TICKET_TARGET = "servers.ticket";
/** Ținta notificării „identitate legată” (Setări → Cont). */
export const PLAYER_TARGET = "servers.player";

/** Adresa unui tichet pe site (paginile publice vin în partea B). */
export const ticketHref = (id: number) => `/servers/tickets/${id}`;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Notificările punții (specul 2026-10-08-servere-bridge §14, §3.3): tichet nou (staff-ului care îl poate trata),
 * schimbarea unui tichet (autorului: starea, răspunsul public; responsabilului: răspunsul autorului) și identitatea de
 * joc legată de cont.
 */
export function registerBridgeNotifications(deps: { db: PrismaClient; bus: GcsEventBus; notifications: GcsNotificationService; tickets: GcsBridgeTickets; actors: GcsActorResolver }): void {
  const { db, bus, notifications, tickets, actors } = deps;
  notifications.registerTarget(TICKET_TARGET, {
    canView: async (userId, id) => tickets.canViewId(await actors.forUser(userId, ""), Number(id)),
    describe: async (id) => {
      const t = await db.gameTicket.findUnique({ where: { id: Number(id) }, select: { id: true, title: true } });
      return t ? { title: t.title, href: ticketHref(t.id) } : null;
    },
  });
  notifications.registerTarget(PLAYER_TARGET, {
    canView: async (userId, id) => (await db.gamePlayer.count({ where: { id: Number(id), userId } })) > 0,
    describe: async (id) => {
      const p = await db.gamePlayer.findUnique({ where: { id: Number(id) }, select: { name: true, value: true } });
      return p ? { title: p.name || p.value, href: "/settings/account" } : null;
    },
  });

  bus.on("servers.ticket.created", async (e) => {
    const recipients = ids(e.payload.recipients);
    if (recipients.length === 0) return;
    await notifications.notify({ userIds: recipients, type: "servers.ticket_new", targetType: TICKET_TARGET, targetId: String(e.payload.ticketId), actorId: str(e.payload.actorId) });
  });
  bus.on("servers.ticket.updated", async (e) => {
    const recipients = ids(e.payload.recipients).filter((id) => id !== str(e.payload.actorId));
    if (recipients.length === 0) return;
    await notifications.notify({
      userIds: recipients,
      type: "servers.ticket_update",
      targetType: TICKET_TARGET,
      targetId: String(e.payload.ticketId),
      actorId: str(e.payload.actorId),
      data: { kind: str(e.payload.kind) ?? "reply", status: str(e.payload.status) ?? "" },
    });
  });
  bus.on("servers.player.linked", async (e) => {
    const userId = str(e.payload.userId);
    if (!userId) return;
    await notifications.notify({ userIds: [userId], type: "servers.player_linked", targetType: PLAYER_TARGET, targetId: String(e.payload.playerId), actorId: null, data: { source: str(e.payload.source) ?? "" } });
  });
}
