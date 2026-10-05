import type { PrismaClient } from "@gcs/db";
import type { GcsCache } from "../cache";
import { bannedSessionKey, findActiveBan } from "../moderation/bans";
import type { GcsActor } from "../permissions/types";

/** `lastActiveAt` se actualizează cel mult o dată la 5 minute (pentru „cine e online”), nu la fiecare request. */
const ACTIVITY_THROTTLE_MS = 5 * 60_000;

/**
 * Rezolvă cine face request-ul (spec §6.3): sesiunea, grupurile și bannurile active (cont, email, IP).
 * La un ban de cont, șterge sesiunile userului și întoarce un vizitator cu `isBanned: true`.
 * Un token șters la ban (marcat în cache de `GcsBanService`) dă tot un vizitator cu `isBanned: true`.
 *
 * `staleSessionToken` e un token nevalidat (ex. din cookie, când sesiunea nu mai există): e folosit doar
 * ca să afle dacă sesiunea a fost revocată la ban, niciodată ca să autentifice.
 */
export class GcsActorResolver {
  private guestGroupId: number | undefined;

  constructor(private readonly deps: { db: PrismaClient; cache?: GcsCache }) {}

  async getActor(
    req: { sessionToken?: string; staleSessionToken?: string; ip: string },
    now = new Date(),
  ): Promise<GcsActor> {
    const { db } = this.deps;
    const ipBanned = (await findActiveBan(db, { ip: req.ip }, now)) !== null;

    const session = req.sessionToken
      ? await db.session.findUnique({
          where: { token: req.sessionToken },
          select: {
            expiresAt: true,
            user: {
              select: {
                id: true,
                email: true,
                primaryGroupId: true,
                lastActiveAt: true,
                groups: { select: { groupId: true } },
              },
            },
          },
        })
      : null;

    if (!session || session.expiresAt <= now) {
      const revoked = req.sessionToken ?? req.staleSessionToken;
      const revokedByBan =
        revoked !== undefined && (await this.deps.cache?.get<boolean>(bannedSessionKey(revoked))) === true;
      return this.guest(req.ip, ipBanned || revokedByBan);
    }

    const { user } = session;
    const accountBanned = (await findActiveBan(db, { userId: user.id, email: user.email }, now)) !== null;
    if (accountBanned) {
      await db.session.deleteMany({ where: { userId: user.id } });
      return this.guest(req.ip, true);
    }
    if (ipBanned) return this.guest(req.ip, true);

    if (!user.lastActiveAt || now.getTime() - user.lastActiveAt.getTime() > ACTIVITY_THROTTLE_MS) {
      await db.user.update({ where: { id: user.id }, data: { lastActiveAt: now } });
    }

    return {
      userId: user.id,
      groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId).filter((id) => id !== user.primaryGroupId)],
      primaryGroupId: user.primaryGroupId,
      isBanned: false,
      ip: req.ip,
    };
  }

  private async guest(ip: string, isBanned: boolean): Promise<GcsActor> {
    this.guestGroupId ??= (
      await this.deps.db.group.findUniqueOrThrow({ where: { key: "guest" }, select: { id: true } })
    ).id;
    return { userId: null, groupIds: [this.guestGroupId], primaryGroupId: this.guestGroupId, isBanned, ip };
  }
}
