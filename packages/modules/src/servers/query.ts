import { randomBytes } from "node:crypto";
import type { BlockList } from "node:net";
import { GcsBlockedFetch, safeFetchBuffer } from "@gcs/core";
import { DISCORD_GUILD_RE, gameDef } from "./games";
import { GcsTcpChannel, GcsUdpChannel, httpGetJson, resolveTarget, tcpExchange, type GcsLookup, type GcsResolvedAddress } from "./net";
import { A2sSplitAssembler, a2sInfoRequest, a2sPlayerRequest, parseA2sPacket, parseA2sPayload, type A2sFormat, type A2sMessage } from "./protocols/a2s";
import { bedrockPing, McStatusReader, minecraftHandshake, MINECRAFT_STATUS_REQUEST, parseBedrockPong, parseMinecraftStatus } from "./protocols/minecraft";
import { GcsQueryFailure } from "./protocols/reader";
import { GcsTsLineReader, TS_MAX_BYTES, tsEscape, tsFailure, tsParseRecords, tsServerInfo, tsWebBody, type GcsTsInfo } from "./protocols/teamspeak";
import { DISCORD_MAX_BYTES, mumblePing, parseDiscordWidget, parseMumblePong } from "./protocols/voice";
import { cleanGameText } from "./text";
import type { GcsServerPlayer, GcsServerStatus } from "./types";

/**
 * Contul de interogare al unui server de voce (TeamSpeak): `raw` = ServerQuery pe TCP (implicit portul 10011, cu
 * utilizator și parolă opționale), `http` = WebQuery (implicit portul 10080, cu cheia API în `secret`). Secretul vine
 * decriptat doar în worker / „Verifică”, niciodată spre pagină.
 */
export type GcsServerAuth = { mode: "raw" | "http"; user: string; secret: string };
export type GcsServerTarget = { game: string; host: string; port: number; queryPort?: number | null; auth?: GcsServerAuth | null };

/** Widget-ul unui server de Discord, ca JSON (înlocuibil în teste). */
export type GcsDiscordFetch = (guildId: string, deadline: number) => Promise<unknown>;

export type GcsQueryOptions = {
  /** Termenul întregii interogări (DNS + răspunsuri), implicit 5 s. */
  timeoutMs?: number;
  /** După cât timp fără răspuns se retrimite o dată cererea UDP (implicit 2 s). */
  retryMs?: number;
  /** Lista jucătorilor (A2S_PLAYER / eșantionul Minecraft); implicit da. */
  players?: boolean;
  lookup?: GcsLookup;
  allow?: BlockList | null;
  discord?: GcsDiscordFetch;
};

/** Limitele textelor (specul §10). */
export const TEXT_LIMITS = { name: 128, map: 64, version: 64, player: 32 } as const;
const MAX_PLAYERS_LIST = 128;
const MAX_CHALLENGE_ROUNDS = 3;

const clean = (v: unknown, max: number): string | null => cleanGameText(v, max) || null;
const clampCount = (n: number) => (Number.isInteger(n) && n >= 0 ? Math.min(n, 1_000_000) : 0);

function offline(error: GcsQueryFailure["code"]): GcsServerStatus {
  return { online: false, name: null, map: null, players: 0, maxPlayers: 0, bots: 0, ping: null, version: null, playerList: null, updatedAt: new Date().toISOString(), error };
}

function cleanPlayers(list: { name: unknown; score: number | null; time: number | null }[]): GcsServerPlayer[] {
  return list
    .map((p) => ({ name: cleanGameText(p.name, TEXT_LIMITS.player), score: p.score, time: p.time === null ? null : Math.max(0, Math.round(p.time)) }))
    .filter((p) => p.name !== "")
    .slice(0, MAX_PLAYERS_LIST);
}

/**
 * Interoghează o dată un server de joc (worker-ul la fiecare rundă, butonul „Testează” din ACP). Nu aruncă: un server
 * care nu răspunde sau nu are voie întoarce `online: false` cu codul erorii.
 */
