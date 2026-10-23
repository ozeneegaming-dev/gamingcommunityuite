import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { isIP, type BlockList } from "node:net";
import {
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsAppService,
  type GcsRateLimiter,
  type GcsSettingsService,
} from "@gcs/core";
import { Prisma, type GameServerEnrollment, type PrismaClient } from "@gcs/db";
import { isQueryableAddress, parseAllowNets } from "../net";
import { SERVERS_APP, type GcsServerQueryFn } from "../poller";
import { SERVERS_ACP_SECTION, SERVER_LIMITS } from "../service";
import { cleanGameText } from "../text";
import type { GcsBridgeHttpResponse } from "./api";
import { BRIDGE_SETTING, enrollBlockedError, isBridgeGame } from "./config";
import type { GcsBridgeKeys } from "./keys";
import type { GcsBridgeStore } from "./store";

/**
 * Înrolarea automată a serverelor necunoscute (specul 2026-10-08-servere-plugin-v2 §5): pluginul general (cu adresa
 * site-ului, fără cheie) cere o cheie; site-ul notează cererea cu IP-ul sursei, verifică prin interogarea aplicației că
 * la acel IP:port răspunde un server de joc real, iar un admin o aprobă (server nou sau atașat), o respinge sau
 * blochează IP-ul. După aprobare, cheia se creează și se livrează o singură dată celui care dovedește secretul.
 */

const DAY = 86_400_000;
/** O înrolare în așteptare (sau aprobată și neridicată) expiră după 7 zile. */
export const ENROLL_TTL_DAYS = 7;
/** Cele respinse și cele livrate rămân 30 de zile (pluginul cu același secret află că a fost respins). */
const KEEP_DAYS = 30;
/** Cât se arată în ACP înrolările decise. */
const RECENT_DAYS = 7;
export const ENROLL_MAX_BODY = 4096;
export const MAX_PENDING = 50;
export const MAX_PENDING_PER_IP = 5;
const ENROLL_LIMIT = { window: 3600, max: 10 };
const STATUS_LIMIT = { window: 60, max: 30 };
const RECHECK_LIMIT = { window: 60, max: 10 };
/** La fel ca limita eșecurilor de autentificare a protocolului (aceeași cheie Redis). */
const AUTH_FAILS_PER_MINUTE = 30;
const CHECK_RETRY_MS = 5 * 60_000;
const CHECK_TIMEOUT_MS = 3000;
export const MAX_DELIVERIES = 3;
/** Pluginul întreabă starea la 60 s (răspunsul `retryAfter`). */
const POLL_SECONDS = 60;
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;
const REF = /^[a-z0-9]{24}$/;
const REF_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
/** Porturile de joc acceptate (fără porturile privilegiate ale altor servicii). */
const PORT_MIN = 1024;
const PORT_MAX = 65_535;
/** Folderul A2S al fiecărui joc cu punte. */
export const GAME_FOLDER: Record<string, string> = { cs16: "cstrike", cs2: "csgo" };

export type GcsEnrollCheckResult = "ok" | "game_mismatch" | "offline" | "blocked";

/** Rezultatul interogării IP:port-ului unei înrolări (afișat în ACP). Textele vin de la server: curățate. */
export type GcsEnrollCheck = {
  result: GcsEnrollCheckResult;
  error: string | null;
  name: string | null;
  map: string | null;
  players: number | null;
  maxPlayers: number | null;
  folder: string | null;
  /** Numele / harta interogate sunt cele raportate de plugin. */
  nameMatch: boolean;
  mapMatch: boolean;
};

export type GcsEnrollmentView = {
  id: number;
  game: string;
  ip: string;
  port: number;
  hostname: string;
  map: string | null;
  players: number;
  maxPlayers: number;
  plugin: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  check: GcsEnrollCheck | null;
  checkedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  decidedAt: string | null;
  server: { id: number; name: string } | null;
  delivered: boolean;
  /** Altă înrolare în așteptare cere același joc și IP:port (atenție: una poate fi falsă). */
  duplicate: boolean;
  /** Serverul existent cu aceeași adresă (atașarea implicită). */
  sameAddress: { id: number; name: string } | null;
};

