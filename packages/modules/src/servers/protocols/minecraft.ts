import { chatComponentText } from "../text";
import { GcsByteReader, GcsQueryFailure } from "./reader";

/**
 * Protocoalele de status Minecraft, după documentația publică a comunității: Server List Ping (Java, TCP) și
 * Unconnected Ping (Bedrock, RakNet peste UDP). Totul e pur (fără rețea).
 */

/** Răspunsul de status Java (JSON-ul cu favicon-ul inclus) are cel mult atâția octeți. */
export const MINECRAFT_MAX_BYTES = 128 * 1024;
const MAX_COUNT = 1_000_000;
const MAX_SAMPLE = 128;

export function writeVarInt(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

/** Un VarInt de la `offset`: valoarea și câți octeți ocupă; `null` dacă bufferul se termină înainte. */
export function readVarInt(buf: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i]!;
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return { value: value | 0, size: i + 1 };
  }
  throw new GcsQueryFailure("invalid_response");
}

function mcString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([writeVarInt(bytes.length), bytes]);
}

/**
 * Handshake-ul (pachetul 0x00): protocolul -1 („doar aflu versiunea”), adresa așa cum a scris-o adminul (proxy-urile
 * aleg serverul după ea), portul big-endian și starea 1 (status). Cu lungimea în față.
 */
export function minecraftHandshake(host: string, port: number): Buffer {
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  const body = Buffer.concat([writeVarInt(0x00), writeVarInt(-1), mcString(host.slice(0, 255)), portBytes, writeVarInt(1)]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

/** Cererea de status: un pachet gol cu id-ul 0x00. */
export const MINECRAFT_STATUS_REQUEST = Buffer.from([0x01, 0x00]);

/**
 * Răspunsul de status, citit din bucățile TCP: lungimea pachetului (VarInt), id-ul 0x00 și JSON-ul ca șir. Lungimea
 * declarată și octeții primiți sunt limitați (`too_large`), ca un server să nu poată umple memoria.
 */
export class McStatusReader {
  private buf = Buffer.alloc(0);
  private readonly maxBytes: number;

  constructor(opts: { maxBytes?: number } = {}) {
    this.maxBytes = opts.maxBytes ?? MINECRAFT_MAX_BYTES;
  }

  push(chunk: Buffer): string | null {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > this.maxBytes + 10) throw new GcsQueryFailure("too_large");
    const length = readVarInt(this.buf, 0);
    if (!length) return null;
    if (length.value <= 0) throw new GcsQueryFailure("invalid_response");
    if (length.value > this.maxBytes) throw new GcsQueryFailure("too_large");
    const id = readVarInt(this.buf, length.size);
    if (id && id.value !== 0x00) throw new GcsQueryFailure("invalid_response");
    if (this.buf.length < length.size + length.value) return null;
    const packet = this.buf.subarray(length.size, length.size + length.value);
    const strLen = readVarInt(packet, id!.size);
    if (!strLen || strLen.value < 0 || id!.size + strLen.size + strLen.value > packet.length) throw new GcsQueryFailure("invalid_response");
    const start = id!.size + strLen.size;
    return packet.subarray(start, start + strLen.value).toString("utf8");
  }
}

export type McStatus = { version: string | null; players: number; maxPlayers: number; sample: string[] | null; motd: string };

const count = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_COUNT) throw new GcsQueryFailure("invalid_response");
  return v;
};

/** JSON-ul de status Java: versiunea, jucătorii, eșantionul de nume (dacă există) și MOTD-ul aplatizat. */
export function parseMinecraftStatus(json: string): McStatus {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new GcsQueryFailure("invalid_response");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new GcsQueryFailure("invalid_response");
  const obj = data as { version?: { name?: unknown }; players?: { online?: unknown; max?: unknown; sample?: unknown }; description?: unknown };
  const players = obj.players ?? {};
  const sample = Array.isArray(players.sample)
    ? players.sample
        .slice(0, MAX_SAMPLE)
        .map((p) => (p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string" ? (p as { name: string }).name : null))
        .filter((n): n is string => n !== null)
    : null;
  return {
    version: typeof obj.version?.name === "string" ? obj.version.name : null,
    players: count(players.online ?? 0),
    maxPlayers: count(players.max ?? 0),
    sample,
    motd: chatComponentText(obj.description ?? ""),
  };
}

/** Magia RakNet a mesajelor offline. */
const RAKNET_MAGIC = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");

/** Unconnected Ping (0x01): timpul clientului, magia RakNet și GUID-ul clientului. */
export function bedrockPing(time: bigint, guid: bigint): Buffer {
  const out = Buffer.alloc(33);
  out[0] = 0x01;
  out.writeBigInt64BE(time, 1);
  RAKNET_MAGIC.copy(out, 9);
  out.writeBigInt64BE(guid, 25);
  return out;
}

export type BedrockStatus = { motd: string; version: string; players: number; maxPlayers: number; level: string };

/** Unconnected Pong (0x1C): `MCPE;motd;protocol;versiune;jucători;max;id;nivel;mod;…`. */
export function parseBedrockPong(buf: Buffer): BedrockStatus {
  const r = new GcsByteReader(buf);
  if (r.byte() !== 0x1c) throw new GcsQueryFailure("invalid_response");
  r.skip(16); // timpul și GUID-ul serverului
  if (!r.bytes(16).equals(RAKNET_MAGIC)) throw new GcsQueryFailure("invalid_response");
  const length = r.uint16BE();
  const text = r.bytes(length).toString("utf8");
  const parts = text.split(";");
  if (parts.length < 6 || !/^MC(PE|EE)$/.test(parts[0]!)) throw new GcsQueryFailure("invalid_response");
  const num = (s: string | undefined) => {
    if (!s || !/^\d{1,7}$/.test(s)) throw new GcsQueryFailure("invalid_response");
    return Number(s);
  };
  return { motd: parts[1] ?? "", version: parts[3] ?? "", players: num(parts[4]), maxPlayers: num(parts[5]), level: parts[7] ?? "" };
}
