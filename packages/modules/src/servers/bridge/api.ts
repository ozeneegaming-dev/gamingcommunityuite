import { createHash } from "node:crypto";
import type { GcsAppService, GcsRateLimiter, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { SERVERS_APP } from "../poller";
import { cleanGameText } from "../text";
import type { GcsBridgeAdmins } from "./admins";
import { BRIDGE_SETTING, isBridgeGame } from "./config";
import { DEMO_CHUNK_MAX, DEMO_CHUNK_SIZE, DEMO_UPLOAD_RATE, type GcsBridgeDemos } from "./demos/service";
import type { GcsBridgeEnrollments } from "./enroll";
import { closeSession, openSession, MAX_EVENTS, type GcsBridgeEvents } from "./events";
import { reportedAdminFlags } from "./flags";
import { cleanIp, resolveIdentity } from "./identity";
import type { GcsBridgeKeys } from "./keys";
import type { GcsBridgeMaps } from "./maps";
import { parseMatchState, type GcsBridgeMatches } from "./matches";
import type { GcsBridgePlayers } from "./players";
import type { GcsBridgeSanctions } from "./sanctions";
import { canonicalString, isBridgeKeyId, verifyBridgeSignature } from "./signing";
import type { GcsBridgeStore, GcsRosterEntry, GcsRosterTv } from "./store";
import { BRIDGE_SERVER_SELECT, GcsBridgeError, bridgeFeatures, cleanMapName, identityKey, type GcsBridgeAuth, type GcsBridgeFeatures, type GcsBridgeServer, type GcsPlayerRow } from "./types";
import type { GcsBridgeVip } from "./vip";

/** O cerere HTTP către protocol; `path` = partea de după `/api/servers/bridge/v1`, cu query-ul exact cum a fost trimis. */
export type GcsBridgeHttpRequest = { method: string; path: string; header: (name: string) => string | null; body: Uint8Array | string; ip: string };
export type GcsBridgeHttpResponse = { status: number; headers: Record<string, string>; body: string | null };

export const BRIDGE_MAX_BODY = 512 * 1024;
/** Calea încărcării bucăților unui demo (corp binar, cel mult 1 MiB; specul servere-hltv §4.3). */
const DEMO_CHUNK_ROUTE = "/demos/chunk";

/** Limita corpului unei cereri: 512 KB, bucățile demo-urilor 1 MiB (calea fără query). */
export function bridgeBodyLimit(path: string): number {
  return path.split("?", 1)[0] === DEMO_CHUNK_ROUTE ? DEMO_CHUNK_MAX : BRIDGE_MAX_BODY;
}
const AUTH_FAILS_PER_MINUTE = 30;
const KEY_LIMIT = { window: 60, max: 240 };
const CLOCK_SKEW_S = 300;
const MAX_ROSTER = 128;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const TIMESTAMP = /^\d{1,12}$/;
export const LINK_COMMAND = "/gcs";
/** Cheile modulelor opționale (`config.features`, `modules` raportate de plugin). */
export const FEATURE_KEYS = ["admins", "sanctions", "vip", "mixReady", "commands"] as const satisfies readonly (keyof GcsBridgeFeatures)[];
/** Modulele raportate de plugin (cu înregistrarea demo-urilor CS2, specul servere-hltv §8). */
const REPORTED_MODULES: readonly string[] = [...FEATURE_KEYS, "demos"];

/** Starea transmisiei din heartbeat (CS2: GOTV; CS 1.6: proxy-urile HLTV conectate), curățată. */
function parseTv(raw: unknown): GcsRosterTv | null {
  const o = obj(raw);
  if (Object.keys(o).length === 0) return null;
  const tv: GcsRosterTv = {};
  if (typeof o.enabled === "boolean") tv.enabled = o.enabled;
  if (typeof o.recording === "boolean") tv.recording = o.recording;
  const delay = int(o.delay, 3600);
  if (delay !== null && delay >= 0) tv.delay = delay;
  const port = int(o.port, 65_535);
  if (port !== null && port > 0) tv.port = port;
  const hltv = int(o.hltv, 32);
  if (hltv !== null && hltv >= 0) tv.hltv = hltv;
  return tv;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(-max, Math.min(max, Math.trunc(v))) : null);
/** ETag-ul unei liste (hash-ul conținutului). */
export const listEtag = (list: unknown) => createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 16);

/** Cheia de identitate a unei intrări din liste (admini, VIP). */
function authKey(auth: GcsBridgeAuth | { kind: "name"; name: string }): string {
  if (auth.kind === "steam") return identityKey("STEAM", auth.steamId64);
  if (auth.kind === "nonsteam") return identityKey("NONSTEAM", auth.id);
  return identityKey("NAME", auth.name);
}

