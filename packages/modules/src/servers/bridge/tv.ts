import { GcsNotFound, GcsRateLimited, GcsValidationError, openSecret, sealSecret, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsRedisRateLimiter } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { normalizeHost } from "../net";
import { SERVERS_ACP_SECTION } from "../service";
import { demoGuardOptions, GcsDemoError, resolveDemoHost, type GcsDemoGuardOptions } from "./demos/guard";
import { hltvRcon, type GcsHltvAction } from "./demos/rcon";
import { connectDemoSource, demoErrorCode, type GcsDemoConnect, type GcsDemoSourceConfig } from "./demos/sources";
import { isTimeZone } from "./demos/names";
import {
  DEFAULT_PORTS,
  hostKeyError,
  httpTemplateError,
  isDemoSource,
  parseTvAddress,
  prefixError,
  privateKeyError,
  rconPasswordError,
  remoteDirError,
  TV_DELAY_MAX,
  usernameError,
  type GcsDemoSource,
} from "./demos/settings";
import type { GcsBridgeStore } from "./store";

/**
 * HLTV / GOTV și demo-urile unui server (specul 2026-10-08-servere-hltv §2.1, §3, §5, §7): setările din ACP (adresa de
 * vizionare, întârzierea, sursa demo-urilor, înregistrarea opțională), cu secretele sigilate (`sealSecret`, ca parola
 * bazei vechi la import) și niciodată arătate înapoi; „Testează conexiunea”; rcon-ul către HLTV (varianta B, CS 1.6);
 * adresa „Urmărește live” pentru paginile publice. Totul e oprit implicit: fără rând = nimic.
 */

const TEST_LIMIT = { window: 3600, max: 10 };
const SAMPLE = 5;

/** Setările în ACP: fără secrete (doar dacă există). */
export type GcsServerTvView = {
  serverId: number;
  game: string;
  address: string;
  delay: number | null;
  source: GcsDemoSource;
  host: string;
  port: number | null;
  username: string;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  remoteDir: string;
  tlsInsecure: boolean;
  hostKey: string;
  httpTemplate: string;
  namePrefix: string;
  timeZone: string;
  record: boolean;
  hasRconPassword: boolean;
  lastFetch: { at: string; ok: boolean; code: string | null; info: Record<string, unknown> | null } | null;
  lastRcon: { at: string; action: string; ok: boolean; code: string | null } | null;
};

/** Formularul din ACP. Secretele: gol = neschimbat; `clear…` = șterse. */
export type GcsServerTvInput = {
  address: string;
  delay: number | null;
  source: string;
  host: string;
  port: number | null;
  username: string;
  password?: string;
  clearPassword?: boolean;
  privateKey?: string;
  clearPrivateKey?: boolean;
  remoteDir: string;
  tlsInsecure: boolean;
  hostKey: string;
  httpTemplate: string;
  namePrefix: string;
  timeZone: string;
  record: boolean;
  rconPassword?: string;
  clearRconPassword?: boolean;
};

/** Configurația internă (secretele deschise, doar în memoria procesului). */
export type GcsServerTvConfig = {
  serverId: number;
  game: string;
  address: string | null;
  delay: number | null;
  source: GcsDemoSource;
  record: boolean;
  namePrefix: string;
  timeZone: string;
  rconPassword: string | null;
  sourceConfig: GcsDemoSourceConfig | null;
};

/** Adresa „Urmărește live” a unui server și întârzierea transmisiei (s). */
export type GcsTvWatch = { address: string; delay: number | null };

/** Rezultatul „Testează conexiunea”. */
export type GcsTvTestResult = { ok: true; files: number; sample: string[]; hostKey: string | null } | { ok: false; error: string };

const SECRET_FIELDS = ["secret", "privateKey", "rconPassword"] as const;

/** Rândul pentru jurnal: secretele doar `set` / `unset`. */
function auditRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "updatedAt" || k.startsWith("last")) continue;
    out[k] = (SECRET_FIELDS as readonly string[]).includes(k) ? (v ? "set" : "unset") : v;
  }
  return out;
}

