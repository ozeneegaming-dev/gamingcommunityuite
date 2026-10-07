import dgram from "node:dgram";
import net from "node:net";

/**
 * Un server de joc fals pentru E2E (aplicația Servere), pe 127.0.0.1: UDP răspunde la A2S (Source, cu challenge la
 * A2S_INFO și A2S_PLAYER), TCP răspunde la Server List Ping-ul Minecraft. Instanțele E2E au excepția operatorului
 * `GCS_SERVERS_ALLOW_NETS=127.0.0.1/32` (setată de `e2e/run.mts`), altfel adresa locală ar fi refuzată.
 */

export type FakePlayer = { name: string; score: number; time: number };
export type FakeState = { online: boolean; name: string; map: string; players: FakePlayer[]; maxPlayers: number; motd: string; mcOnline: number };

const SINGLE = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const CHALLENGE = Buffer.from([0x5a, 0x4b, 0x3c, 0x2d]);
const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);

function info(s: FakeState): Buffer {
  const app = Buffer.alloc(2);
  app.writeInt16LE(730);
  return Buffer.concat([
    SINGLE,
    Buffer.from([0x49, 17]),
    cstr(s.name),
    cstr(s.map),
    cstr("csgo"),
    cstr("Counter-Strike 2"),
    app,
    Buffer.from([s.players.length, s.maxPlayers, 0, 0x64, 0x6c, 0, 1]),
    cstr("1.40.2.1"),
  ]);
}

function players(list: FakePlayer[]): Buffer {
  return Buffer.concat([
    SINGLE,
    Buffer.from([0x44, list.length]),
    ...list.map((p, i) => {
      const nums = Buffer.alloc(8);
      nums.writeInt32LE(p.score, 0);
      nums.writeFloatLE(p.time, 4);
      return Buffer.concat([Buffer.from([i]), cstr(p.name), nums]);
    }),
  ]);
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

function mcStatus(s: FakeState): Buffer {
  const json = Buffer.from(JSON.stringify({ version: { name: "Paper 1.21.1", protocol: 767 }, players: { max: 60, online: s.mcOnline, sample: [{ name: "Steve", id: "0" }] }, description: { text: s.motd } }), "utf8");
  const packet = Buffer.concat([varint(0), varint(json.length), json]);
  return Buffer.concat([varint(packet.length), packet]);
}

export type FakeGameServer = { udpPort: number; tcpPort: number; state: FakeState; close(): Promise<void> };

export async function startFakeGameServer(initial: Partial<FakeState> = {}): Promise<FakeGameServer> {
  const state: FakeState = {
    online: true,
    name: "GCS E2E | Competitive",
    map: "de_mirage",
    players: [
      { name: "ShadowRO", score: 34, time: 4320 },
      { name: "NeoX", score: 28, time: 2880 },
      { name: "Ana_G", score: 19, time: 2100 },
    ],
    maxPlayers: 32,
    motd: "§6GCS §aSurvival",
    mcOnline: 12,
    ...initial,
  };
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    if (!state.online || !msg.subarray(0, 4).equals(SINGLE)) return;
    const reply = (buf: Buffer) => udp.send(buf, rinfo.port, rinfo.address);
    if (msg[4] === 0x54) return reply(msg.subarray(msg.length - 4).equals(CHALLENGE) ? info(state) : Buffer.concat([SINGLE, Buffer.from([0x41]), CHALLENGE]));
    if (msg[4] === 0x55) return reply(msg.subarray(5, 9).equals(CHALLENGE) ? players(state.players) : Buffer.concat([SINGLE, Buffer.from([0x41]), CHALLENGE]));
  });
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", () => resolve()));
  const tcp = net.createServer((socket) => {
    if (!state.online) return socket.destroy();
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 2 && received[received.length - 2] === 0x01 && received[received.length - 1] === 0x00) socket.end(mcStatus(state));
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", () => resolve()));
  return {
    udpPort: (udp.address() as net.AddressInfo).port,
    tcpPort: (tcp.address() as net.AddressInfo).port,
    state,
    close: async () => {
      udp.close();
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
    },
  };
}
