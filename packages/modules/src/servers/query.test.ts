import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { startFakeGameServer, type FakeGameServer } from "../../test/gameFixtures";
import { parseAllowNets } from "./net";
import { queryGameServer } from "./query";

let fake: FakeGameServer;
const allow = parseAllowNets("127.0.0.1/32");
// Termene scurte: serverul fals e local.
const fast = { allow, timeoutMs: 1500, retryMs: 300 };

beforeAll(async () => {
  fake = await startFakeGameServer();
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.set({ online: true, infoChallenge: true, format: "source", info: {}, players: [] });
});

describe("interogarea unui server (server fals local)", () => {
  test("CS2 (Source): challenge la A2S_INFO, apoi lista jucătorilor; textele sunt curățate", async () => {
    fake.set({ info: { name: "\x01GCS §a| Competitive", map: "de_mirage" }, players: [{ name: "Shadow\x03RO", score: 34, time: 4320.4 }, { name: "", score: 0, time: 1 }] });
    const status = await queryGameServer({ game: "cs2", host: "127.0.0.1", port: fake.udpPort }, fast);
    expect(status).toMatchObject({
      online: true,
      name: "GCS | Competitive",
      map: "de_mirage",
      players: 27,
      maxPlayers: 32,
      bots: 2,
      version: "1.40.2.1",
      playerList: [{ name: "ShadowRO", score: 34, time: 4320 }],
      error: null,
    });
    expect(status.ping).toBeGreaterThanOrEqual(0);
  });

  test("CS 1.6 (GoldSrc): răspunsul vechi și lista mare, împărțită în pachete GoldSrc", async () => {
    const players = Array.from({ length: 60 }, (_, i) => ({ name: `Jucator_cu_nume_lung_${i}`, score: i, time: i * 60 }));
    fake.set({ format: "goldsrc", infoChallenge: false, players });
    const status = await queryGameServer({ game: "cs16", host: "127.0.0.1", port: fake.udpPort }, fast);
    expect(status).toMatchObject({ online: true, name: "GCS Classic 1.6", map: "de_dust2", players: 19, version: null });
    expect(status.playerList).toHaveLength(60);
  });

  test("portul de interogare separat are prioritate față de portul jocului", async () => {
    const status = await queryGameServer({ game: "cs2", host: "127.0.0.1", port: 1, queryPort: fake.udpPort }, fast);
    expect(status.online).toBe(true);
  });

  test("fără lista jucătorilor (`players: false`) nu se trimite A2S_PLAYER", async () => {
    const status = await queryGameServer({ game: "cs2", host: "127.0.0.1", port: fake.udpPort }, { ...fast, players: false });
    expect(status).toMatchObject({ online: true, playerList: null });
  });

  test("Minecraft Java: MOTD-ul fără coduri §, versiunea, jucătorii și eșantionul de nume", async () => {
    const status = await queryGameServer({ game: "minecraft", host: "127.0.0.1", port: fake.tcpPort }, fast);
    expect(status).toMatchObject({
      online: true,
      name: "GCS Survival",
      map: null,
      version: "Paper 1.21.1",
      players: 12,
      maxPlayers: 60,
      playerList: [
        { name: "Steve", score: null, time: null },
        { name: "Alex", score: null, time: null },
      ],
    });
  });

  test("Minecraft Bedrock: pong-ul RakNet", async () => {
    const status = await queryGameServer({ game: "minecraft_bedrock", host: "127.0.0.1", port: fake.udpPort }, fast);
    expect(status).toMatchObject({ online: true, name: "GCS Bedrock", version: "1.21.2", players: 4, maxPlayers: 20, playerList: null });
  });

  test("un server care nu răspunde: offline, după o retrimitere, cu `timeout`", async () => {
    fake.set({ online: false });
    const before = fake.requests;
    const started = Date.now();
    const status = await queryGameServer({ game: "cs2", host: "127.0.0.1", port: fake.udpPort }, fast);
    expect(status).toMatchObject({ online: false, error: "timeout", players: 0, playerList: null });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(fake.requests - before).toBe(2);
  });

  test("Minecraft pe un port închis: `refused`; un răspuns JSON stricat: `invalid_response`", async () => {
    const closed = await queryGameServer({ game: "minecraft", host: "127.0.0.1", port: 1 }, fast);
    expect(closed).toMatchObject({ online: false });
    expect(["refused", "unreachable", "timeout"]).toContain(closed.error);
    fake.set({ minecraft: "{nu e json" });
    expect(await queryGameServer({ game: "minecraft", host: "127.0.0.1", port: fake.tcpPort }, fast)).toMatchObject({ online: false, error: "invalid_response" });
  });

  test("fără excepția operatorului, adresa locală e refuzată fără să se trimită nimic; jocul necunoscut la fel", async () => {
    const before = fake.requests;
    expect(await queryGameServer({ game: "cs2", host: "127.0.0.1", port: fake.udpPort }, { timeoutMs: 1000 })).toMatchObject({ online: false, error: "blocked" });
    expect(await queryGameServer({ game: "quake", host: "127.0.0.1", port: fake.udpPort }, fast)).toMatchObject({ online: false, error: "unknown_game" });
    expect(fake.requests).toBe(before);
  });
});
