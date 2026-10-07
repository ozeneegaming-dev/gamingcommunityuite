import dgram from "node:dgram";
import net from "node:net";

/**
 * Fixture-urile binare ale protocoalelor de joc (construite octet cu octet după documentația publică a protocoalelor)
 * și un server de joc fals local (UDP: A2S + Bedrock; TCP: Minecraft Java), pentru testele de interogare.
 */

const SINGLE = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const SPLIT = Buffer.from([0xfe, 0xff, 0xff, 0xff]);
const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const u8 = (...n: number[]) => Buffer.from(n);
const i16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16LE(n);
  return b;
};
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const f32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b;
};

export type FakeInfo = { name: string; map: string; players: number; maxPlayers: number; bots: number; version: string };
export type FakePlayer = { name: string; score: number; time: number };

const DEFAULT_INFO: FakeInfo = { name: "GCS | Competitive #1", map: "de_mirage", players: 27, maxPlayers: 32, bots: 2, version: "1.40.2.1" };

export const a2sFixtures = {
  challenge: (c: Buffer) => Buffer.concat([SINGLE, u8(0x41), c]),

  /** Răspunsul Source (0x49), cu câmpurile EDF (portul și id-ul jocului) la final. */
  sourceInfo: (o: Partial<FakeInfo> = {}) => {
    const i = { ...DEFAULT_INFO, ...o };
    return Buffer.concat([
      SINGLE,
      u8(0x49, 17),
      cstr(i.name),
      cstr(i.map),
      cstr("csgo"),
      cstr("Counter-Strike 2"),
      i16(730),
      u8(i.players, i.maxPlayers, i.bots, 0x64, 0x6c, 0, 1),
      cstr(i.version),
      u8(0x80 | 0x01),
      i16(27015),
      Buffer.from([0xda, 0x02, 0, 0, 0, 0, 0, 0]),
    ]);
  },

  /** Răspunsul GoldSrc vechi (0x6D), cu blocul de mod (`mod = 1`). */
  goldsrcInfo: (o: Partial<FakeInfo> = {}) => {
    const i = { ...DEFAULT_INFO, name: "GCS Classic 1.6", map: "de_dust2", players: 19, maxPlayers: 32, bots: 1, ...o };
    return Buffer.concat([
      SINGLE,
      u8(0x6d),
      cstr("203.0.113.10:27016"),
      cstr(i.name),
      cstr(i.map),
      cstr("cstrike"),
      cstr("Counter-Strike"),
      u8(i.players, i.maxPlayers, 48, 0x64, 0x6c, 0, 1),
      cstr("http://www.example.com"),
      cstr(""),
      u8(0),
      i32(1),
      i32(184_000_000),
      u8(0, 1),
      u8(1, i.bots),
    ]);
  },

  players: (list: FakePlayer[]) =>
    Buffer.concat([SINGLE, u8(0x44, list.length), ...list.flatMap((p, i) => [u8(i), cstr(p.name), i32(p.score), f32(p.time)])]),

  /** Un răspuns (cu antetul simplu) împărțit în `total` pachete Source (id, total, număr, mărime). */
  splitSource: (packet: Buffer, id: number, total: number) =>
    chunks(packet, total).map((chunk, n) => Buffer.concat([SPLIT, u32(id), u8(total, n), i16(1248), chunk])),

  /** Același răspuns în pachete GoldSrc (numărul în cei 4 biți de sus, totalul în cei de jos). */
  splitGoldsrc: (packet: Buffer, id: number, total: number) => chunks(packet, total).map((chunk, n) => Buffer.concat([SPLIT, u32(id), u8((n << 4) | total), chunk])),
};

function chunks(buf: Buffer, total: number): Buffer[] {
  const size = Math.ceil(buf.length / total);
  return Array.from({ length: total }, (_, i) => buf.subarray(i * size, Math.min(buf.length, (i + 1) * size)));
}

