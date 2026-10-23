import type { GcsAcpRoleService, GcsActorResolver, GcsEventBus, GcsNotificationService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { DONATIONS_ACP_SECTION, donationAmountLabel } from "./donations";

/** Ținta notificărilor despre o donație: o vede donatorul ei și echipa cu dreptul pe donații. */
export const DONATION_TARGET = "donations.donation";
/** Pagina publică a donațiilor (unde își vede membrul cererile și starea lor). */
export const DONATIONS_PAGE = "/donatii";
const STAFF_PAGE = "/admin/vip/donations?status=PENDING";
/** Cel mult atâția membri ai echipei primesc anunțul unei cereri noi. */
const STAFF_MAX = 50;

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Notificările donațiilor (prin serviciul comun, cu preferințele fiecăruia):
 * - `donations.confirmed`: donatorul, când echipa îi confirmă / înregistrează donația („Mulțumim!”);
 * - `donations.rejected`: donatorul, când cererea lui „Am donat” e respinsă (cu motivul);
 * - `donations.submitted`: echipa cu dreptul de editare pe donații (Root Admin și rolurile ACP), la o cerere nouă.
 */
export function registerDonationNotifications(deps: { db: PrismaClient; bus: GcsEventBus; notifications: GcsNotificationService; acp: Pick<GcsAcpRoleService, "can">; actors: GcsActorResolver }): void {
  const { db, bus, notifications, acp, actors } = deps;
  notifications.registerTarget(DONATION_TARGET, {
    canView: async (userId, id) => {
      const row = await db.memberDonation.findUnique({ where: { id: Number(id) }, select: { userId: true } });
      if (!row) return false;
      return row.userId === userId || acp.can(await actors.forUser(userId, ""), DONATIONS_ACP_SECTION, "view");
    },
    describe: async (id) => {
      const row = await db.memberDonation.findUnique({ where: { id: Number(id) }, select: { amount: true, currency: true } });
      return row ? { title: donationAmountLabel(row.amount, row.currency), href: DONATIONS_PAGE } : null;
    },
  });

  /** Echipa care poate confirma: Root Admin plus membrii (direct sau prin grup) rolurilor ACP cu drept de editare. */
  async function staff(): Promise<string[]> {
    const roles = await db.acpRole.findMany({ where: { permissions: { some: { section: DONATIONS_ACP_SECTION, canEdit: true } } }, select: { assignments: { select: { userId: true, groupId: true } } } });
    const assigned = roles.flatMap((r) => r.assignments);
    const groupIds = assigned.map((a) => a.groupId).filter((g): g is number => g !== null);
    const users = await db.user.findMany({
      where: {
        OR: [
          { primaryGroup: { key: "root_admin" } },
          { groups: { some: { group: { key: "root_admin" } } } },
          { id: { in: assigned.map((a) => a.userId).filter((u): u is string => u !== null) } },
          { primaryGroupId: { in: groupIds } },
          { groups: { some: { groupId: { in: groupIds } } } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: STAFF_MAX,
    });
    return users.map((u) => u.id);
  }

  bus.on("donation.confirmed", async (e) => {
    const userId = str(e.payload.userId);
    if (!userId || e.payload.notify !== true) return;
    await notifications.notify({ userIds: [userId], type: "donations.confirmed", targetType: DONATION_TARGET, targetId: String(e.payload.donationId), actorId: null });
  });
  bus.on("donation.rejected", async (e) => {
    const userId = str(e.payload.userId);
    if (!userId) return;
    await notifications.notify({ userIds: [userId], type: "donations.rejected", targetType: DONATION_TARGET, targetId: String(e.payload.donationId), actorId: null, data: { reason: str(e.payload.reason) ?? "" } });
  });
  bus.on("donation.submitted", async (e) => {
    const recipients = await staff();
    if (recipients.length === 0) return;
    await notifications.notify({ userIds: recipients, type: "donations.submitted", targetType: DONATION_TARGET, targetId: String(e.payload.donationId), actorId: str(e.payload.userId), data: { href: STAFF_PAGE } });
  });
}