/**
 * Protocolul v1 al punții (specul 2026-10-08-servere-bridge §5–6): verificarea fiecărei cereri (în ordinea din §5.3:
 * aplicația activă, mărimea corpului, eșecurile pe IP, anteturile, cheia, ceasul, semnătura, reluarea, serverul activ,
 * limita pe cheie) și rutele: heartbeat, evenimente, listele trase de server (admini, sancțiuni, VIP), verificarea la
 * conectare și legarea prin cod. Transportul e o funcție (ruta Next.js, serverul fals din teste).
 */
export class GcsBridgeApi {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      apps: GcsAppService;
      settings: GcsSettingsService;
      rateLimiter: GcsRateLimiter;
      store: GcsBridgeStore;
      keys: GcsBridgeKeys;
      players: GcsBridgePlayers;
      admins: GcsBridgeAdmins;
      vip: GcsBridgeVip;
      sanctions: GcsBridgeSanctions;
      events: GcsBridgeEvents;
      matches: GcsBridgeMatches;
      maps: GcsBridgeMaps;
      enrollments: GcsBridgeEnrollments;
      demos?: GcsBridgeDemos;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async handle(req: GcsBridgeHttpRequest): Promise<GcsBridgeHttpResponse> {
    const { apps, store, keys, rateLimiter, db } = this.deps;
    const serverTime = Math.floor(this.now() / 1000);
    const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): GcsBridgeHttpResponse => ({
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-GCS-Time": String(serverTime), ...headers },
      body: JSON.stringify({ ...body, serverTime }),
    });
    const bare = (status: number, error: string, headers: Record<string, string> = {}): GcsBridgeHttpResponse => ({
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
      body: JSON.stringify({ error }),
    });

    // 1–3: aplicația, corpul, eșecurile de autentificare pe IP.
    if (!(await apps.enabled(SERVERS_APP))) return bare(404, "not_found");
    const body = typeof req.body === "string" ? Buffer.from(req.body, "utf8") : Buffer.from(req.body);
    // Înrolarea (specul plugin-v2 §5): fără cheie, cu limitele și verificările ei.
    const enrollRoute = req.path.split("?", 1)[0];
    if (enrollRoute === "/enroll" || enrollRoute === "/enroll/status") return this.deps.enrollments.handle({ route: enrollRoute, method: req.method, body, ip: req.ip });
    if (body.length > bridgeBodyLimit(req.path)) return bare(413, "too_large");
    const failKey = `auth:${req.ip}`;
    if ((await store.failures(failKey)) >= AUTH_FAILS_PER_MINUTE) return bare(429, "rate_limited", { "Retry-After": "60" });
    const fail = async (code: string) => {
      await store.fail(failKey, 60);
      return json(401, { error: code });
    };

    // 4–7: anteturile, cheia, ceasul, semnătura.
    const keyId = req.header("x-gcs-key") ?? "";
    const timestamp = req.header("x-gcs-timestamp") ?? "";
    const nonce = req.header("x-gcs-nonce") ?? "";
    const signature = req.header("x-gcs-signature") ?? "";
    if (!isBridgeKeyId(keyId) || !TIMESTAMP.test(timestamp) || !NONCE.test(nonce) || !signature) return fail("missing_auth");
    const key = await keys.lookup(keyId);
    // Același cod ca o semnătură greșită: cheile nu se pot ghici după răspuns.
    if (!key) return fail("unauthorized");
    if (Math.abs(serverTime - Number(timestamp)) > CLOCK_SKEW_S) return json(401, { error: "clock_skew" });
    if (!verifyBridgeSignature(key.signingKey, canonicalString(req.method, req.path, timestamp, nonce, body), signature)) return fail("unauthorized");

