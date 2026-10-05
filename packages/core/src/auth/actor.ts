import type { BanType, PrismaClient } from "@gcs/db";
import type { GcsActor } from "../permissions/types";

/**
 * Rezolvă cine face request-ul (spec §6.3): sesiunea, grupurile și bannurile active (cont, email, IP).
 * La un ban de cont, șterge sesiunile userului și întoarce un vizitator cu `isBanned: true`.
 */
export class GcsActorResolver {
  private guestGroupId: number | undefined;

  constructor(private readonly deps: { db: PrismaClient }) {}

  async getActor(req: { sessionToken?: string; ip: string }, now = new Date()): Promise<GcsActor> {
    const { db } = this.deps;
    const ipBanned = await this.hasActiveBan([{ type: "IP", value: req.ip }], now);

    const session = req.sessionToken
      ? await db.session.findUnique({
          where: { token: req.sessionToken },
          select: {
            expiresAt: true,
            user: { select: { id: true, email: true, primaryGroupId: true, groups: { select: { groupId: true } } } },
          },
        })
      : null;

    if (!session || session.expiresAt <= now) return this.guest(req.ip, ipBanned);

    const { user } = session;
    const accountBanned = await this.hasActiveBan(
      [
        { type: "ACCOUNT", userId: user.id },
        { type: "EMAIL", value: user.email },
      ],
      now,
    );
    if (accountBanned) {
      await db.session.deleteMany({ where: { userId: user.id } });
      return this.guest(req.ip, true);
    }
    if (ipBanned) return this.guest(req.ip, true);

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

  private async hasActiveBan(
    match: ({ type: BanType; value: string } | { type: BanType; userId: string })[],
    now: Date,
  ): Promise<boolean> {
    const ban = await this.deps.db.ban.findFirst({
      where: {
        OR: match,
        liftedAt: null,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { id: true },
    });
    return ban !== null;
  }
}
