import { describe, expect, it } from "vitest";
import { hltvCommand, parseRconChallenge, parseRconReply, rconChallengePacket, rconCommandPacket } from "./rcon";

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

/** Pachetele rcon GoldSrc către HLTV (specul 2026-10-08-servere-hltv §5), fără rețea. */
describe("rcon HLTV: pachetele", () => {
  it("cererea challenge-ului: ÿÿÿÿchallenge rcon\\n", () => {
    expect(rconChallengePacket()).toEqual(Buffer.concat([HEADER, Buffer.from("challenge rcon\n", "latin1")]));
  });

  it("răspunsul challenge-ului: numărul, altfel null", () => {
    expect(parseRconChallenge(Buffer.concat([HEADER, Buffer.from("challenge rcon 1234567890\n\0", "latin1")]))).toBe("1234567890");
    expect(parseRconChallenge(Buffer.concat([HEADER, Buffer.from("challenge rcon -42\n", "latin1")]))).toBe("-42");
    expect(parseRconChallenge(Buffer.from("challenge rcon 1\n", "latin1"))).toBeNull();
    expect(parseRconChallenge(Buffer.concat([HEADER, Buffer.from("lBad challenge.\n", "latin1")]))).toBeNull();
    expect(parseRconChallenge(Buffer.concat([HEADER, Buffer.from("challenge rcon 12a\n", "latin1")]))).toBeNull();
  });

  it("comanda: ÿÿÿÿrcon <challenge> \"<parola>\" <comandă>\\n", () => {
    expect(rconCommandPacket("1234567890", "parola-hltv", "record gcs-m42").toString("latin1")).toBe('\xff\xff\xff\xffrcon 1234567890 "parola-hltv" record gcs-m42\n');
  });

  it("parola cu ghilimele / linii noi și challenge-ul invalid sunt refuzate (nu pot închide comanda)", () => {
    expect(() => rconCommandPacket("1", 'a"b', "stoprecording")).toThrow();
    expect(() => rconCommandPacket("1", "a\nb", "stoprecording")).toThrow();
    expect(() => rconCommandPacket("1 2", "a", "stoprecording")).toThrow();
    expect(() => rconCommandPacket("1", "a", "stoprecording; quit")).toThrow();
  });

  it("doar două comenzi: record <nume> și stoprecording", () => {
    expect(hltvCommand({ action: "record", name: "gcs-m42" })).toBe("record gcs-m42");
    expect(hltvCommand({ action: "stop" })).toBe("stoprecording");
    expect(() => hltvCommand({ action: "record", name: "x; quit" })).toThrow();
    expect(() => hltvCommand({ action: "record", name: "" })).toThrow();
  });

  it("răspunsul comenzii: textul după `l` (fără caracterele de control), parola greșită recunoscută", () => {
    expect(parseRconReply(Buffer.concat([HEADER, Buffer.from("lRecording to gcs-m42-2610082015-de_mirage.dem.\n\0", "latin1")]))).toEqual({ ok: true, text: "Recording to gcs-m42-2610082015-de_mirage.dem." });
    expect(parseRconReply(Buffer.concat([HEADER, Buffer.from("lBad rcon_password.\n", "latin1")]))).toEqual({ ok: false, text: "Bad rcon_password." });
    expect(parseRconReply(Buffer.from("x", "latin1"))).toEqual({ ok: false, text: "" });
  });
});