export class GcsBridgeTv {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: GcsAcpRoleService;
      rateLimiter: GcsRedisRateLimiter;
      store: GcsBridgeStore;
      /** Doar pentru teste: conectarea la sursă și garda. */
      connect?: GcsDemoConnect;
      guard?: () => GcsDemoGuardOptions;
      now?: () => number;
    },
  ) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  guard(): GcsDemoGuardOptions {
    return this.deps.guard?.() ?? demoGuardOptions();
  }

  get connect(): GcsDemoConnect {
    return this.deps.connect ?? connectDemoSource;
  }

  private async server(serverId: number): Promise<{ id: number; game: string }> {
    const server = await this.deps.db.gameServer.findUnique({ where: { id: serverId }, select: { id: true, game: true } });
    if (!server) throw new GcsNotFound();
    return server;
  }

  /** Setările unui server în ACP (fără secrete). */
  async view(actor: GcsActor, serverId: number): Promise<GcsServerTvView> {
    await this.deps.acp.assert(actor, SERVERS_ACP_SECTION, "view");
    const server = await this.server(serverId);
    const row = await this.deps.db.gameServerTv.findUnique({ where: { serverId } });
    const lastRcon = (row?.lastRcon ?? null) as GcsServerTvView["lastRcon"];
    return {
      serverId,
      game: server.game,
      address: row?.address ?? "",
      delay: row?.delay ?? null,
      source: row && isDemoSource(row.source) ? row.source : "none",
      host: row?.host ?? "",
      port: row?.port ?? null,
      username: row?.username ?? "",
      hasPassword: Boolean(row?.secret),
      hasPrivateKey: Boolean(row?.privateKey),
      remoteDir: row?.remoteDir ?? "/",
      tlsInsecure: row?.tlsInsecure ?? false,
      hostKey: row?.hostKey ?? "",
      httpTemplate: row?.httpTemplate ?? "",
      namePrefix: row?.namePrefix ?? "",
      timeZone: row?.timeZone ?? "UTC",
      record: row?.record ?? false,
      hasRconPassword: Boolean(row?.rconPassword),
      lastFetch: row?.lastFetchAt
        ? { at: row.lastFetchAt.toISOString(), ok: row.lastFetchOk === true, code: row.lastFetchCode, info: (row.lastFetchInfo ?? null) as Record<string, unknown> | null }
        : null,
      lastRcon,
    };
  }

  /**
   * Salvează setările (ACP `edit`): validarea pe sursă, secretele sigilate (gol = neschimbate), jurnalul
   * `servers.tv.update` cu secretele doar `set` / `unset`. Totul rămâne oprit până când adminul pornește ceva.
   */
  async save(actor: GcsActor, serverId: number, input: GcsServerTvInput): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const server = await this.server(serverId);
    const before = await db.gameServerTv.findUnique({ where: { serverId } });
    const errors: Record<string, string> = {};

    const address = parseTvAddress(input.address ?? "");
    if (address === "invalid") errors.address = "invalid_address";
    const delay = input.delay === null || Number.isNaN(input.delay) ? null : input.delay;
    if (delay !== null && (!Number.isInteger(delay) || delay < 0 || delay > TV_DELAY_MAX)) errors.delay = "invalid_range";
    const source = isDemoSource(input.source) ? input.source : null;
    if (!source) errors.source = "invalid_choice";
    if (source === "plugin" && server.game !== "cs2") errors.source = "plugin_cs2_only";
    if (source === "plugin" && !input.record) errors.record = "plugin_needs_record";
    if (!isTimeZone(input.timeZone)) errors.timeZone = "invalid_time_zone";
    const prefixErr = prefixError(input.namePrefix ?? "");
    if (prefixErr) errors.namePrefix = prefixErr;

    const remote = source === "ftp" || source === "ftps" || source === "sftp";
    let host: string | null = null;
    let port: number | null = null;
    if (remote) {
      host = normalizeHost(input.host);
      if (!host) errors.host = "invalid_host";
      port = input.port ?? DEFAULT_PORTS[source]!;
      if (!Number.isInteger(port) || port < 1 || port > 65_535) errors.port = "invalid_range";
      const userErr = usernameError(input.username ?? "");
      if (userErr) errors.username = userErr;
      const dirErr = remoteDirError(input.remoteDir ?? "/");
      if (dirErr) errors.remoteDir = dirErr;
      if (input.privateKey && source === "sftp") {
        const keyErr = privateKeyError(input.privateKey);
        if (keyErr) errors.privateKey = keyErr;
      }
      if (source === "sftp") {
        const hkErr = hostKeyError(input.hostKey ?? "");
        if (hkErr) errors.hostKey = hkErr;
      }
      if (input.password && (input.password.length > 256 || /[\u0000-\u001F\u007F]/.test(input.password))) errors.password = "invalid_secret";
      const willHaveSecret = (input.password ? true : !input.clearPassword && Boolean(before?.secret)) || (source === "sftp" && (input.privateKey ? true : !input.clearPrivateKey && Boolean(before?.privateKey)));
      if (!willHaveSecret) errors.password = "required";
    }
    if (source === "http") {
      const tplErr = httpTemplateError(input.httpTemplate ?? "");
      if (tplErr) errors.httpTemplate = tplErr;
    }
    // CS 1.6, varianta B: rcon-ul cere adresa HLTV și parola lui.
    const rconNeeded = input.record && server.game === "cs16";
    if (input.rconPassword) {
      const rpErr = rconPasswordError(input.rconPassword);
      if (rpErr) errors.rconPassword = rpErr;
    }
    if (rconNeeded) {
      if (address === null) errors.address = "rcon_needs_address";
      if (!input.rconPassword && (input.clearRconPassword || !before?.rconPassword)) errors.rconPassword = "required";
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);

    const keepSecret = (fresh: string | undefined, clear: boolean | undefined, old: string | null | undefined) => (fresh ? sealSecret(fresh) : clear ? null : (old ?? null));
    const data = {
      address: address && address !== "invalid" ? address.value : null,
      delay,
      source: source!,
      host: remote ? host : null,
      port: remote ? port : null,
      username: remote ? input.username : null,
      secret: remote ? keepSecret(input.password, input.clearPassword, before?.secret) : null,
      privateKey: source === "sftp" ? keepSecret(input.privateKey, input.clearPrivateKey, before?.privateKey) : null,
      remoteDir: remote ? (input.remoteDir?.trim() || "/") : "/",
      tlsInsecure: source === "ftps" && input.tlsInsecure === true,
      // Amprenta SFTP: un host schimbat o golește (se reține din nou la prima conectare).
      hostKey: source === "sftp" ? (input.hostKey || (before?.host === host && before?.port === port ? before?.hostKey : null) || null) : null,
      httpTemplate: source === "http" ? input.httpTemplate : null,
      namePrefix: input.namePrefix ?? "",
      timeZone: input.timeZone,
      record: input.record === true && (server.game === "cs2" || server.game === "cs16"),
      rconPassword: server.game === "cs16" ? keepSecret(input.rconPassword, input.clearRconPassword, before?.rconPassword) : null,
    };
    await db.$transaction(async (tx) => {
      await tx.gameServerTv.upsert({ where: { serverId }, create: { serverId, ...data }, update: data });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "servers.tv.update",
        targetType: "game_server",
        targetId: String(serverId),
        before: auditRow(before as Record<string, unknown> | null),
        after: auditRow(data as Record<string, unknown>),
        ip: actor.ip,
      });
    });
  }

  /** Configurația internă a unui server (secretele deschise); `null` = fără rând. */
  async config(serverId: number): Promise<GcsServerTvConfig | null> {
    const row = await this.deps.db.gameServerTv.findUnique({ where: { serverId }, include: { server: { select: { game: true } } } });
    if (!row) return null;
    const source = isDemoSource(row.source) ? row.source : "none";
    const open = (sealed: string | null) => (sealed ? openSecret(sealed) : null);
    return {
      serverId,
      game: row.server.game,
      address: row.address,
      delay: row.delay,
      source,
      record: row.record,
      namePrefix: row.namePrefix,
      timeZone: row.timeZone,
      rconPassword: open(row.rconPassword),
      sourceConfig:
        source === "ftp" || source === "ftps" || source === "sftp" || source === "http"
          ? {
              source,
              host: row.host,
              port: row.port,
              username: row.username,
              password: open(row.secret),
              privateKey: open(row.privateKey),
              remoteDir: row.remoteDir,
              tlsInsecure: row.tlsInsecure,
              hostKey: row.hostKey,
              httpTemplate: row.httpTemplate,
            }
          : null,
    };
  }

  /** Amprenta SFTP văzută la prima conectare se reține (încrederea la prima folosire). */
  async pinHostKey(serverId: number, fingerprint: string | null): Promise<void> {
    if (!fingerprint) return;
    await this.deps.db.gameServerTv.updateMany({ where: { serverId, source: "sftp", hostKey: null }, data: { hostKey: fingerprint } });
  }

  /** Ultimul rezultat al aducerii (ACP). */
  async noteFetch(serverId: number, ok: boolean, code: string | null, info: Record<string, unknown> | null): Promise<void> {
    await this.deps.db.gameServerTv.updateMany({
      where: { serverId },
      data: { lastFetchAt: this.now(), lastFetchOk: ok, lastFetchCode: code, lastFetchInfo: (info ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }

  /**
   * „Testează conexiunea” (ACP `edit`, 10 / oră): cu setările salvate, listează folderul și întoarce câte demo-uri vede,
   * câteva nume și amprenta SFTP (reținută dacă nu era). Jurnal `servers.tv.test`.
   */
  async test(actor: GcsActor, serverId: number): Promise<GcsTvTestResult> {
    const { acp, rateLimiter, db } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    await this.server(serverId);
    const limit = await rateLimiter.consume(`servers-tv-test:${actor.userId ?? "?"}:${serverId}`, TEST_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter ?? 3600) });
    const cfg = await this.config(serverId);
    let result: GcsTvTestResult;
    if (!cfg?.sourceConfig) result = { ok: false, error: "not_configured" };
    else {
      try {
        const conn = await this.connect(cfg.sourceConfig, { guard: this.guard() });
        try {
          const files = await conn.list();
          await this.pinHostKey(serverId, conn.hostKey);
          result = { ok: true, files: files.length, sample: files.map((f) => f.name).sort().reverse().slice(0, SAMPLE), hostKey: conn.hostKey };
        } finally {
          await conn.close();
        }
      } catch (error) {
        result = { ok: false, error: demoErrorCode(error) };
      }
    }
    await writeAudit(db, { actorId: actor.userId, action: "servers.tv.test", targetType: "game_server", targetId: String(serverId), after: result.ok ? { ok: true, files: result.files } : { ok: false, error: result.error }, ip: actor.ip });
    return result;
  }

  /**
   * Rcon-ul HLTV (varianta B, CS 1.6; jobul `servers.tv.rcon`): doar la adresa configurată, prin gardă; `record gcs-m<id>`
   * sau `stoprecording`. Rezultatul (fără parolă) în `lastRcon`. Fără înregistrare pornită: nimic.
   */
  async rcon(serverId: number, action: "record" | "stop", matchId: number): Promise<{ ok: boolean; code: string | null }> {
    const cfg = await this.config(serverId);
    if (!cfg || cfg.game !== "cs16" || !cfg.record || !cfg.address || !cfg.rconPassword) return { ok: false, code: "not_configured" };
    const parsed = parseTvAddress(cfg.address);
    if (!parsed || parsed === "invalid") return { ok: false, code: "invalid_address" };
    const command: GcsHltvAction = action === "record" ? { action: "record", name: `gcs-m${matchId}` } : { action: "stop" };
    let out: { ok: boolean; code: string | null };
    try {
      const target = await resolveDemoHost(parsed.host, this.guard());
      await hltvRcon(target, parsed.port, cfg.rconPassword, command);
      out = { ok: true, code: null };
    } catch (error) {
      out = { ok: false, code: error instanceof GcsDemoError ? error.code : "network" };
    }
    await this.deps.db.gameServerTv.update({ where: { serverId }, data: { lastRcon: { at: this.now().toISOString(), action, ok: out.ok, code: out.code } } });
    return out;
  }

  /**
   * Adresele „Urmărește live” ale serverelor (cele cu adresă) și întârzierea: CS2 — `tv.delay` din ultimul heartbeat, dacă
   * pluginul o raportează; altfel cea din ACP.
   */
  async watch(serverIds: number[]): Promise<Map<number, GcsTvWatch>> {
    const out = new Map<number, GcsTvWatch>();
    if (serverIds.length === 0) return out;
    const rows = await this.deps.db.gameServerTv.findMany({ where: { serverId: { in: serverIds }, address: { not: null } }, select: { serverId: true, address: true, delay: true, server: { select: { game: true } } } });
    if (rows.length === 0) return out;
    const rosters = await this.deps.store.rosters(rows.filter((r) => r.server.game === "cs2").map((r) => r.serverId));
    for (const r of rows) {
      const reported = rosters.get(r.serverId)?.tv?.delay;
      out.set(r.serverId, { address: r.address!, delay: typeof reported === "number" ? reported : r.delay });
    }
    return out;
  }
}
