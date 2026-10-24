import { createHash, randomInt } from "node:crypto";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError, writeAudit, type GcsActor, type GcsEventBus, type GcsPermissionService } from "@gcs/core";
import { Prisma, type GamePlayerKind, type PrismaClient, ci, sql, isMysql } from "@gcs/db";
import { BRIDGE_PERMISSION } from "./config";
import { parseTypedIdentity, resolveIdentity, type GcsPlayerRef, type GcsResolvedIdentity } from "./identity";
import type { GcsBridgeStore } from "./store";
import { GcsBridgeError, type GcsBridgeServer, type GcsPlayerRow } from "./types";

/** Alfabetul codurilor de legare: fără 0/O și 1/I. */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_TTL_MS = 10 * 60_000;
const LINK_CODES_PER_HOUR = 5;
/** Încercările cu cod greșit: pe server și pe identitate, pe minut. */
const WRONG_PER_SERVER = 10;
const WRONG_PER_IDENTITY = 5;

/** O identitate cum se arată pe site (profil, ACP). */
export type GcsPlayerView = {
  id: number;
  kind: GamePlayerKind;
  value: string;
  trust: string;
  name: string;
  user: { id: string; name: string } | null;
  linkSource: string | null;
  linkedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastServerId: number | null;
};

const hashCode = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");

/** Codul scris în joc: litere mari, fără spații; `null` dacă nu are forma unui cod. */
export function normalizeLinkCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/\s+/g, "").toUpperCase();
  return code.length === 6 && [...code].every((c) => LINK_CODE_ALPHABET.includes(c)) ? code : null;
}

/**
 * Identitățile de joc (specul 2026-10-08-servere-bridge §3): stabilirea identității din referința trimisă de server,
 * legarea de membri (Steam automat, codul din joc, staff-ul), dezlegarea și reconcilierea legăturilor Steam. Orice
 * schimbare de legătură crește versiunea listelor (adminii și VIP-ul membrilor depind de identitățile lor).
 */