export async function queryGameServer(target: GcsServerTarget, opts: GcsQueryOptions = {}): Promise<GcsServerStatus> {
  const game = gameDef(target.game);
  if (!game) return offline("unknown_game");
  const deadline = Date.now() + (opts.timeoutMs ?? 5000);
  const port = target.queryPort ?? target.port;
  try {
    const wantPlayers = opts.players !== false;
    // Discord: ID-ul serverului (nu o adresă); cererea pleacă doar spre `discord.com`, cu garda descărcărilor.
    if (game.protocol === "discord") return await queryDiscord(target.host, wantPlayers, deadline, opts.discord ?? fetchDiscordWidget);
    const address = await withDeadline(resolveTarget(target.host, { lookup: opts.lookup, allow: opts.allow }), deadline);
    switch (game.protocol) {
      case "teamspeak":
        return await queryTeamSpeak(address, target, wantPlayers, deadline);
      case "mumble":
        return await queryMumble(address, port, deadline, opts.retryMs ?? 2000);
      case "goldsrc":
      case "source":
        return await queryA2s(address, port, game.protocol, wantPlayers, deadline, opts.retryMs ?? 2000);
      case "minecraft":
        return await queryJava(address, port, target, wantPlayers, deadline);
      case "bedrock":
        return await queryBedrock(address, port, deadline, opts.retryMs ?? 2000);
    }
  } catch (error) {
    return offline(error instanceof GcsQueryFailure ? error.code : "unreachable");
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GcsQueryFailure("timeout")), Math.max(0, deadline - Date.now()));
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * O cerere A2S cu challenge și retrimitere: serverul poate răspunde cu un challenge (cererea se repetă cu el, de cel
 * mult 3 ori), iar fără răspuns în `retryMs` cererea se retrimite o dată. Pachetele împărțite se reasamblează; un
 * răspuns de alt tip (ex. unul întârziat) se ignoră. `onFirst` primește timpul până la primul răspuns (ping-ul).
 */
async function a2sExchange(
  channel: GcsUdpChannel,
  format: A2sFormat,
  build: (challenge?: Buffer) => Buffer,
  want: "info" | "players",
  deadline: number,
  retryMs: number,
  onFirst?: (ms: number) => void,
): Promise<A2sMessage> {
  let packet = build();
  let assembler = new A2sSplitAssembler();
  let rounds = 0;
  let resent = false;
  let first = true;
  await channel.send(packet);
  let sentAt = Date.now();
  for (;;) {
    let datagram: Buffer;
    try {
      datagram = await channel.next(resent ? deadline : Math.min(deadline, sentAt + retryMs));
    } catch (error) {
      if (error instanceof GcsQueryFailure && error.code === "timeout" && !resent && Date.now() < deadline) {
        resent = true;
        await channel.send(packet);
        sentAt = Date.now();
        continue;
      }
      throw error;
    }
    if (first) {
      first = false;
      onFirst?.(Date.now() - sentAt);
    }
    const parsed = parseA2sPacket(datagram, format);
    const payload = parsed.kind === "single" ? parsed.payload : assembler.add(parsed);
    if (!payload) continue;
    const message = parseA2sPayload(payload);
    if (message.type === "challenge") {
      if (++rounds > MAX_CHALLENGE_ROUNDS) throw new GcsQueryFailure("invalid_response");
      packet = build(message.challenge);
      assembler = new A2sSplitAssembler();
      resent = false;
      await channel.send(packet);
      sentAt = Date.now();
      continue;
    }
    if (message.type === want) return message;
  }
}

