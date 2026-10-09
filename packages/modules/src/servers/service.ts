import { isIP, type BlockList } from "node:net";
import { GcsNotFound, GcsRateLimited, GcsValidationError, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsAttachmentService, type GcsEventBus, type GcsRedisRateLimiter } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { slugify } from "../forums/slug";
import { enabledGames } from "./games";
import { isQueryableAddress, normalizeHost, serversAllowNets } from "./net";
import { GcsPlayerStatsHub } from "./playerStats";
import { MAX_SERVERS, SERVERS_STATS_TAG, type GcsServerQueryFn } from "./poller";
import { queryGameServer } from "./query";
import type { GcsServerStatusStore } from "./store";
import type { GcsServerStatus } from "./types";

export const SERVERS_ACP_SECTION = "gaming.servers";
/** Atașamentul bannerului unui server (legat de id-ul serverului). */
export const SERVER_BANNER = "servers.banner";
/** Tag-ul cache-ului cu lista serverelor (pagini, widget, API). */
export const SERVERS_CACHE_TAG = "servers";

export const SERVER_LIMITS = { name: 80, description: 2000, admins: 20 } as const;
const TEST_LIMIT = { window: 60, max: 10 };

/**
 * Ce trimite formularul din ACP. `bannerId`: atașamentul încărcat acum (devine bannerul), `null` = scoate bannerul,
 * lipsă = neschimbat.
 */
export type GcsServerInput = {
  game: string;
  host: string;
  port: number;
  queryPort: number | null;
  name: string;
  description: string;
  forumId: number | null;
  groups: number[];
  adminIds: string[];
  enabled: boolean;
  bannerId?: string | null;
};

export type GcsServerTestInput = Pick<GcsServerInput, "game" | "host" | "port" | "queryPort">;

/** Un server în lista din ACP. */
export type GcsServerAcpRow = {
  id: number;
  game: string;
  name: string;
  slug: string;
  host: string;
  port: number;
  enabled: boolean;
  restricted: boolean;
  status: GcsServerStatus | null;
};

/** Un server în formularul de editare. */
export type GcsServerEdit = Omit<GcsServerInput, "adminIds" | "bannerId"> & {
  id: number;
  slug: string;
  bannerId: string | null;
  admins: { id: string; name: string }[];
};

type Normalized = Omit<GcsServerInput, "bannerId"> & { slug: string };

/** Textul scris de admin: fără caractere de control (rândurile noi rămân doar unde e voie). */
const plain = (v: unknown, keepNewlines: boolean) =>
  typeof v === "string"
    ? v
        .replace(/\r\n?/g, "\n")
        .replace(keepNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, keepNewlines ? "" : " ")
        .trim()
    : "";
const isPort = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65_535;

/** Slug-ul numelui (un nume fără litere latine primește „server”). */
export function serverSlug(name: string): string {
  const slug = slugify(name);
  return slug === "topic" && !/topic/i.test(name) ? "server" : slug;
}

/**
 * Serverele din ACP (specul 2026-10-07-servere §6): adăugarea, editarea (cu bannerul, adminii, vizibilitatea),
 * ordinea, ștergerea și butonul „Testează”. Fiecare scriere verifică dreptul pe secțiune și intră în jurnal.
 */
export class GcsServerService {
  private readonly query: GcsServerQueryFn;
  /**
   * Statisticile de joc ale membrilor (doar citire). Sistemul de statistici al serverelor își înregistrează aici
   * furnizorul (`playerStats.use(...)`); fără el, nimeni nu are statistici.
   */
  readonly playerStats = new GcsPlayerStatsHub();

  constructor(
    private readonly deps: {
      db: PrismaClient;
      bus: GcsEventBus;
      acp: GcsAcpRoleService;
      attachments: GcsAttachmentService;
      rateLimiter: GcsRedisRateLimiter;
      store: GcsServerStatusStore;
      query?: GcsServerQueryFn;
      allow?: () => BlockList | null;
    },
  ) {
    this.query = deps.query ?? queryGameServer;
  }

  private allow(): BlockList | null {
    return (this.deps.allow ?? serversAllowNets)();
  }

