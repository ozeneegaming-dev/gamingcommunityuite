import type { PrismaClient } from "@gcs/db";
import type { GcsCache } from "../cache";
import { bannedSessionKey, findActiveBan } from "../moderation/bans";
import type { GcsActor } from "../permissions/types";
import { guestPresenceId, type GcsPresenceService, type GcsPresenceViewer } from "../presence/presence";

/** `lastActiveAt` se actualizează cel mult o dată la 5 minute (pentru „cine e online”), nu la fiecare request. */
const ACTIVITY_THROTTLE_MS = 5 * 60_000;
/** Prezența în Redis se notează cel mult o dată pe minut pentru același vizitator, din același proces. */
const PRESENCE_THROTTLE_MS = 60_000;
const PRESENCE_MEMO_MAX = 10_000;

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
  private readonly lastTouch = new Map<string, number>();

  constructor(private readonly deps: { db: PrismaClient; cache?: GcsCache; presence?: Pick<GcsPresenceService, "touch"> }) {}

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
      return this.guest(req.ip, ipBanned || revokedByBan, now);
    }

    const { user } = session;
    const accountBanned = (await findActiveBan(db, { userId: user.id, email: user.email }, now)) !== null;
    if (accountBanned) {
      await db.session.deleteMany({ where: { userId: user.id } });
      return this.guest(req.ip, true, now);
    }
    if (ipBanned) return this.guest(req.ip, true, now);

    if (!user.lastActiveAt || now.getTime() - user.lastActiveAt.getTime() > ACTIVITY_THROTTLE_MS) {
      await db.user.update({ where: { id: user.id }, data: { lastActiveAt: now } });
    }

    await this.touchPresence({ userId: user.id }, now);
    return {
      userId: user.id,
      groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId).filter((id) => id !== user.primaryGroupId)],
      primaryGroupId: user.primaryGroupId,
      isBanned: false,
      ip: req.ip,
    };
  }

  /**
   * Actorul unui user cunoscut după id (ex. din tokenul `gcs-realtime`), fără sesiune: grupurile și bannurile active.
   * Un user banat sau inexistent → vizitator (banat, respectiv nu). Nu notează prezența.
   */
  async forUser(userId: string, ip: string, now = new Date()): Promise<GcsActor> {
    const { db } = this.deps;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, primaryGroupId: true, groups: { select: { groupId: true } } },
    });
    if (!user) return this.guestActor(ip, false);
    const banned =
      (await findActiveBan(db, { userId: user.id, email: user.email }, now)) !== null || (await findActiveBan(db, { ip }, now)) !== null;
    if (banned) return this.guestActor(ip, true);
    return {
      userId: user.id,
      groupIds: [user.primaryGroupId, ...user.groups.map((g) => g.groupId).filter((id) => id !== user.primaryGroupId)],
      primaryGroupId: user.primaryGroupId,
      isBanned: false,
      ip,
    };
  }

  /** Un vizitator (fără sesiune), banat dacă IP-ul are un ban activ. Nu notează prezența. */
  async forGuest(ip: string, now = new Date()): Promise<GcsActor> {
    return this.guestActor(ip, (await findActiveBan(this.deps.db, { ip }, now)) !== null);
  }

  private async guest(ip: string, isBanned: boolean, now: Date): Promise<GcsActor> {
    if (!isBanned) await this.touchPresence({ guestId: guestPresenceId(ip) }, now);
    return this.guestActor(ip, isBanned);
  }

  private async guestActor(ip: string, isBanned: boolean): Promise<GcsActor> {
    this.guestGroupId ??= (
      await this.deps.db.group.findUniqueOrThrow({ where: { key: "guest" }, select: { id: true } })
    ).id;
    return { userId: null, groupIds: [this.guestGroupId], primaryGroupId: this.guestGroupId, isBanned, ip };
  }

  /** „Cine e online” (prezența în Redis); o eroare Redis nu oprește request-ul. */
  private async touchPresence(viewer: GcsPresenceViewer, now: Date): Promise<void> {
    if (!this.deps.presence) return;
    const id = "userId" in viewer ? `u:${viewer.userId}` : `g:${viewer.guestId}`;
    const last = this.lastTouch.get(id);
    if (last !== undefined && now.getTime() - last < PRESENCE_THROTTLE_MS) return;
    if (this.lastTouch.size >= PRESENCE_MEMO_MAX) this.lastTouch.clear();
    this.lastTouch.set(id, now.getTime());
    await this.deps.presence.touch(viewer, now.getTime()).catch((error: unknown) => {
      console.error("[gcs] notarea prezenței a eșuat", error);
    });
  }
}