async function queryA2s(address: GcsResolvedAddress, port: number, format: A2sFormat, wantPlayers: boolean, deadline: number, retryMs: number): Promise<GcsServerStatus> {
  const channel = await GcsUdpChannel.open(address, port);
  try {
    let ping: number | null = null;
    const message = await a2sExchange(channel, format, a2sInfoRequest, "info", deadline, retryMs, (ms) => (ping = ms));
    if (message.type !== "info") throw new GcsQueryFailure("invalid_response");
    const info = message.info;
    let playerList: GcsServerPlayer[] | null = null;
    if (wantPlayers && Date.now() < deadline) {
      // Lista jucătorilor e un bonus: dacă nu vine, serverul rămâne online, fără listă.
      try {
        const players = await a2sExchange(channel, format, a2sPlayerRequest, "players", deadline, retryMs);
        if (players.type === "players") playerList = cleanPlayers(players.players);
      } catch {
        playerList = null;
      }
    }
    return {
      online: true,
      name: clean(info.name, TEXT_LIMITS.name),
      map: clean(info.map, TEXT_LIMITS.map),
      players: clampCount(info.players),
      maxPlayers: clampCount(info.maxPlayers),
      bots: clampCount(info.bots),
      ping,
      version: clean(info.version, TEXT_LIMITS.version),
      playerList,
      folder: clean(info.folder, 32),
      updatedAt: new Date().toISOString(),
      error: null,
    };
  } finally {
    channel.close();
  }
}

async function queryJava(address: GcsResolvedAddress, port: number, target: GcsServerTarget, wantPlayers: boolean, deadline: number): Promise<GcsServerStatus> {
  const reader = new McStatusReader();
  const request = Buffer.concat([minecraftHandshake(target.host, target.port), MINECRAFT_STATUS_REQUEST]);
  const { result, firstByteMs } = await tcpExchange(address, port, request, (chunk) => reader.push(chunk), deadline);
  const status = parseMinecraftStatus(result);
  return {
    online: true,
    name: clean(status.motd, TEXT_LIMITS.name),
    map: null,
    players: status.players,
    maxPlayers: status.maxPlayers,
    bots: 0,
    ping: firstByteMs,
    version: clean(status.version, TEXT_LIMITS.version),
    playerList: wantPlayers && status.sample ? cleanPlayers(status.sample.map((name) => ({ name, score: null, time: null }))) : null,
    updatedAt: new Date().toISOString(),
    error: null,
  };
}

async function queryBedrock(address: GcsResolvedAddress, port: number, deadline: number, retryMs: number): Promise<GcsServerStatus> {
  const channel = await GcsUdpChannel.open(address, port);
  try {
    const ping = bedrockPing(BigInt(Date.now()), randomBytes(8).readBigInt64BE());
    await channel.send(ping);
    let sentAt = Date.now();
    let resent = false;
    for (;;) {
      let datagram: Buffer;
      try {
        datagram = await channel.next(resent ? deadline : Math.min(deadline, sentAt + retryMs));
      } catch (error) {
        if (error instanceof GcsQueryFailure && error.code === "timeout" && !resent && Date.now() < deadline) {
          resent = true;
          await channel.send(ping);
          sentAt = Date.now();
          continue;
        }
        throw error;
      }
      if (datagram[0] !== 0x1c) continue;
      const rtt = Date.now() - sentAt;
      const pong = parseBedrockPong(datagram);
      return {
        online: true,
        name: clean(pong.motd, TEXT_LIMITS.name),
        map: null,
        players: pong.players,
        maxPlayers: pong.maxPlayers,
        bots: 0,
        ping: rtt,
        version: clean(pong.version, TEXT_LIMITS.version),
        playerList: null,
        updatedAt: new Date().toISOString(),
        error: null,
      };
    }
  } finally {
    channel.close();
  }
}

// ─── Comunicarea: TeamSpeak, Mumble, Discord ─────────────────────────────────────────────────────────────