    // 8–10: reluarea, serverul, limita pe cheie.
    if (!(await store.claimNonce(keyId, nonce))) return json(409, { error: "replay" });
    const server = await db.gameServer.findUnique({ where: { id: key.serverId }, select: BRIDGE_SERVER_SELECT });
    if (!server || !server.enabled) return json(403, { error: "server_disabled" });
    if (!isBridgeGame(server.game)) return json(403, { error: "unsupported_game" });
    const limit = await rateLimiter.consume(`bridge-key:${keyId}`, KEY_LIMIT);
    if (!limit.allowed) return json(429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfter ?? 60) });
    await keys.touch(key, req.ip);

    const [route, query = ""] = req.path.split("?", 2) as [string, string?];
    const method = req.method.toUpperCase();
    try {
      const parse = (): Record<string, unknown> => {
        if (body.length === 0) return {};
        try {
          return obj(JSON.parse(body.toString("utf8")));
        } catch {
          throw new GcsBridgeError("invalid_json", 400);
        }
      };
      if (method === "POST" && route === "/heartbeat") return json(200, await this.heartbeat(server, parse()));
      if (method === "POST" && route === "/events") {
        const events = parse().events;
        if (!Array.isArray(events)) throw new GcsBridgeError("invalid_events", 400);
        if (events.length > MAX_EVENTS) throw new GcsBridgeError("too_many_events", 413, { max: MAX_EVENTS });
        return json(200, { results: await this.deps.events.applyBatch(server, events) });
      }
      if (method === "GET" && route === "/admins") {
        const list = await this.deps.admins.serverList(server);
        const etag = listEtag(list);
        if (req.header("if-none-match")?.replace(/"/g, "") === etag) return { status: 304, headers: { ETag: `"${etag}"`, "X-GCS-Time": String(serverTime) }, body: null };
        return json(200, { etag, admins: list }, { ETag: `"${etag}"` });
      }
      if (method === "GET" && route === "/vip") {
        const list = await this.deps.vip.serverList(server);
        const etag = listEtag(list);
        if (req.header("if-none-match")?.replace(/"/g, "") === etag) return { status: 304, headers: { ETag: `"${etag}"`, "X-GCS-Time": String(serverTime) }, body: null };
        return json(200, { etag, vip: list }, { ETag: `"${etag}"` });
      }
      if (method === "GET" && route === "/sanctions") {
        const params = new URLSearchParams(query);
        const raw = params.get("since") ?? "0";
        const limit = params.get("limit") ?? "1000";
        if (!/^\d{1,15}$/.test(raw) || !/^\d{1,4}$/.test(limit)) throw new GcsBridgeError("invalid_cursor", 400);
        return json(200, { ...(await this.deps.sanctions.syncPage(server, Number(raw), Number(limit))) });
      }
      if (method === "POST" && route === "/check") return json(200, await this.check(server, parse()));
      // Demo-urile încărcate de pluginul CS2 (specul servere-hltv §4.3).
      if (method === "POST" && route === "/demos/upload" && this.deps.demos) return json(200, await this.deps.demos.uploadStart(server, parse()));
      if (method === "POST" && route === DEMO_CHUNK_ROUTE && this.deps.demos) return json(200, await this.deps.demos.uploadChunk(server, query, body));
      if (method === "POST" && route === "/link") {
        const b = parse();
        return json(200, await this.deps.players.linkFromGame(server, obj(b.player), b.code));
      }
      return json(404, { error: "not_found" });
    } catch (error) {
      if (error instanceof GcsBridgeError) return json(error.status, { error: error.code, ...error.extra });
      throw error;
    }
  }

  /**
   * `POST /heartbeat` (§6.2): ultimul heartbeat și pluginul, lista jucătorilor online (Redis), reconcilierea sesiunilor
   * (jucător fără sesiune → sesiune nouă; sesiune al cărei jucător lipsește → închisă), harta văzută, starea live a
   * meciului. Răspunsul dă ritmul recomandat și versiunile listelor.
   */
  private async heartbeat(server: GcsBridgeServer, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { db, store, players, admins, maps, matches, settings } = this.deps;
    const now = new Date(this.now());
    const map = cleanMapName(body.map);
    await db.gameServer.update({ where: { id: server.id }, data: { bridgeSeenAt: now, bridgePlugin: cleanGameText(body.plugin, 64) || null } });

    const index = await admins.index(server.id);
    const roster: GcsRosterEntry[] = [];
    const meta = new Map<number, { ip: string | null; name: string; time: number | null; row: GcsPlayerRow }>();
    for (const raw of (Array.isArray(body.players) ? body.players : []).slice(0, MAX_ROSTER)) {
      const o = obj(raw);
      const identity = resolveIdentity(o, server);
      if (!identity) continue;
      const row = await players.upsert(identity, server.id, now);
      if (meta.has(row.id)) continue;
      const time = int(o.time, 86_400);
      meta.set(row.id, { ip: cleanIp(o.ip), name: identity.name || row.name, time, row });
      roster.push({
        playerId: row.id,
        kind: row.kind,
        name: identity.name || row.name,
        team: cleanGameText(o.team, 16) || null,
        score: int(o.score, 100_000),
        time,
        adminId: index.players[row.id] ?? null,
        // Flag-urile din sistemul de admini al serverului (specul plugin-v2 §2): prezența fără adminii GCS.
        flags: reportedAdminFlags(o),
      });
    }

    // Sesiunile: cine apare fără sesiune deschisă intră acum (sau de `time` secunde); cine lipsește iese acum. Flag-urile
    // raportate se țin la zi pe sesiunea deschisă.
    const open = await db.gameSession.findMany({ where: { serverId: server.id, disconnectedAt: null }, select: { playerId: true, adminId: true, adminFlags: true } });
    const openBy = new Map(open.map((s) => [s.playerId, s]));
    const currentMap = map ?? (await store.currentMap(server.id));
    for (const entry of roster) {
      const session = openBy.get(entry.playerId);
      if (session) {
        entry.adminId ??= session.adminId;
        if ((session.adminFlags ?? null) !== (entry.flags ?? null)) {
          await db.gameSession.updateMany({ where: { serverId: server.id, playerId: entry.playerId, disconnectedAt: null }, data: { adminFlags: entry.flags ?? null } });
        }
        continue;
      }
      const m = meta.get(entry.playerId)!;
      const since = new Date(now.getTime() - Math.max(0, m.time ?? 0) * 1000);
      await openSession(db, server.id, m.row, { name: m.name, ip: m.ip, adminId: entry.adminId, at: since, adminFlags: entry.flags ?? null });
    }
    const present = new Set(roster.map((r) => r.playerId));
    for (const s of open) if (!present.has(s.playerId)) await closeSession(db, server.id, s.playerId, now, currentMap);

    const scores = obj(body.scores);
    const modules = (Array.isArray(body.modules) ? body.modules : []).filter((m): m is string => typeof m === "string" && REPORTED_MODULES.includes(m));
    await store.saveRoster(server.id, {
      at: now.getTime(),
      map,
      maxPlayers: int(body.maxPlayers, 256) ?? 0,
      players: roster,
      modules: [...new Set(modules)],
      scores: typeof scores.ct === "number" && typeof scores.t === "number" ? { ct: int(scores.ct, 1000) ?? 0, t: int(scores.t, 1000) ?? 0 } : null,
      tv: parseTv(body.tv),
    });
    if (map) {
      await store.setMap(server.id, map);
      await maps.seen(server.game, map);
    }
    if (body.match === null) await store.saveMatch(server.id, null);
    else if (body.match !== undefined) {
      const state = parseMatchState(body.match);
      if (state) {
        const rows: (GcsPlayerRow | null)[] = [];
        for (const p of state.players) {
          const identity = resolveIdentity(obj(p.ref), server);
          rows.push(identity ? await players.upsert(identity, server.id, now) : null);
        }
        await matches.publish(await matches.liveFromState(server, state, rows, now));
      }
    }

    const [heartbeat, events, adminList, vipList, sanctions, tv] = await Promise.all([
      settings.get<number>(BRIDGE_SETTING.heartbeat),
      settings.get<number>(BRIDGE_SETTING.events),
      admins.serverList(server),
      this.deps.vip.serverList(server),
      this.deps.sanctions.maxRevision(),
      db.gameServerTv.findUnique({ where: { serverId: server.id }, select: { record: true, source: true } }),
    ]);
    // Înregistrarea demo-urilor (modulul CS2, oprit implicit) și încărcarea lor directă (specul servere-hltv §4.3, §8).
    const record = server.game === "cs2" && tv?.record === true;
    return {
      ok: true,
      config: {
        heartbeat,
        events,
        identityMode: server.identityMode,
        nameIds: server.nameIds,
        isMix: server.isMix,
        linkCommand: LINK_COMMAND,
        features: { ...bridgeFeatures(server), demos: record },
        tv: { upload: record && tv?.source === "plugin", chunkSize: DEMO_CHUNK_SIZE, rate: DEMO_UPLOAD_RATE },
      },
      versions: { admins: listEtag(adminList), vip: listEtag(vipList), sanctions },
    };
  }

  /**
   * `POST /check` (§6.8): verificarea proaspătă la conectare: identitatea (creată / actualizată), sancțiunile active pe
   * acest server (identitate, IP, nume pentru non-Steam), drepturile de admin și VIP-ul identității.
   */
  private async check(server: GcsBridgeServer, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { players, sanctions, admins, vip } = this.deps;
    const ref = obj(body.player);
    const identity = resolveIdentity(ref, server);
    const player = identity ? await players.upsert(identity, server.id, new Date(this.now())) : null;
    const active = await sanctions.activeFor(server, { player, ip: cleanIp(ref.ip), name: typeof ref.name === "string" ? ref.name : null });
    let admin = null;
    let vipEntry = null;
    if (player && player.kind !== "NAME") {
      const key = identityKey(player.kind, player.value);
      const a = (await admins.serverList(server)).find((x) => x.auth.kind !== "name" && authKey(x.auth) === key);
      if (a) admin = { id: a.id, flags: a.flags, immunity: a.immunity, permissions: a.permissions, expiresAt: a.expiresAt, label: a.label };
      const v = (await vip.serverList(server)).find((x) => authKey(x.auth) === key);
      if (v) vipEntry = { flags: v.flags, permissions: v.permissions, expiresAt: v.expiresAt, group: v.group };
    }
    return {
      player: player ? { id: player.id, kind: player.kind.toLowerCase(), linked: player.userId !== null } : null,
      ban: active.ban,
      mute: active.mute,
      gag: active.gag,
      admin,
      vip: vipEntry,
    };
  }
}
