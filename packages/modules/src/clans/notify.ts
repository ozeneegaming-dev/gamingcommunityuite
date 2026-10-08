import type { GcsActorResolver, GcsEventBus, GcsNotificationService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsClanQueries } from "./queries";
import { clanHref } from "./text";

/** Ținta notificărilor despre un clan existent (vede notificarea cine vede clanul). */
export const CLAN_TARGET = "clans.clan";
/** Ținta notificărilor despre un clan șters (respins, desființat): textul și linkul vin din notificare. */
export const CLAN_NOTICE_TARGET = "clans.notice";

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Notificările clanurilor (specul 2026-10-08-clanuri §11): invitațiile, cererile noi (liderului și ofițerilor),
 * schimbările de apartenență (cerere acceptată / refuzată, numit ofițer, retrogradat, lider, exclus, desființat) și
 * aprobarea / respingerea clanului. Trec prin serviciul de notificări, cu preferințele fiecărui membru.
 */
export function registerClanNotifications(deps: { db: PrismaClient; bus: GcsEventBus; notifications: GcsNotificationService; clanQueries: GcsClanQueries; actors: GcsActorResolver }): void {
  const { db, bus, notifications, clanQueries, actors } = deps;
  notifications.registerTarget(CLAN_TARGET, {
    canView: async (userId, id) => clanQueries.canSeeClan(await actors.forUser(userId, ""), Number(id)),
    describe: async (id) => {
      const clan = await db.clan.findUnique({ where: { id: Number(id) }, select: { id: true, tag: true, name: true, slug: true } });
      return clan ? { title: `[${clan.tag}] ${clan.name}`, href: clanHref(clan) } : null;
    },
  });
  notifications.registerTarget(CLAN_NOTICE_TARGET, {
    canView: async () => true,
    describe: async () => ({ title: "", href: "/clans" }),
  });

  bus.on("clan.invited", async (e) => {
    const userId = str(e.payload.userId);
    if (userId) await notifications.notify({ userIds: [userId], type: "clans.invite", targetType: CLAN_TARGET, targetId: String(e.payload.clanId), actorId: str(e.payload.actorId) });
  });
  bus.on("clan.requested", async (e) => {
    const recipients = Array.isArray(e.payload.recipients) ? (e.payload.recipients as unknown[]).filter((id): id is string => typeof id === "string") : [];
    const clan = await db.clan.findUnique({ where: { id: Number(e.payload.clanId) }, select: { id: true, slug: true } });
    if (!clan || recipients.length === 0) return;
    await notifications.notify({
      userIds: recipients,
      type: "clans.request",
      targetType: CLAN_TARGET,
      targetId: String(clan.id),
      actorId: str(e.payload.userId),
      data: { href: `${clanHref(clan)}/manage?tab=requests` },
    });
  });
  bus.on("clan.membership", async (e) => {
    const userId = str(e.payload.userId);
    const kind = str(e.payload.kind);
    if (!userId || !kind) return;
    // Excluderea: membrul nu mai e în clan, dar pagina clanului rămâne publică (ținta o vede).
    await notifications.notify({ userIds: [userId], type: "clans.membership", targetType: CLAN_TARGET, targetId: String(e.payload.clanId), actorId: str(e.payload.actorId), data: { kind } });
  });
  bus.on("clan.reviewed", async (e) => {
    const userId = str(e.payload.userId);
    const kind = str(e.payload.kind);
    if (!userId || !kind) return;
    const data = { kind, reason: str(e.payload.reason) ?? "" };
    if (kind === "approved") {
      await notifications.notify({ userIds: [userId], type: "clans.review", targetType: CLAN_TARGET, targetId: String(e.payload.clanId), actorId: null, data });
    } else {
      await notifications.notify({ userIds: [userId], type: "clans.review", targetType: CLAN_NOTICE_TARGET, targetId: String(e.payload.clanId), actorId: null, data: { ...data, title: str(e.payload.name) ?? "" } });
    }
  });
  bus.on("clan.disbanded", async (e) => {
    const userIds = Array.isArray(e.payload.userIds) ? (e.payload.userIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
    if (userIds.length === 0) return;
    await notifications.notify({
      userIds,
      type: "clans.membership",
      targetType: CLAN_NOTICE_TARGET,
      targetId: String(e.payload.clanId),
      actorId: null,
      data: { kind: "disbanded", title: `[${str(e.payload.tag) ?? ""}] ${str(e.payload.name) ?? ""}` },
    });
  });
}