function voiceStatus(info: { name: string | null; users: number; max: number; version: string | null; channels: number | null; ping: number | null; names: string[] | null; invite?: string | null }): GcsServerStatus {
  return {
    online: true,
    name: clean(info.name, TEXT_LIMITS.name),
    map: null,
    players: clampCount(info.users),
    maxPlayers: clampCount(info.max),
    bots: 0,
    ping: info.ping,
    version: clean(info.version, TEXT_LIMITS.version),
    playerList: info.names ? cleanPlayers(info.names.map((name) => ({ name, score: null, time: null }))) : null,
    channels: info.channels === null ? null : clampCount(info.channels),
    ...(info.invite !== undefined ? { invite: info.invite } : {}),
    updatedAt: new Date().toISOString(),
    error: null,
  };
}

/** O valoare scrisă de admin (utilizatorul de interogare) nu poate conține caractere de control. */
const safeCredential = (v: string) => !/[\u0000-\u001f\u007f]/.test(v) && v.length <= 200;

/**
 * TeamSpeak 3: ServerQuery pe TCP (`login` opțional, `use port=<voce>`, `serverinfo`, `clientlist`, `quit`) sau
 * WebQuery pe HTTP (`serveridgetbyport`, apoi `serverinfo` și `clientlist`, cheia API în antet). Parola se escapează
 * (nu poate începe o comandă nouă) și nu apare în niciun mesaj de eroare.
 */
async function queryTeamSpeak(address: GcsResolvedAddress, target: GcsServerTarget, wantPlayers: boolean, deadline: number): Promise<GcsServerStatus> {
  const auth = target.auth ?? null;
  if (auth && (!safeCredential(auth.user) || !safeCredential(auth.secret))) throw new GcsQueryFailure("auth_failed");
  const started = Date.now();
  const info = auth?.mode === "http" ? await tsWebQuery(address, target, auth, wantPlayers, deadline) : await tsServerQuery(address, target, auth, wantPlayers, deadline);
  return voiceStatus({ name: info.name, users: info.clients, max: info.maxClients, version: info.version, channels: info.channels, ping: Date.now() - started, names: info.names });
}

async function tsServerQuery(address: GcsResolvedAddress, target: GcsServerTarget, auth: GcsServerAuth | null, wantPlayers: boolean, deadline: number): Promise<GcsTsInfo> {
  const channel = await GcsTcpChannel.open(address, target.queryPort ?? 10011, deadline);
  const reader = new GcsTsLineReader();
  const command = async (line: string) => {
    channel.send(Buffer.from(`${line}\n`, "utf8"));
    for (;;) {
      const done = reader.shift();
      if (done) return done;
      reader.push(await channel.next(deadline));
    }
  };
  try {
    // Bannerul (`TS3`): altceva pe port = nu e un ServerQuery.
    const first = await channel.next(deadline);
    if (!first.toString("utf8").startsWith("TS3")) throw new GcsQueryFailure("invalid_response");
    reader.push(first);
    if (auth && auth.user) {
      const login = await command(`login client_login_name=${tsEscape(auth.user)} client_login_password=${tsEscape(auth.secret)}`);
      if (login.error.id !== 0) throw tsFailure(login.error);
    }
    const use = await command(`use port=${target.port}`);
    if (use.error.id !== 0) throw tsFailure(use.error);
    const info = await command("serverinfo");
    if (info.error.id !== 0) throw tsFailure(info.error);
    let clients: Record<string, string>[] | null = null;
    if (wantPlayers && Date.now() < deadline) {
      try {
        const list = await command("clientlist");
        if (list.error.id === 0) clients = tsParseRecords(list.lines.join(""));
      } catch {
        clients = null;
      }
    }
    try {
      channel.send(Buffer.from("quit\n"));
    } catch {
      // Deja închis.
    }
    return tsServerInfo(tsParseRecords(info.lines.join(""))[0] ?? {}, clients);
  } finally {
    channel.close();
  }
}