type Row = GameServerEnrollment;
type Deps = {
  db: PrismaClient;
  apps: GcsAppService;
  settings: GcsSettingsService;
  acp: GcsAcpRoleService;
  rateLimiter: GcsRateLimiter;
  store: GcsBridgeStore;
  keys: GcsBridgeKeys;
  query: GcsServerQueryFn;
  allow: () => BlockList | null;
  /** Crearea unui server în aplicația Servere (validarea și jurnalul ei, `servers.create`). */
  createServer: (actor: GcsActor, input: { game: string; host: string; port: number; name: string }) => Promise<{ id: number }>;
  now?: () => number;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const count = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.trunc(v))) : 0);
export const secretHash = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");
const sameText = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** IPv4 mapat în IPv6 (`::ffff:a.b.c.d`) se judecă după regulile IPv4. */
function unmapped(ip: string): string {
  return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
}

/** IP-ul e în lista blocată (setarea; IP-uri sau CIDR-uri). */
export function isBlockedIp(list: string, ip: string): boolean {
  const blocked = parseAllowNets(list);
  const address = unmapped(ip);
  const family = isIP(address);
  return !!blocked && family !== 0 && blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

function newRef(): string {
  return Array.from({ length: 24 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join("");
}

function view(r: Row & { server: { id: number; name: string } | null }, extra: { duplicate: boolean; sameAddress: { id: number; name: string } | null }): GcsEnrollmentView {
  return {
    id: r.id,
    game: r.game,
    ip: r.ip,
    port: r.port,
    hostname: r.hostname,
    map: r.map,
    players: r.players,
    maxPlayers: r.maxPlayers,
    plugin: r.plugin,
    status: r.status,
    check: (r.check as GcsEnrollCheck | null) ?? null,
    checkedAt: r.checkedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    server: r.server,
    delivered: r.deliveredAt !== null,
    ...extra,
  };
}

export class GcsBridgeEnrollments {
  constructor(private readonly deps: Deps) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  // ─── Protocolul (fără cheie) ────────────────────────────────────────────

  /**
   * `POST /enroll` și `POST /enroll/status` (§5.2–5.3). Aplicația activă e verificată de `GcsBridgeApi.handle`; aici:
   * corpul, setarea, lista blocată, limitele pe IP, apoi ruta.
   */
  async handle(req: { route: string; method: string; body: Buffer; ip: string }): Promise<GcsBridgeHttpResponse> {
    const serverTime = Math.floor(this.now().getTime() / 1000);
    const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): GcsBridgeHttpResponse => ({
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-GCS-Time": String(serverTime), ...headers },
      body: JSON.stringify({ ...body, serverTime }),
    });
    if (req.method.toUpperCase() !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    if (req.body.length > ENROLL_MAX_BODY) return json(413, { error: "too_large" });
    if (!(await this.deps.apps.enabled(SERVERS_APP))) return json(404, { error: "not_found" });
    if (isBlockedIp(await this.deps.settings.get<string>(BRIDGE_SETTING.enrollBlockedIps), req.ip)) return json(403, { error: "blocked" });
    let body: Record<string, unknown>;
    try {
      body = obj(JSON.parse(req.body.toString("utf8")));
    } catch {
      return json(400, { error: "invalid_json" });
    }
    try {
      if (req.route === "/enroll") {
        if (!(await this.deps.settings.get<boolean>(BRIDGE_SETTING.enrollEnabled))) return json(403, { error: "enroll_disabled" });
        const limit = await this.deps.rateLimiter.consume(`bridge-enroll:${req.ip}`, ENROLL_LIMIT);
        if (!limit.allowed) return json(429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfter ?? 60) });
        const out = await this.enroll(req.ip, body);
        return "error" in out ? json(out.status, { error: out.error }) : json(200, out.body);
      }
      const limit = await this.deps.rateLimiter.consume(`bridge-enroll-status:${req.ip}`, STATUS_LIMIT);
      if (!limit.allowed) return json(429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfter ?? 60) });
      if ((await this.deps.store.failures(`auth:${req.ip}`)) >= AUTH_FAILS_PER_MINUTE) return json(429, { error: "rate_limited" }, { "Retry-After": "60" });
      const out = await this.status(req.ip, body);
      if (out === null) {
        await this.deps.store.fail(`auth:${req.ip}`, 60);
        return json(404, { error: "unknown_enrollment" });
      }
      return isFailure(out) ? json(out.status, { error: out.error }) : json(200, out);
    } catch (error) {
      if (error instanceof GcsBadRequest) return json(400, { error: error.code });
      throw error;
    }
  }

  /** O cerere nouă (sau repetată, cu același secret): validarea, plafoanele, interogarea. */
  private async enroll(ip: string, b: Record<string, unknown>): Promise<{ body: Record<string, unknown> } | { error: string; status: number }> {
    const { db } = this.deps;
    const game = typeof b.game === "string" && isBridgeGame(b.game) ? b.game : null;
    if (!game) throw new GcsBadRequest("invalid_game");
    const port = typeof b.port === "number" && Number.isInteger(b.port) && b.port >= PORT_MIN && b.port <= PORT_MAX ? b.port : null;
    if (port === null) throw new GcsBadRequest("invalid_port");
    if (typeof b.secret !== "string" || !SECRET.test(b.secret)) throw new GcsBadRequest("invalid_secret");
    const now = this.now();
    // Datele raportate nu sunt de încredere: curățate ca orice text venit din joc, numerele tăiate la intervale.
    const data = {
      hostname: cleanGameText(b.hostname, 128),
      map: cleanGameText(b.map, 64) || null,
      players: count(b.players, 256),
      maxPlayers: count(b.maxPlayers, 256),
      plugin: cleanGameText(b.plugin, 64),
      lastSeenAt: now,
    };
    const hash = secretHash(b.secret);
    let row = await db.gameServerEnrollment.findUnique({ where: { secretHash: hash } });
    if (row && row.expiresAt <= now) {
      await db.gameServerEnrollment.deleteMany({ where: { id: row.id } });
      row = null;
    }
    if (row) {
      // Același secret (răspuns pierdut, repornire): aceeași înrolare, nicio copie.
      if (row.status === "REJECTED") return { body: { status: "rejected" } };
      if (row.status === "APPROVED") {
        await db.gameServerEnrollment.update({ where: { id: row.id }, data: { lastSeenAt: now } });
        return { body: { status: "approved", enrollment: row.ref, retryAfter: 1 } };
      }
      const moved = row.game !== game || row.ip !== ip || row.port !== port;
      if (moved && row.ip !== ip && (await this.pendingFrom(ip, now)) >= MAX_PENDING_PER_IP) return { error: "too_many_pending", status: 503 };
      const updated = await db.gameServerEnrollment.update({ where: { id: row.id }, data: { ...data, game, ip, port } });
      if (moved) await this.check(updated);
      return { body: { status: "pending", enrollment: row.ref, retryAfter: POLL_SECONDS } };
    }
    const [total, fromIp] = await Promise.all([db.gameServerEnrollment.count({ where: { status: "PENDING", expiresAt: { gt: now } } }), this.pendingFrom(ip, now)]);
    if (total >= MAX_PENDING || fromIp >= MAX_PENDING_PER_IP) return { error: "too_many_pending", status: 503 };
    let created: Row;
    try {
      created = await db.gameServerEnrollment.create({ data: { ...data, ref: newRef(), secretHash: hash, game, ip, port, expiresAt: new Date(now.getTime() + ENROLL_TTL_DAYS * DAY) } });
    } catch (error) {
      // Două cereri simultane cu același secret: a doua o găsește pe prima.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const again = await db.gameServerEnrollment.findUnique({ where: { secretHash: hash } });
        if (again) return { body: { status: again.status.toLowerCase(), ...(again.status === "REJECTED" ? {} : { enrollment: again.ref, retryAfter: POLL_SECONDS }) } };
      }
      throw error;
    }
    await this.check(created);
    return { body: { status: "pending", enrollment: created.ref, retryAfter: POLL_SECONDS } };
  }

  private pendingFrom(ip: string, now: Date): Promise<number> {
    return this.deps.db.gameServerEnrollment.count({ where: { status: "PENDING", ip, expiresAt: { gt: now } } });
  }

  /**
   * Starea (§5.5): `null` = referință necunoscută / expirată sau secret greșit (același răspuns, numărat ca eșec). După
   * aprobare cheia se creează acum și se dă o singură dată; o cheie livrată și nefolosită se înlocuiește (răspuns
   * pierdut), de cel mult `MAX_DELIVERIES` ori.
   */
  private async status(ip: string, b: Record<string, unknown>): Promise<Record<string, unknown> | { error: string; status: number } | null> {
    const { db, keys } = this.deps;
    if (typeof b.enrollment !== "string" || !REF.test(b.enrollment) || typeof b.secret !== "string" || !SECRET.test(b.secret)) return null;
    const now = this.now();
    const row = await db.gameServerEnrollment.findUnique({ where: { ref: b.enrollment } });
    if (!row || row.expiresAt <= now) return null;
    // Comparația hash-urilor în timp constant (ambele hex de 64 de caractere).
    const given = Buffer.from(secretHash(b.secret), "hex");
    const stored = Buffer.from(row.secretHash, "hex");
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
    await db.gameServerEnrollment.update({ where: { id: row.id }, data: { lastSeenAt: now } });

    if (row.status === "REJECTED") return { status: "rejected" };
    if (row.status === "PENDING") {
      const result = (row.check as GcsEnrollCheck | null)?.result;
      if (result !== "ok" && (!row.checkedAt || now.getTime() - row.checkedAt.getTime() >= CHECK_RETRY_MS) && row.ip === ip) await this.check(row);
      return { status: "pending", retryAfter: POLL_SECONDS };
    }

    // Aprobată: serverul trebuie să existe încă (șters → înrolarea dispare, pluginul se înrolează din nou).
    const server = row.serverId === null ? null : await db.gameServer.findUnique({ where: { id: row.serverId }, select: { id: true } });
    if (!server) {
      await db.gameServerEnrollment.deleteMany({ where: { id: row.id } });
      return null;
    }
    if (row.deliveredAt !== null) {
      const previous = row.keyId ? await db.gameServerKey.findUnique({ where: { keyId: row.keyId } }) : null;
      const unused = !!previous && previous.lastUsedAt === null && previous.revokedAt === null;
      if (!unused || row.deliveries >= MAX_DELIVERIES) return { status: "approved", delivered: true };
    }
    try {
      const out = await db.$transaction(async (tx) => {
        // Livrarea e unică: doar cine schimbă primul numărul livrărilor emite cheia.
        const claimed = await tx.gameServerEnrollment.updateMany({ where: { id: row.id, status: "APPROVED", deliveries: row.deliveries }, data: { deliveries: { increment: 1 } } });
        if (claimed.count === 0) return null;
        if (row.keyId) {
          const revoked = await tx.gameServerKey.updateMany({ where: { keyId: row.keyId, revokedAt: null, lastUsedAt: null }, data: { revokedAt: now } });
          if (revoked.count > 0) {
            await writeAudit(tx, { actorId: null, action: "servers.key.revoke", targetType: "game_server", targetId: String(server.id), before: { keyId: row.keyId }, after: { reason: "enrollment_redelivery", enrollmentId: row.id }, ip });
          }
        }
        const label = `Înrolare automată ${now.toISOString().slice(0, 10)}`;
        const key = await keys.issue(tx, server.id, { label, actorId: null, ip, source: "enrollment", extra: { enrollmentId: row.id } });
        await tx.gameServerEnrollment.update({ where: { id: row.id }, data: { keyId: key.keyId, deliveredAt: now, expiresAt: new Date(now.getTime() + KEEP_DAYS * DAY) } });
        return key;
      });
      if (!out) return { status: "approved", delivered: true };
      return { status: "approved", key: out.token };
    } catch (error) {
      if (error instanceof GcsValidationError) return { error: "too_many_keys", status: 409 };
      throw error;
    }
  }

  /**
   * Interogarea IP:port-ului (§5.3.5): doar IP-ul sursei (salvat la înrolare), cu garda SSRF a aplicației și 3 s. `ok` =
   * răspunde și folderul jocului corespunde.
   */
  private async check(row: Row): Promise<GcsEnrollCheck> {
    const allow = this.deps.allow();
    let check: GcsEnrollCheck;
    const base = { error: null, name: null, map: null, players: null, maxPlayers: null, folder: null, nameMatch: false, mapMatch: false };
    if (!isQueryableAddress(row.ip, allow)) check = { ...base, result: "blocked", error: "blocked" };
    else {
      const s = await this.deps.query({ game: row.game, host: unmapped(row.ip), port: row.port }, { allow, players: false, timeoutMs: CHECK_TIMEOUT_MS });
      if (!s.online) check = { ...base, result: s.error === "blocked" ? "blocked" : "offline", error: s.error };
      else {
        const folder = s.folder ?? null;
        check = {
          result: folder !== null && folder.toLowerCase() === GAME_FOLDER[row.game] ? "ok" : "game_mismatch",
          error: null,
          name: s.name,
          map: s.map,
          players: s.players,
          maxPlayers: s.maxPlayers,
          folder,
          nameMatch: sameText(s.name, row.hostname),
          mapMatch: sameText(s.map, row.map),
        };
      }
    }
    await this.deps.db.gameServerEnrollment.update({ where: { id: row.id }, data: { check: check as Prisma.InputJsonValue, checkedAt: this.now() } });
    return check;
  }

  // ─── ACP ────────────────────────────────────────────────────────────────

  /** Înrolările în așteptare (cele noi primele) și cele decise în ultimele 7 zile. */
  async list(actor: GcsActor): Promise<GcsEnrollmentView[]> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const now = this.now();
    const rows = await db.gameServerEnrollment.findMany({
      where: { expiresAt: { gt: now }, OR: [{ status: "PENDING" }, { decidedAt: { gte: new Date(now.getTime() - RECENT_DAYS * DAY) } }] },
      include: { server: { select: { id: true, name: true } } },
      orderBy: [{ lastSeenAt: "desc" }],
      take: 200,
    });
    const pending = rows.filter((r) => r.status === "PENDING");
    const addressKey = (r: { game: string; ip: string; port: number }) => `${r.game}|${r.ip}|${r.port}`;
    const counts = new Map<string, number>();
    for (const r of pending) counts.set(addressKey(r), (counts.get(addressKey(r)) ?? 0) + 1);
    const servers = pending.length
      ? await db.gameServer.findMany({ where: { OR: pending.map((r) => ({ game: r.game, host: unmapped(r.ip), port: r.port })) }, select: { id: true, name: true, game: true, host: true, port: true } })
      : [];
    const byAddress = new Map(servers.map((s) => [`${s.game}|${s.host}|${s.port}`, { id: s.id, name: s.name }]));
    return rows
      .map((r) =>
        view(r, {
          duplicate: r.status === "PENDING" && (counts.get(addressKey(r)) ?? 0) > 1,
          sameAddress: r.status === "PENDING" ? (byAddress.get(`${r.game}|${unmapped(r.ip)}|${r.port}`) ?? null) : null,
        }),
      )
      .sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING"));
  }

  private async pendingRow(id: number): Promise<Row> {
    const row = await this.deps.db.gameServerEnrollment.findUnique({ where: { id } });
    if (!row || row.status !== "PENDING" || row.expiresAt <= this.now()) throw new GcsNotFound();
    return row;
  }

  /**
   * Aprobarea: un server nou în aplicația Servere (jocul, IP-ul, portul, numele curățat) sau atașarea la un server
   * existent al aceluiași joc. Fără interogarea confirmată cere `force` („Aprobă oricum”).
   */
  async approve(actor: GcsActor, id: number, input: { serverId?: number | null; force?: boolean } = {}): Promise<{ serverId: number; created: boolean }> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const row = await this.pendingRow(id);
    const verified = (row.check as GcsEnrollCheck | null)?.result === "ok";
    if (!verified && input.force !== true) throw new GcsValidationError({ check: "not_verified" });
    let attach: number | null = null;
    if (typeof input.serverId === "number") {
      const target = await db.gameServer.findUnique({ where: { id: input.serverId }, select: { id: true, game: true } });
      if (!target || target.game !== row.game) throw new GcsValidationError({ serverId: "invalid" });
      attach = target.id;
    }
    const now = this.now();
    // Decizia o ia un singur admin (două aprobări simultane: a doua nu mai găsește înrolarea în așteptare).
    const claimed = await db.gameServerEnrollment.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", decidedById: actor.userId, decidedAt: now, expiresAt: new Date(now.getTime() + ENROLL_TTL_DAYS * DAY) },
    });
    if (claimed.count === 0) throw new GcsNotFound();
    let serverId = attach;
    try {
      if (serverId === null) {
        const name = [...(row.hostname || `${row.game === "cs16" ? "CS 1.6" : "CS2"} ${row.ip}:${row.port}`)].slice(0, SERVER_LIMITS.name).join("");
        serverId = (await this.deps.createServer(actor, { game: row.game, host: unmapped(row.ip), port: row.port, name })).id;
      }
    } catch (error) {
      await db.gameServerEnrollment.update({ where: { id }, data: { status: "PENDING", decidedById: null, decidedAt: null, expiresAt: row.expiresAt } });
      throw error;
    }
    await db.$transaction(async (tx) => {
      await tx.gameServerEnrollment.update({ where: { id }, data: { serverId } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "servers.enroll.approve",
        targetType: "game_server",
        targetId: String(serverId),
        after: { enrollmentId: id, game: row.game, ip: row.ip, port: row.port, mode: attach === null ? "create" : "attach", forced: !verified },
        ip: actor.ip,
      });
    });
    return { serverId, created: attach === null };
  }

  async reject(actor: GcsActor, id: number): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const row = await this.pendingRow(id);
    const now = this.now();
    await db.$transaction(async (tx) => {
      const done = await tx.gameServerEnrollment.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "REJECTED", decidedById: actor.userId, decidedAt: now, expiresAt: new Date(now.getTime() + KEEP_DAYS * DAY) },
      });
      if (done.count === 0) throw new GcsNotFound();
      await writeAudit(tx, { actorId: actor.userId, action: "servers.enroll.reject", targetType: "game_server_enrollment", targetId: String(id), after: { game: row.game, ip: row.ip, port: row.port }, ip: actor.ip });
    });
  }

  /** Blochează IP-ul înrolării (lista din setări, jurnalul setărilor) și respinge toate înrolările lui în așteptare. */
  async blockIp(actor: GcsActor, id: number): Promise<{ rejected: number }> {
    const { db, acp, settings } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const row = await db.gameServerEnrollment.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    const ip = unmapped(row.ip);
    const current = await settings.get<string>(BRIDGE_SETTING.enrollBlockedIps);
    if (!isBlockedIp(current, ip)) {
      const next = [current.trim(), ip].filter(Boolean).join(", ");
      if (enrollBlockedError(next)) throw new GcsValidationError({ blocked: "too_many" });
      await settings.set(BRIDGE_SETTING.enrollBlockedIps, next, actor);
    }
    const now = this.now();
    return db.$transaction(async (tx) => {
      const rejected = await tx.gameServerEnrollment.updateMany({
        where: { ip: { in: [...new Set([row.ip, ip, `::ffff:${ip}`])] }, status: "PENDING" },
        data: { status: "REJECTED", decidedById: actor.userId, decidedAt: now, expiresAt: new Date(now.getTime() + KEEP_DAYS * DAY) },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "servers.enroll.block", targetType: "game_server_enrollment", targetId: String(id), after: { ip, rejected: rejected.count }, ip: actor.ip });
      return { rejected: rejected.count };
    });
  }

  /** „Verifică din nou”: interogarea, cu limita butonului „Testează” (10 pe minut pe admin). */
  async recheck(actor: GcsActor, id: number): Promise<GcsEnrollCheck> {
    const { acp, rateLimiter } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const row = await this.pendingRow(id);
    const limit = await rateLimiter.consume(`servers-test:${actor.userId}`, RECHECK_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    return this.check(row);
  }

  /** Jobul de curățenie: înrolările expirate (în așteptare, neridicate, respinse sau livrate de mult) dispar. */
  async sweep(): Promise<number> {
    return (await this.deps.db.gameServerEnrollment.deleteMany({ where: { expiresAt: { lte: this.now() } } })).count;
  }
}

const isFailure = (v: Record<string, unknown>): v is { error: string; status: number } => typeof v.error === "string" && typeof v.status === "number";

/** O cerere invalidă (400, `code` stabil citit de plugin). */
class GcsBadRequest extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