function varint(n: number): Buffer {
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

export const BEDROCK_MAGIC = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");

export type FakeBedrock = { motd: string; version: string; players: number; maxPlayers: number; level: string };

export const mcFixtures = {
  varint,
  /** Răspunsul de status Java: lungimea pachetului, id-ul 0x00 și JSON-ul ca șir cu lungime VarInt. */
  statusResponse: (json: unknown) => {
    const text = Buffer.from(typeof json === "string" ? json : JSON.stringify(json), "utf8");
    const packet = Buffer.concat([varint(0), varint(text.length), text]);
    return Buffer.concat([varint(packet.length), packet]);
  },
  /** Unconnected Pong (0x1C) Bedrock. */
  bedrockPong: (o: Partial<FakeBedrock> = {}) => {
    const b = { motd: "GCS Bedrock", version: "1.21.2", players: 4, maxPlayers: 20, level: "Lumea GCS", ...o };
    const text = Buffer.from(`MCPE;${b.motd};686;${b.version};${b.players};${b.maxPlayers};13253860892328930865;${b.level};Survival;1;19132;19133;`, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(text.length);
    return Buffer.concat([u8(0x1c), Buffer.alloc(8), Buffer.from("0102030405060708", "hex"), BEDROCK_MAGIC, len, text]);
  },
};

export const DEFAULT_MC_STATUS = {
  version: { name: "Paper 1.21.1", protocol: 767 },
  players: { max: 60, online: 12, sample: [{ name: "§aSteve", id: "00000000-0000-0000-0000-000000000001" }, { name: "Alex", id: "00000000-0000-0000-0000-000000000002" }] },
  description: { text: "§6GCS ", extra: [{ text: "Survival", bold: true }] },
};

export type FakeGameState = {
  /** `false`: serverul nu mai răspunde (UDP tace, TCP închide conexiunea). */
  online: boolean;
  /** A2S cere challenge și pentru A2S_INFO (serverele actualizate după 2020). */
  infoChallenge: boolean;
  format: "source" | "goldsrc";
  info: Partial<FakeInfo>;
  players: FakePlayer[];
  minecraft: unknown;
  bedrock: Partial<FakeBedrock>;
};

export type FakeGameServer = { host: string; udpPort: number; tcpPort: number; requests: number; set(patch: Partial<FakeGameState>): void; close(): Promise<void> };

const CHALLENGE = Buffer.from([0x11, 0x22, 0x33, 0x44]);

/**
 * Un server de joc fals pe 127.0.0.1: un socket UDP care răspunde la A2S (cu challenge, listă de jucători împărțită
 * în pachete peste 1200 de octeți) și la ping-ul Bedrock, plus un socket TCP care răspunde la Server List Ping.
 */
export async function startFakeGameServer(initial: Partial<FakeGameState> = {}): Promise<FakeGameServer> {
  const state: FakeGameState = { online: true, infoChallenge: true, format: "source", info: {}, players: [], minecraft: DEFAULT_MC_STATUS, bedrock: {}, ...initial };
  const udp = dgram.createSocket("udp4");
  const fake: FakeGameServer = { host: "127.0.0.1", udpPort: 0, tcpPort: 0, requests: 0, set: (patch) => Object.assign(state, patch), close: async () => {} };

  udp.on("message", (msg, rinfo) => {
    fake.requests++;
    if (!state.online) return;
    const reply = (buf: Buffer) => udp.send(buf, rinfo.port, rinfo.address);
    if (msg[0] === 0x01 && msg.length >= 33) return reply(mcFixtures.bedrockPong(state.bedrock));
    if (!msg.subarray(0, 4).equals(SINGLE)) return;
    const type = msg[4];
    if (type === 0x54) {
      const challenge = msg.subarray(msg.length - 4);
      if (state.infoChallenge && !challenge.equals(CHALLENGE)) return reply(a2sFixtures.challenge(CHALLENGE));
      return reply(state.format === "goldsrc" ? a2sFixtures.goldsrcInfo(state.info) : a2sFixtures.sourceInfo(state.info));
    }
    if (type === 0x55) {
      if (!msg.subarray(5, 9).equals(CHALLENGE)) return reply(a2sFixtures.challenge(CHALLENGE));
      const packet = a2sFixtures.players(state.players);
      if (packet.length <= 1200) return reply(packet);
      const total = Math.ceil(packet.length / 1200);
      const parts = state.format === "goldsrc" ? a2sFixtures.splitGoldsrc(packet, 4242, total) : a2sFixtures.splitSource(packet, 4242, total);
      for (const part of parts) reply(part);
    }
  });
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", () => resolve()));
  fake.udpPort = (udp.address() as net.AddressInfo).port;

  const tcp = net.createServer((socket) => {
    fake.requests++;
    if (!state.online) return socket.destroy();
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      // Handshake-ul se termină cu starea 1, urmat de cererea de status (0x01 0x00).
      if (received.length >= 2 && received[received.length - 2] === 0x01 && received[received.length - 1] === 0x00) {
        socket.end(mcFixtures.statusResponse(state.minecraft));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", () => resolve()));
  fake.tcpPort = (tcp.address() as net.AddressInfo).port;

  fake.close = async () => {
    udp.close();
    await new Promise<void>((resolve) => tcp.close(() => resolve()));
  };
  return fake;
}