export class GcsBridgePlayers {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      permissions: GcsPermissionService;
      store: GcsBridgeStore;
      now?: () => number;
    },
  ) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  /** Identitatea (fără scriere) din referința unui jucător. */
  identify(ref: GcsPlayerRef, server: GcsBridgeServer): GcsResolvedIdentity | null {
    return resolveIdentity(ref, server);
  }

  /**
   * Identitatea din referință, creată sau actualizată (ultimul nume, ultima apariție, ultimul server). La prima apariție,
   * o identitate Steam se leagă automat de membrul cu același cont Steam conectat. `null` = jucător neurmărit.
   */
  async resolveRef(ref: GcsPlayerRef, server: GcsBridgeServer, at: Date = this.now()): Promise<GcsPlayerRow | null> {
    const identity = resolveIdentity(ref, server);
    return identity ? this.upsert(identity, server.id, at) : null;
  }

  async upsert(identity: GcsResolvedIdentity, serverId: number | null, at: Date = this.now()): Promise<GcsPlayerRow> {
    const { db } = this.deps;
    const upsert = sql`
      INSERT INTO game_players (kind, value, trust, name, "firstSeenAt", "lastSeenAt", "lastServerId")
      VALUES (${identity.kind}::"GamePlayerKind", ${identity.value}, ${identity.trust}::"GameTrust", ${identity.name}, ${at.toISOString()}::timestamp, ${at.toISOString()}::timestamp, ${serverId})
      ON CONFLICT (kind, value) DO UPDATE SET
        name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE game_players.name END,
        "lastSeenAt" = GREATEST(game_players."lastSeenAt", EXCLUDED."lastSeenAt"),
        "lastServerId" = CASE WHEN EXCLUDED."lastSeenAt" >= game_players."lastSeenAt" THEN COALESCE(EXCLUDED."lastServerId", game_players."lastServerId") ELSE game_players."lastServerId" END`;
    let row: GcsPlayerRow & { created: boolean };
    if (isMysql()) {
      // MySQL: fără `RETURNING`; 1 rând afectat = inserat, 2 = actualizat (0 = neschimbat).
      const affected = await db.$executeRaw(upsert);
      const found = await db.gamePlayer.findUniqueOrThrow({ where: { kind_value: { kind: identity.kind, value: identity.value } }, select: { id: true, kind: true, value: true, userId: true, name: true } });
      row = { ...found, created: affected === 1 };
    } else {
      row = (await db.$queryRaw<(GcsPlayerRow & { created: boolean })[]>(sql`${upsert} RETURNING id, kind, value, "userId", name, (xmax = 0) AS created`))[0]!;
    }
    const player: GcsPlayerRow = { id: row.id, kind: row.kind, value: row.value, userId: row.userId, name: row.name };
    if (row.created && player.kind === "STEAM" && !player.userId) {
      const account = await db.account.findFirst({ where: { providerId: "steam", accountId: player.value }, select: { userId: true } });
      if (account) {
        await db.gamePlayer.updateMany({ where: { id: player.id, userId: null }, data: { userId: account.userId, linkSource: "STEAM", linkedAt: at } });
        player.userId = account.userId;
        await this.deps.store.bumpVersion();
      }
    }
    return player;
  }

  async get(id: number): Promise<GcsPlayerView | null> {
    const row = await this.deps.db.gamePlayer.findUnique({ where: { id }, include: { user: { select: { id: true, name: true } } } });
    return row ? toView(row) : null;
  }

  /** Identitățile legate de un membru (cele Steam primele). */
  async byUser(userId: string): Promise<GcsPlayerView[]> {
    const rows = await this.deps.db.gamePlayer.findMany({ where: { userId }, include: { user: { select: { id: true, name: true } } }, orderBy: [{ kind: "asc" }, { lastSeenAt: "desc" }] });
    return rows.map(toView);
  }

  /** Căutarea după nume (conține) sau după ID (orice formă SteamID, ID non-Steam). */
  async search(q: string, limit = 20): Promise<GcsPlayerView[]> {
    const text = q.trim().slice(0, 64);
    if (text.length < 2) return [];
    const typed = [parseTypedIdentity(text, "steam"), parseTypedIdentity(text, "nonsteam")].filter((x) => x !== null);
    const rows = await this.deps.db.gamePlayer.findMany({
      where: { OR: [{ name: ci({ contains: text }) }, ...typed.map((t) => ({ kind: t.kind, value: t.value }))] },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map(toView);
  }

  /**
   * Un cod de legare nou pentru membru (Setări → Cont): 6 caractere, valabil 10 minute, o singură folosire; un cod nou
   * îl anulează pe cel vechi; max 5 pe oră. Întoarce codul în clar (singura dată când există în clar).
   */
  async createLinkCode(actor: GcsActor): Promise<{ code: string; expiresAt: string }> {
    const { db, permissions } = this.deps;
    if (!actor.userId || actor.isBanned) throw new GcsForbidden({ permission: BRIDGE_PERMISSION.linkIdentity });
    await permissions.assert(actor, BRIDGE_PERMISSION.linkIdentity);
    const now = this.now();
    const recent = await db.gameLinkCode.count({ where: { userId: actor.userId, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } });
    if (recent >= LINK_CODES_PER_HOUR) throw new GcsRateLimited({ retryAfter: "3600" });
    const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 6 }, () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)]).join("");
      try {
        await db.$transaction([
          db.gameLinkCode.updateMany({ where: { userId: actor.userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } }),
          db.gameLinkCode.create({ data: { userId: actor.userId, codeHash: hashCode(code), expiresAt, createdAt: now } }),
        ]);
        return { code, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    throw new Error("Nu s-a putut genera un cod de legare unic");
  }

  /**
   * `POST /link`: jucătorul a scris `/gcs COD` în joc. Codul există, nu e folosit, nu a expirat; identitatea nu e Steam
   * (Steam se leagă doar prin login-ul de pe site) și nu e legată de alt membru. Încercările greșite sunt limitate.
   */
  async linkFromGame(server: GcsBridgeServer, ref: GcsPlayerRef, rawCode: unknown): Promise<{ ok: true; user: string }> {
    const { db, store, bus } = this.deps;
    const now = this.now();
    const identity = resolveIdentity(ref, server);
    const identityKey = identity ? `link:i:${identity.kind}:${identity.value}` : null;
    if ((await store.failures(`link:s:${server.id}`)) >= WRONG_PER_SERVER || (identityKey && (await store.failures(identityKey)) >= WRONG_PER_IDENTITY)) {
      throw new GcsBridgeError("rate_limited", 429);
    }
    const wrong = async (code: string, status: number) => {
      await store.fail(`link:s:${server.id}`, 60);
      if (identityKey) await store.fail(identityKey, 60);
      return new GcsBridgeError(code, status);
    };
    const code = normalizeLinkCode(rawCode);
    if (!code) throw await wrong("invalid_code", 400);
    const row = await db.gameLinkCode.findUnique({ where: { codeHash: hashCode(code) }, include: { user: { select: { id: true, name: true } } } });
    if (!row) throw await wrong("invalid_code", 400);
    if (row.usedAt) throw await wrong("used_code", 400);
    if (row.expiresAt <= now) throw await wrong("expired_code", 400);
    if (!identity) throw new GcsBridgeError("no_identity", 422);
    if (identity.kind === "STEAM") throw new GcsBridgeError("steam_use_site", 403);
    const player = await this.upsert(identity, server.id, now);
    if (player.userId && player.userId !== row.userId) throw new GcsBridgeError("already_linked", 409);

    await db.$transaction(async (tx) => {
      const claimed = await tx.gameLinkCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now, playerId: player.id } });
      if (claimed.count === 0) throw new GcsBridgeError("used_code", 400);
      const linked = await tx.gamePlayer.updateMany({
        where: { id: player.id, OR: [{ userId: null }, { userId: row.userId }] },
        data: { userId: row.userId, linkSource: "CODE", linkedAt: now },
      });
      if (linked.count === 0) throw new GcsBridgeError("already_linked", 409);
      await writeAudit(tx, { actorId: row.userId, action: "servers.player.link", targetType: "game_player", targetId: String(player.id), after: { userId: row.userId, source: "CODE", serverId: server.id } });
    });
    await store.bumpVersion();
    await bus.emit({ name: "servers.player.linked", payload: { userId: row.userId, playerId: player.id, source: "CODE" }, tags: [] });
    return { ok: true, user: row.user.name };
  }

  /** Membrul își dezleagă o identitate non-Steam (Steam se dezleagă odată cu contul Steam de pe site). */
  async unlinkOwn(actor: GcsActor, playerId: number): Promise<void> {
    const { db, store } = this.deps;
    if (!actor.userId) throw new GcsForbidden();
    const player = await db.gamePlayer.findUnique({ where: { id: playerId } });
    if (!player || player.userId !== actor.userId) throw new GcsNotFound();
    if (player.kind === "STEAM" && player.linkSource === "STEAM") throw new GcsValidationError({ player: "steam_unlink_account" });
    await db.$transaction(async (tx) => {
      await tx.gamePlayer.update({ where: { id: playerId }, data: { userId: null, linkSource: null, linkedAt: null } });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.player.unlink", targetType: "game_player", targetId: String(playerId), before: { userId: actor.userId }, ip: actor.ip });
    });
    await store.bumpVersion();
  }

  /** Staff-ul (`servers.players_manage`) leagă o identitate de un membru (`userId`) sau o dezleagă (`null`). */
  async staffLink(actor: GcsActor, playerId: number, userId: string | null): Promise<void> {
    const { db, permissions, store, bus } = this.deps;
    await permissions.assert(actor, BRIDGE_PERMISSION.playersManage);
    const player = await db.gamePlayer.findUnique({ where: { id: playerId } });
    if (!player) throw new GcsNotFound();
    if (userId !== null && !(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new GcsValidationError({ userId: "invalid" });
    if (player.userId === userId) return;
    const now = this.now();
    await db.$transaction(async (tx) => {
      await tx.gamePlayer.update({ where: { id: playerId }, data: userId ? { userId, linkSource: "STAFF", linkedAt: now } : { userId: null, linkSource: null, linkedAt: null } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: userId ? "servers.player.link" : "servers.player.unlink",
        targetType: "game_player",
        targetId: String(playerId),
        before: { userId: player.userId },
        after: { userId, source: "STAFF" },
        ip: actor.ip,
      });
    });
    await store.bumpVersion();
    if (userId) await bus.emit({ name: "servers.player.linked", payload: { userId, playerId, source: "STAFF" }, tags: [] });
  }

  /**
   * Legăturile Steam ale unui membru, după conturile Steam conectate pe site: identitatea `STEAM` cu același SteamID64 e
   * a lui (dovada Steam câștigă), iar cele legate prin Steam fără cont se dezleagă. O identitate încă nevăzută în joc nu se
   * creează: se leagă la prima apariție (`upsert`). Chemat la conectarea / dezlegarea Steam-ului și de jobul de reconciliere.
   */
  async syncSteam(userId: string): Promise<number> {
    const { db } = this.deps;
    const accounts = (await db.account.findMany({ where: { userId, providerId: "steam" }, select: { accountId: true } })).map((a) => a.accountId).filter((id) => /^\d{17}$/.test(id));
    const now = this.now();
    const linked =
      accounts.length === 0
        ? { count: 0 }
        : await db.gamePlayer.updateMany({
            // Explicit și pentru NULL: o comparație cu NULL nu e nici adevărată, nici falsă în SQL.
            where: { kind: "STEAM", value: { in: accounts }, OR: [{ userId: null }, { userId: { not: userId } }, { linkSource: null }, { linkSource: { not: "STEAM" } }] },
            data: { userId, linkSource: "STEAM", linkedAt: now },
          });
    let changed = linked.count;
    const stale = await db.gamePlayer.updateMany({ where: { userId, kind: "STEAM", linkSource: "STEAM", value: { notIn: accounts } }, data: { userId: null, linkSource: null, linkedAt: null } });
    changed += stale.count;
    if (changed > 0) await this.deps.store.bumpVersion();
    return changed;
  }

  /** Jobul `servers.bridge.steam` (la 10 minute): repară orice diferență între conturile Steam și identitățile legate. */
  async reconcileSteam(): Promise<number> {
    const { db } = this.deps;
    const fromAccounts = await db.$queryRaw<{ userId: string }[]>(sql`
      SELECT DISTINCT a."userId" FROM accounts a
      JOIN game_players p ON p.kind = 'STEAM' AND p.value = a."accountId"
      WHERE a."providerId" = 'steam' AND (p."userId" IS DISTINCT FROM a."userId" OR p."linkSource" IS DISTINCT FROM 'STEAM')`);
    const fromPlayers = await db.$queryRaw<{ userId: string }[]>(sql`
      SELECT DISTINCT p."userId" FROM game_players p
      WHERE p.kind = 'STEAM' AND p."linkSource" = 'STEAM' AND p."userId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."providerId" = 'steam' AND a."accountId" = p.value AND a."userId" = p."userId")`);
    let changed = 0;
    for (const userId of new Set([...fromAccounts, ...fromPlayers].map((r) => r.userId))) changed += await this.syncSteam(userId);
    return changed;
  }
}

function toView(row: {
  id: number;
  kind: GamePlayerKind;
  value: string;
  trust: string;
  name: string;
  user: { id: string; name: string } | null;
  linkSource: string | null;
  linkedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastServerId: number | null;
}): GcsPlayerView {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    trust: row.trust,
    name: row.name,
    user: row.user,
    linkSource: row.linkSource,
    linkedAt: row.linkedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastServerId: row.lastServerId,
  };
}

