import type { PrismaClient } from "@gcs/db";

export type GcsConnectionPanel = { provider: string; accountId: string; linkedAt: Date }[];
export type GcsIdentityPanel = { id: number; kind: string; value: string; name: string; trust: string; lastSeenAt: Date; linkedAt: Date | null }[];
export type GcsEloPanel = { elo: number; peak: number; matches: number; wins: number; losses: number; draws: number } | null;
export type GcsSanctionPanel = { id: number; type: string; scope: string; reason: string; createdAt: Date; expiresAt: Date | null; unbannedAt: Date | null; adminName: string; serverName: string | null }[];
export type GcsClanPanel = { id: number; tag: string; name: string; slug: string; role: string; joinedAt: Date }[];

/**
 * Datele panourilor de membru aduse de aplicații (Membri v2): conturile legate (Profil), identitățile de joc, ELO-ul mix
 * și sancțiunile de pe servere (Servere), clanul (Clanuri). Doar citire; cine afișează verifică dacă aplicația e pornită
 * (vezi `GcsModuleRegistry.memberPanels`).
 */
export class GcsMemberPanelData {
  constructor(private readonly deps: { db: PrismaClient }) {}

  /** Conturile legate (fără parola, fără tokenuri): Steam, Discord, Google. */
  async connections(userId: string): Promise<GcsConnectionPanel> {
    const rows = await this.deps.db.account.findMany({ where: { userId, providerId: { not: "credential" } }, select: { providerId: true, accountId: true, createdAt: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ provider: r.providerId, accountId: r.accountId, linkedAt: r.createdAt }));
  }

  async gameIdentities(userId: string): Promise<GcsIdentityPanel> {
    const rows = await this.deps.db.gamePlayer.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, kind: true, value: true, name: true, trust: true, lastSeenAt: true, linkedAt: true } });
    return rows;
  }

  /** ELO-ul mix (cel mai bun dintre identitățile legate). */
  async mixElo(userId: string): Promise<GcsEloPanel> {
    const best = await this.deps.db.gameRating.findFirst({ where: { player: { userId } }, orderBy: { elo: "desc" }, select: { elo: true, peak: true, matches: true, wins: true, losses: true, draws: true } });
    return best;
  }

  async serverSanctions(userId: string): Promise<GcsSanctionPanel> {
    const rows = await this.deps.db.gameSanction.findMany({
      where: { player: { userId } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, scope: true, reason: true, createdAt: true, expiresAt: true, unbannedAt: true, adminName: true, server: { select: { name: true } } },
    });
    return rows.map(({ server, ...r }) => ({ ...r, serverName: server?.name ?? null }));
  }

  async clanMembership(userId: string): Promise<GcsClanPanel> {
    const rows = await this.deps.db.clanMember.findMany({ where: { userId }, select: { role: true, joinedAt: true, clan: { select: { id: true, tag: true, name: true, slug: true } } } });
    return rows.map((r) => ({ ...r.clan, role: r.role, joinedAt: r.joinedAt }));
  }
}
