import { GcsByteReader, GcsQueryFailure } from "./reader";

/**
 * Protocolul de interogare A2S (Source și GoldSrc), după documentația publică „Server queries”: cererile, răspunsurile
 * (challenge, informațiile serverului, jucătorii) și pachetele împărțite. Totul e pur (fără rețea), ca să se poată testa
 * cu fixture-uri binare.
 */

const SINGLE = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const NO_CHALLENGE = SINGLE;
const INFO_QUERY = Buffer.from("Source Engine Query\0", "latin1");

/** Cel mult atâtea pachete într-un răspuns împărțit și atâția octeți în total. */
export const A2S_MAX_PARTS = 16;
export const A2S_MAX_BYTES = 64 * 1024;
/** Cel mult atâția jucători din listă (restul se ignoră). */
export const A2S_MAX_PLAYERS = 128;

export type A2sFormat = "source" | "goldsrc";

export type A2sInfo = {
  format: A2sFormat;
  name: string;
  map: string;
  folder: string;
  game: string;
  players: number;
  maxPlayers: number;
  bots: number;
  /** Versiunea jocului (doar răspunsul Source o are). */
  version: string | null;
};

export type A2sPlayer = { name: string; score: number; time: number };

export type A2sMessage = { type: "challenge"; challenge: Buffer } | { type: "info"; info: A2sInfo } | { type: "players"; players: A2sPlayer[] };

export type A2sPacket = { kind: "single"; payload: Buffer } | { kind: "split"; id: number; number: number; total: number; data: Buffer };

/** `A2S_INFO`, cu challenge-ul primit (serverele actualizate cer challenge și aici). */
export function a2sInfoRequest(challenge?: Buffer): Buffer {
  return Buffer.concat([SINGLE, Buffer.from([0x54]), INFO_QUERY, ...(challenge ? [challenge] : [])]);
}

/** `A2S_PLAYER`: fără challenge (FF FF FF FF) serverul răspunde cu unul. */
export function a2sPlayerRequest(challenge?: Buffer): Buffer {
  return Buffer.concat([SINGLE, Buffer.from([0x55]), challenge ?? NO_CHALLENGE]);
}

/**
 * Antetul unui datagram: simplu (`FF FF FF FF`, conținutul urmează) sau împărțit (`FE FF FF FF`). La formatul Source
 * pachetul împărțit are id, total, număr și mărime; la GoldSrc numărul și totalul stau într-un singur octet.
 */
export function parseA2sPacket(buf: Buffer, format: A2sFormat): A2sPacket {
  const r = new GcsByteReader(buf);
  const header = r.int32();
  if (header === -1) return { kind: "single", payload: buf.subarray(4) };
  if (header !== -2) throw new GcsQueryFailure("invalid_response");
  const id = r.int32();
  let number: number;
  let total: number;
  if (format === "goldsrc") {
    const b = r.byte();
    number = b >> 4;
    total = b & 0x0f;
  } else {
    // Bitul de sus al id-ului = răspuns comprimat (bzip2): nu acceptăm decompresia.
    if ((id & 0x80000000) !== 0) throw new GcsQueryFailure("invalid_response");
    total = r.byte();
    number = r.byte();
    r.int16();
  }
  if (total < 1 || number >= total) throw new GcsQueryFailure("invalid_response");
  if (total > A2S_MAX_PARTS) throw new GcsQueryFailure("too_large");
  return { kind: "split", id, number, total, data: buf.subarray(buf.length - r.remaining) };
}

/** Reasamblează un răspuns împărțit (părțile pot veni în orice ordine); întoarce conținutul când e complet. */
export class A2sSplitAssembler {
  private id: number | null = null;
  private total = 0;
  private size = 0;
  private readonly parts = new Map<number, Buffer>();
  private readonly maxBytes: number;

  constructor(opts: { maxBytes?: number } = {}) {
    this.maxBytes = opts.maxBytes ?? A2S_MAX_BYTES;
  }

  add(packet: Extract<A2sPacket, { kind: "split" }>): Buffer | null {
    if (this.id === null) {
      this.id = packet.id;
      this.total = packet.total;
    }
    // Un pachet al altui răspuns (ex. unul întârziat) se ignoră.
    if (packet.id !== this.id || packet.total !== this.total || this.parts.has(packet.number)) return null;
    this.size += packet.data.length;
    if (this.size > this.maxBytes) throw new GcsQueryFailure("too_large");
    this.parts.set(packet.number, packet.data);
    if (this.parts.size < this.total) return null;
    const joined = Buffer.concat(Array.from({ length: this.total }, (_, i) => this.parts.get(i)!));
    if (!joined.subarray(0, 4).equals(SINGLE)) throw new GcsQueryFailure("invalid_response");
    return joined.subarray(4);
  }
}

/** Conținutul unui răspuns (după antetul simplu): challenge, informațiile serverului sau jucătorii. */
export function parseA2sPayload(payload: Buffer): A2sMessage {
  const r = new GcsByteReader(payload);
  const type = r.byte();
  switch (type) {
    case 0x41:
      return { type: "challenge", challenge: Buffer.from(r.bytes(4)) };
    case 0x49:
      return { type: "info", info: sourceInfo(r) };
    case 0x6d:
      return { type: "info", info: goldsrcInfo(r) };
    case 0x44:
      return { type: "players", players: players(r) };
    default:
      throw new GcsQueryFailure("invalid_response");
  }
}

function sourceInfo(r: GcsByteReader): A2sInfo {
  r.byte(); // versiunea protocolului
  const name = r.string();
  const map = r.string();
  const folder = r.string();
  const game = r.string();
  const appId = r.int16() & 0xffff;
  const players = r.byte();
  const maxPlayers = r.byte();
  const bots = r.byte();
  r.skip(4); // tipul serverului, sistemul, parola, VAC
  if (appId === 2400) r.skip(3); // The Ship: modul, martorii, durata
  const version = r.string();
  // Câmpurile EDF (portul, SteamID, SourceTV, cuvintele cheie, id-ul jocului) nu ne trebuie.
  return { format: "source", name, map, folder, game, players, maxPlayers, bots, version };
}

function goldsrcInfo(r: GcsByteReader): A2sInfo {
  r.string(); // adresa raportată de server
  const name = r.string();
  const map = r.string();
  const folder = r.string();
  const game = r.string();
  const players = r.byte();
  const maxPlayers = r.byte();
  r.skip(4); // protocolul, tipul serverului, sistemul, parola
  const mod = r.byte();
  if (mod === 1) {
    r.string(); // site-ul modului
    r.string(); // linkul de descărcare
    r.skip(1 + 4 + 4 + 1 + 1); // nul, versiunea, mărimea, tipul, DLL-ul propriu
  }
  r.byte(); // VAC
  const bots = r.byte();
  return { format: "goldsrc", name, map, folder, game, players, maxPlayers, bots, version: null };
}

/** Lista jucătorilor; un rând trunchiat (unele servere taie răspunsul) încheie lista. */
function players(r: GcsByteReader): A2sPlayer[] {
  const count = r.byte();
  const out: A2sPlayer[] = [];
  for (let i = 0; i < count && out.length < A2S_MAX_PLAYERS && r.remaining > 0; i++) {
    try {
      r.byte(); // indexul
      const name = r.string(256);
      const score = r.int32();
      const time = r.float();
      out.push({ name, score, time: Number.isFinite(time) && time > 0 ? Math.round(time * 10) / 10 : 0 });
    } catch {
      break;
    }
  }
  return out;
}
