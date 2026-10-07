import { describe, expect, test } from "vitest";
import { BEDROCK_MAGIC, DEFAULT_MC_STATUS, mcFixtures } from "../../../test/gameFixtures";
import { bedrockPing, McStatusReader, minecraftHandshake, MINECRAFT_STATUS_REQUEST, parseBedrockPong, parseMinecraftStatus, readVarInt, writeVarInt } from "./minecraft";

describe("VarInt", () => {
  test("scrierea și citirea (inclusiv -1 pe 5 octeți); incomplet = null; prea lung = invalid", () => {
    expect(writeVarInt(0).toString("hex")).toBe("00");
    expect(writeVarInt(300).toString("hex")).toBe("ac02");
    expect(writeVarInt(-1).toString("hex")).toBe("ffffffff0f");
    expect(readVarInt(Buffer.from("ac02", "hex"), 0)).toEqual({ value: 300, size: 2 });
    expect(readVarInt(Buffer.from("ffffffff0f", "hex"), 0)).toEqual({ value: -1, size: 5 });
    expect(readVarInt(Buffer.from("ac", "hex"), 0)).toBeNull();
    expect(() => readVarInt(Buffer.from("ffffffffff01", "hex"), 0)).toThrow("invalid_response");
  });
});

describe("Minecraft Java (Server List Ping)", () => {
  test("handshake-ul: lungimea, id-ul 0x00, protocolul -1, adresa, portul big-endian, starea 1", () => {
    const hs = minecraftHandshake("play.example.com", 25565);
    const body = Buffer.concat([Buffer.from([0x00]), writeVarInt(-1), writeVarInt(16), Buffer.from("play.example.com"), Buffer.from([0x63, 0xdd]), Buffer.from([0x01])]);
    expect(hs.equals(Buffer.concat([writeVarInt(body.length), body]))).toBe(true);
    expect(MINECRAFT_STATUS_REQUEST.toString("hex")).toBe("0100");
  });

  test("răspunsul vine în bucăți; JSON-ul se citește când e complet", () => {
    const response = mcFixtures.statusResponse(DEFAULT_MC_STATUS);
    const reader = new McStatusReader();
    expect(reader.push(response.subarray(0, 3))).toBeNull();
    expect(reader.push(response.subarray(3, 40))).toBeNull();
    const json = reader.push(response.subarray(40));
    expect(JSON.parse(json!)).toEqual(DEFAULT_MC_STATUS);
  });

  test("un răspuns declarat sau primit peste limită se oprește (too_large); alt id de pachet e invalid", () => {
    const big = mcFixtures.statusResponse({ description: "x".repeat(5000) });
    expect(() => new McStatusReader({ maxBytes: 1000 }).push(big.subarray(0, 4))).toThrow("too_large");
    const other = Buffer.concat([writeVarInt(3), Buffer.from([0x05, 0x01, 0x41])]);
    expect(() => new McStatusReader().push(other)).toThrow("invalid_response");
  });

  test("statusul: versiunea, jucătorii, eșantionul de nume și MOTD-ul (text sau componente)", () => {
    expect(parseMinecraftStatus(JSON.stringify(DEFAULT_MC_STATUS))).toEqual({
      version: "Paper 1.21.1",
      players: 12,
      maxPlayers: 60,
      sample: ["§aSteve", "Alex"],
      motd: "§6GCS Survival",
    });
    expect(parseMinecraftStatus(JSON.stringify({ version: { name: "1.8" }, players: { online: 0, max: 20 }, description: "Salut" }))).toEqual({
      version: "1.8",
      players: 0,
      maxPlayers: 20,
      sample: null,
      motd: "Salut",
    });
  });

  test("JSON invalid sau numere absurde = răspuns invalid", () => {
    expect(() => parseMinecraftStatus("{nu e json")).toThrow("invalid_response");
    expect(() => parseMinecraftStatus(JSON.stringify({ players: { online: -5, max: 10 } }))).toThrow("invalid_response");
    expect(() => parseMinecraftStatus(JSON.stringify({ players: { online: "1", max: 10 } }))).toThrow("invalid_response");
  });
});

describe("Minecraft Bedrock (RakNet unconnected ping)", () => {
  test("ping-ul: 0x01, timpul, magia RakNet, GUID-ul clientului", () => {
    const ping = bedrockPing(123n, 456n);
    expect(ping.length).toBe(33);
    expect(ping[0]).toBe(0x01);
    expect(ping.readBigInt64BE(1)).toBe(123n);
    expect(ping.subarray(9, 25).equals(BEDROCK_MAGIC)).toBe(true);
    expect(ping.readBigInt64BE(25)).toBe(456n);
  });

  test("pong-ul (0x1C): MOTD, versiunea, jucătorii, nivelul", () => {
    expect(parseBedrockPong(mcFixtures.bedrockPong())).toEqual({ motd: "GCS Bedrock", version: "1.21.2", players: 4, maxPlayers: 20, level: "Lumea GCS" });
  });

  test("magia greșită, alt tip de pachet sau un șir trunchiat = invalid", () => {
    const pong = mcFixtures.bedrockPong();
    const badMagic = Buffer.from(pong);
    badMagic[18] = 0x00;
    expect(() => parseBedrockPong(badMagic)).toThrow("invalid_response");
    const other = Buffer.from(pong);
    other[0] = 0x1d;
    expect(() => parseBedrockPong(other)).toThrow("invalid_response");
    expect(() => parseBedrockPong(pong.subarray(0, pong.length - 10))).toThrow("invalid_response");
    expect(() => parseBedrockPong(mcFixtures.bedrockPong({ players: Number.NaN }))).toThrow("invalid_response");
  });
});
