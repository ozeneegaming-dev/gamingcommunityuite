import { randomBytes } from "node:crypto";
import type { BlockList } from "node:net";
import { gameDef } from "./games";
import { GcsUdpChannel, resolveTarget, tcpExchange, type GcsLookup, type GcsResolvedAddress } from "./net";
import { A2sSplitAssembler, a2sInfoRequest, a2sPlayerRequest, parseA2sPacket, parseA2sPayload, type A2sFormat, type A2sMessage } from "./protocols/a2s";
import { bedrockPing, McStatusReader, minecraftHandshake, MINECRAFT_STATUS_REQUEST, parseBedrockPong, parseMinecraftStatus } from "./protocols/minecraft";
import { GcsQueryFailure } from "./protocols/reader";
import { cleanGameText } from "./text";
import type { GcsServerPlayer, GcsServerStatus } from "./types";

export type GcsServerTarget = { game: string; host: string; port: number; queryPort?: number | null };

export type GcsQueryOptions = {
  /** Termenul întregii interogări (DNS + răspunsuri), implicit 5 s. */
  timeoutMs?: number;
  /** După cât timp fără răspuns se retrimite o dată cererea UDP (implicit 2 s). */
  retryMs?: number;
  /** Lista jucătorilor (A2S_PLAYER / eșantionul Minecraft); implicit da. */
  players?: boolean;
  lookup?: GcsLookup;
  allow?: BlockList | null;
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
    const address = await withDeadline(resolveTarget(target.host, { lookup: opts.lookup, allow: opts.allow }), deadline);
    const wantPlayers = opts.players !== false;
    switch (game.protocol) {
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