async function tsWebQuery(address: GcsResolvedAddress, target: GcsServerTarget, auth: GcsServerAuth, wantPlayers: boolean, deadline: number): Promise<GcsTsInfo> {
  const port = target.queryPort ?? 10080;
  const get = async (path: string) => tsWebBody(await httpGetJson(address, port, path, { host: target.host, headers: { "x-api-key": auth.secret }, deadline, maxBytes: TS_MAX_BYTES }));
  const sid = Number((await get(`/serveridgetbyport?virtualserver_port=${target.port}`))[0]?.server_id);
  if (!Number.isInteger(sid) || sid <= 0) throw new GcsQueryFailure("not_found");
  const info = (await get(`/${sid}/serverinfo`))[0] ?? {};
  let clients: Record<string, string>[] | null = null;
  if (wantPlayers && Date.now() < deadline) clients = await get(`/${sid}/clientlist`).catch(() => null);
  return tsServerInfo(info, clients);
}

/** Mumble: pingul UDP (fără cont), cu o retrimitere; dă versiunea, utilizatorii și sloturile. */
async function queryMumble(address: GcsResolvedAddress, port: number, deadline: number, retryMs: number): Promise<GcsServerStatus> {
  const channel = await GcsUdpChannel.open(address, port);
  try {
    const ident = randomBytes(8);
    const ping = mumblePing(ident);
    await channel.send(ping);
    let sentAt = Date.now();
    let resent = false;
    for (;;) {
      let datagram: Buffer;
      try {
        datagram = await channel.next(resent ? deadline : Math.min(deadline, sentAt + retryMs));
      } catch (error) {
        if (error instanceof GcsQueryFailure && error.code === "timeout" && !resent && Date.now() < deadline) {
          resent = true;
          await channel.send(ping);
          sentAt = Date.now();
          continue;
        }
        throw error;
      }
      if (datagram.length < 24 || !datagram.subarray(4, 12).equals(ident)) continue;
      const pong = parseMumblePong(datagram, ident);
      return voiceStatus({ name: null, users: pong.users, max: pong.maxUsers, version: pong.version, channels: null, ping: Date.now() - sentAt, names: null });
    }
  } finally {
    channel.close();
  }
}

/** Widget-ul public al unui server de Discord, prin garda descărcărilor (doar `discord.com:443`, fără redirecturi). */
const fetchDiscordWidget: GcsDiscordFetch = async (guildId, deadline) => {
  try {
    const res = await safeFetchBuffer(`https://discord.com/api/guilds/${guildId}/widget.json`, { maxBytes: DISCORD_MAX_BYTES, maxRedirects: 0, ports: [443], timeoutMs: Math.max(500, deadline - Date.now()) });
    return JSON.parse(res.bytes.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof GcsBlockedFetch) {
      // Discord răspunde cu 403 + `{ code: 50004 }` când widget-ul e oprit și 404 la un ID necunoscut.
      if (error.reason === "http_403") throw new GcsQueryFailure("widget_disabled");
      if (error.reason === "http_404") throw new GcsQueryFailure("not_found");
      if (error.reason === "timeout") throw new GcsQueryFailure("timeout");
      if (error.reason === "too_large") throw new GcsQueryFailure("too_large");
      throw new GcsQueryFailure("unreachable");
    }
    throw new GcsQueryFailure("invalid_response");
  }
};

async function queryDiscord(guildId: string, wantPlayers: boolean, deadline: number, fetchWidget: GcsDiscordFetch): Promise<GcsServerStatus> {
  if (!DISCORD_GUILD_RE.test(guildId)) throw new GcsQueryFailure("not_found");
  const started = Date.now();
  const widget = parseDiscordWidget(await withDeadline(fetchWidget(guildId, deadline), deadline));
  return voiceStatus({ name: widget.name, users: widget.online, max: 0, version: null, channels: widget.channels, ping: Date.now() - started, names: wantPlayers ? widget.members : null, invite: widget.invite });
}