  async list(): Promise<GcsServerAcpRow[]> {
    const rows = await this.deps.db.gameServer.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    const statuses = await this.deps.store.many(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      game: r.game,
      name: r.name,
      slug: r.slug,
      host: r.host,
      port: r.port,
      enabled: r.enabled,
      restricted: r.groups.length > 0,
      status: r.enabled ? (statuses.get(r.id) ?? null) : null,
    }));
  }

  async get(id: number): Promise<GcsServerEdit | null> {
    const row = await this.deps.db.gameServer.findUnique({
      where: { id },
      include: { admins: { orderBy: { position: "asc" }, include: { user: { select: { id: true, name: true } } } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      game: row.game,
      host: row.host,
      port: row.port,
      queryPort: row.queryPort,
      name: row.name,
      slug: row.slug,
      description: row.description,
      forumId: row.forumId,
      groups: row.groups,
      enabled: row.enabled,
      bannerId: row.bannerId,
      admins: row.admins.map((a) => ({ id: a.user.id, name: a.user.name })),
    };
  }

  /** Validarea câmpurilor de rețea (și pentru „Testează”). */
  private validateTarget(input: Partial<GcsServerTestInput>, errors: Record<string, string>): { game: string; host: string; port: number; queryPort: number | null } {
    const game = typeof input.game === "string" && enabledGames().some((g) => g.key === input.game) ? input.game : "";
    if (!game) errors.game = "invalid";
    const host = normalizeHost(input.host);
    if (!host) errors.host = "invalid_host";
    // Un IP scris direct se verifică la salvare; un nume se verifică la fiecare interogare (DNS-ul se poate schimba).
    else if (isIP(host) !== 0 && !isQueryableAddress(host, this.allow())) errors.host = "blocked_address";
    if (!isPort(input.port)) errors.port = "invalid_range";
    if (input.queryPort !== null && input.queryPort !== undefined && !isPort(input.queryPort)) errors.queryPort = "invalid_range";
    return { game, host: host ?? "", port: input.port ?? 0, queryPort: input.queryPort ?? null };
  }

  private async validate(input: GcsServerInput): Promise<Normalized> {
    const { db } = this.deps;
    const errors: Record<string, string> = {};
    const target = this.validateTarget(input, errors);
    const name = plain(input.name, false).replace(/\s+/g, " ");
    if (!name || [...name].length > SERVER_LIMITS.name) errors.name = "required";
    const description = plain(input.description, true);
    if ([...description].length > SERVER_LIMITS.description) errors.description = "too_long";
    let forumId: number | null = null;
    if (input.forumId !== null && input.forumId !== undefined) {
      const forum = Number.isInteger(input.forumId) ? await db.forum.findUnique({ where: { id: input.forumId }, select: { type: true } }) : null;
      if (!forum || forum.type === "LINK") errors.forumId = "invalid";
      else forumId = input.forumId;
    }
    const groups = [...new Set(Array.isArray(input.groups) ? input.groups : [])];
    if (groups.length > 0) {
      const found = await db.group.count({ where: { id: { in: groups.filter(Number.isInteger) } } });
      if (found !== groups.length) errors.groups = "invalid";
    }
    const adminIds = [...new Set(Array.isArray(input.adminIds) ? input.adminIds.filter((a) => typeof a === "string") : [])];
    if (adminIds.length > SERVER_LIMITS.admins) errors.adminIds = "too_many";
    else if (adminIds.length > 0 && (await db.user.count({ where: { id: { in: adminIds } } })) !== adminIds.length) errors.adminIds = "invalid";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return { ...target, name, slug: serverSlug(name), description, forumId, groups, adminIds, enabled: input.enabled !== false };
  }

  /** Atașamentul ales ca banner: încărcat de admin (încă nelegat) sau bannerul curent al aceluiași server; doar imagini. */
  private async checkBanner(actor: GcsActor, bannerId: string, serverId: number | null): Promise<void> {
    const att = await this.deps.db.attachment.findUnique({ where: { id: bannerId } });
    const own = att && (att.contentType === null ? att.ownerId === actor.userId : att.contentType === SERVER_BANNER && serverId !== null && att.contentId === String(serverId));
    if (!att || !own || !att.mime.startsWith("image/")) throw new GcsValidationError({ banner: "invalid_image" });
  }

  async save(actor: GcsActor, id: number | null, input: GcsServerInput): Promise<{ id: number }> {
    const { db, acp, attachments, store } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const before = id === null ? null : await db.gameServer.findUnique({ where: { id }, include: { admins: { select: { userId: true } } } });
    if (id !== null && !before) throw new GcsNotFound();
    const data = await this.validate(input);
    if (typeof input.bannerId === "string") await this.checkBanner(actor, input.bannerId, id);
    if (id === null && (await db.gameServer.count()) >= MAX_SERVERS) throw new GcsValidationError({ servers: "too_many" });

    const { adminIds, ...fields } = data;
    let row;
    try {
      row = await db.$transaction(async (tx) => {
        const position = id === null ? ((await tx.gameServer.aggregate({ _max: { position: true } }))._max.position ?? -1) + 1 : undefined;
        const saved =
          id === null
            ? await tx.gameServer.create({ data: { ...fields, position: position! } })
            : await tx.gameServer.update({ where: { id }, data: fields });
        await tx.gameServerAdmin.deleteMany({ where: { serverId: saved.id } });
        if (adminIds.length > 0) await tx.gameServerAdmin.createMany({ data: adminIds.map((userId, i) => ({ serverId: saved.id, userId, position: i })) });
        await writeAudit(tx, {
          actorId: actor.userId,
          action: id === null ? "servers.create" : "servers.update",
          targetType: "game_server",
          targetId: String(saved.id),
          before: before ? { ...before, admins: before.admins.map((a) => a.userId) } : undefined,
          after: { ...fields, adminIds },
          ip: actor.ip,
        });
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new GcsValidationError({ host: "duplicate_server" });
      throw error;
    }

    // Bannerul: cel nou se leagă de server, cel vechi se șterge (și fișierul lui).
    if (input.bannerId !== undefined && input.bannerId !== before?.bannerId) {
      await attachments.deleteFor(SERVER_BANNER, [String(row.id)]);
      if (input.bannerId) await db.attachment.update({ where: { id: input.bannerId }, data: { contentType: SERVER_BANNER, contentId: String(row.id) } });
      await db.gameServer.update({ where: { id: row.id }, data: { bannerId: input.bannerId } });
    }
    // Altă adresă (sau alt joc): statusul vechi nu mai e valabil, serverul se interoghează la runda următoare.
    const moved = !before || before.game !== data.game || before.host !== data.host || before.port !== data.port || before.queryPort !== data.queryPort || !before.enabled;
    if (moved) await store.reset(row.id);
    await this.changed(row.id);
    return { id: row.id };
  }

  /**
   * Șterge serverul (meciurile, sesiunile și statisticile lui pe server pleacă odată cu el). Cu `purgePlayers` (ex. un
   * server de test) pleacă și jucătorii văzuți **numai** pe acest server, fără cont pe site, fără sancțiuni și fără
   * intrări de admin, cu ratingurile lor; ceilalți jucători rămân.
   */
  async remove(actor: GcsActor, id: number, opts: { purgePlayers?: boolean } = {}): Promise<void> {
    const { db, acp, attachments, store } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "delete");
    const before = await db.gameServer.findUnique({ where: { id } });
    if (!before) throw new GcsNotFound();
    await db.$transaction(async (tx) => {
      const purge = opts.purgePlayers ? await exclusivePlayers(tx, id) : [];
      await tx.gameServer.delete({ where: { id } });
      if (purge.length > 0) await tx.gamePlayer.deleteMany({ where: { id: { in: purge } } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "servers.delete",
        targetType: "game_server",
        targetId: String(id),
        before,
        ...(opts.purgePlayers ? { after: { purgedPlayers: purge.length } } : {}),
        ip: actor.ip,
      });
    });
    await attachments.deleteFor(SERVER_BANNER, [String(id)]);
    await store.reset(id);
    await this.changed(id);
  }

  /** Ordinea nouă: exact id-urile tuturor serverelor, fiecare o dată. */
  async reorder(actor: GcsActor, ids: number[]): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const existing = (await db.gameServer.findMany({ select: { id: true } })).map((r) => r.id).sort((a, b) => a - b);
    const given = Array.isArray(ids) ? [...ids].sort((a, b) => a - b) : [];
    if (new Set(ids).size !== ids.length || JSON.stringify(given) !== JSON.stringify(existing)) throw new GcsValidationError({ order: "invalid" });
    await db.$transaction(async (tx) => {
      for (const [position, id] of ids.entries()) await tx.gameServer.update({ where: { id }, data: { position } });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.reorder", targetType: "game_server", targetId: "order", after: ids, ip: actor.ip });
    });
    await this.changed(null);
  }

  /** „Testează” din formular: o interogare cu aceleași gărzi ca worker-ul, max 10 pe minut pe admin. */
  async test(actor: GcsActor, input: Partial<GcsServerTestInput>): Promise<GcsServerStatus> {
    const { acp, rateLimiter } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const target = this.validateTarget(input, errors);
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    const limit = await rateLimiter.consume(`servers-test:${actor.userId}`, TEST_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    return this.query(target, { allow: this.allow(), players: true });
  }

  private async changed(id: number | null): Promise<void> {
    await this.deps.bus.emit({ name: "servers.updated", payload: { id }, tags: [SERVERS_CACHE_TAG, SERVERS_STATS_TAG] });
  }
}

/** Jucătorii văzuți numai pe serverul dat (sesiuni, statistici, meciuri), fără cont pe site, sancțiuni sau admin. */
async function exclusivePlayers(tx: Prisma.TransactionClient, serverId: number): Promise<number[]> {
  const seen = new Set<number>();
  const add = (rows: { playerId: number }[]) => rows.forEach((r) => seen.add(r.playerId));
  add(await tx.gameSession.findMany({ where: { serverId }, select: { playerId: true }, distinct: ["playerId"] }));
  add(await tx.gamePlayerStat.findMany({ where: { serverId }, select: { playerId: true } }));
  add(await tx.gameWeaponStat.findMany({ where: { serverId }, select: { playerId: true }, distinct: ["playerId"] }));
  add(await tx.gameMapStat.findMany({ where: { serverId }, select: { playerId: true }, distinct: ["playerId"] }));
  add(await tx.gameMatchPlayer.findMany({ where: { match: { serverId } }, select: { playerId: true }, distinct: ["playerId"] }));
  if (seen.size === 0) return [];
  const other = { not: serverId };
  const rows = await tx.gamePlayer.findMany({
    where: {
      id: { in: [...seen] },
      userId: null,
      sessions: { none: { serverId: other } },
      stats: { none: { serverId: other } },
      weaponStats: { none: { serverId: other } },
      mapStats: { none: { serverId: other } },
      matches: { none: { match: { serverId: other } } },
      sanctions: { none: {} },
      adminEntries: { none: {} },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
