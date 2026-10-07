import { describe, expect, test } from "vitest";
import { A2sSplitAssembler, a2sInfoRequest, a2sPlayerRequest, parseA2sPacket, parseA2sPayload } from "./a2s";
import { a2sFixtures as fx } from "../../../test/gameFixtures";

describe("cererile A2S", () => {
  test("A2S_INFO: antetul simplu, „Source Engine Query” și, după challenge, cei 4 octeți ai lui", () => {
    expect(a2sInfoRequest().toString("hex")).toBe(`ffffffff54${Buffer.from("Source Engine Query\0").toString("hex")}`);
    expect(a2sInfoRequest(Buffer.from([1, 2, 3, 4])).subarray(-4)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  test("A2S_PLAYER: fără challenge cere unul (FF FF FF FF), apoi îl trimite", () => {
    expect(a2sPlayerRequest().toString("hex")).toBe("ffffffff55ffffffff");
    expect(a2sPlayerRequest(Buffer.from([9, 8, 7, 6])).toString("hex")).toBe("ffffffff5509080706");
  });
});

describe("răspunsurile A2S", () => {
  test("challenge-ul (0x41)", () => {
    const packet = parseA2sPacket(fx.challenge(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])), "source");
    expect(packet.kind).toBe("single");
    expect(parseA2sPayload((packet as { payload: Buffer }).payload)).toEqual({ type: "challenge", challenge: Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]) });
  });

  test("A2S_INFO Source (0x49): nume, hartă, jucători, sloturi, boți, versiune; câmpurile EDF se ignoră", () => {
    const packet = parseA2sPacket(fx.sourceInfo(), "source") as { payload: Buffer };
    expect(parseA2sPayload(packet.payload)).toEqual({
      type: "info",
      info: { format: "source", name: "GCS | Competitive #1", map: "de_mirage", folder: "csgo", game: "Counter-Strike 2", players: 27, maxPlayers: 32, bots: 2, version: "1.40.2.1" },
    });
  });

  test("A2S_INFO GoldSrc vechi (0x6D), cu blocul de mod", () => {
    const packet = parseA2sPacket(fx.goldsrcInfo(), "goldsrc") as { payload: Buffer };
    expect(parseA2sPayload(packet.payload)).toEqual({
      type: "info",
      info: { format: "goldsrc", name: "GCS Classic 1.6", map: "de_dust2", folder: "cstrike", game: "Counter-Strike", players: 19, maxPlayers: 32, bots: 1, version: null },
    });
  });

  test("A2S_PLAYER (0x44): nume, scor, timp; lista se oprește la un rând trunchiat", () => {
    const packet = parseA2sPacket(fx.players([{ name: "ShadowRO", score: 34, time: 4320.5 }, { name: "NeoX", score: -2, time: 61 }]), "source") as { payload: Buffer };
    expect(parseA2sPayload(packet.payload)).toEqual({
      type: "players",
      players: [
        { name: "ShadowRO", score: 34, time: 4320.5 },
        { name: "NeoX", score: -2, time: 61 },
      ],
    });
    const cut = fx.players([{ name: "Unu", score: 1, time: 1 }, { name: "Doi", score: 2, time: 2 }]);
    const truncated = parseA2sPacket(cut.subarray(0, cut.length - 3), "source") as { payload: Buffer };
    expect(parseA2sPayload(truncated.payload)).toEqual({ type: "players", players: [{ name: "Unu", score: 1, time: 1 }] });
  });

  test("un tip necunoscut sau un răspuns trunchiat e invalid", () => {
    expect(() => parseA2sPayload(Buffer.from([0x99, 1, 2]))).toThrow("invalid_response");
    const info = fx.sourceInfo();
    expect(() => parseA2sPayload((parseA2sPacket(info.subarray(0, 20), "source") as { payload: Buffer }).payload)).toThrow("invalid_response");
    expect(() => parseA2sPacket(Buffer.from([1, 2, 3]), "source")).toThrow("invalid_response");
    expect(() => parseA2sPacket(Buffer.from([0xfd, 0xff, 0xff, 0xff, 0x49]), "source")).toThrow("invalid_response");
  });
});

describe("pachetele împărțite", () => {
  const payload = fx.players(Array.from({ length: 40 }, (_, i) => ({ name: `Jucator_${i}`, score: i, time: i * 10 })));

  test("formatul Source (id, total, număr, mărime): părțile vin în orice ordine și se reasamblează", () => {
    const parts = fx.splitSource(payload, 0x1234, 3);
    const assembler = new A2sSplitAssembler();
    let done: Buffer | null = null;
    for (const raw of [parts[2]!, parts[0]!, parts[1]!]) {
      const packet = parseA2sPacket(raw, "source");
      expect(packet.kind).toBe("split");
      done = assembler.add(packet as Extract<typeof packet, { kind: "split" }>);
    }
    expect(done).not.toBeNull();
    const players = parseA2sPayload(done!);
    expect(players.type === "players" && players.players).toHaveLength(40);
  });

  test("formatul GoldSrc (numărul și totalul într-un octet)", () => {
    const parts = fx.splitGoldsrc(payload, 77, 4);
    const assembler = new A2sSplitAssembler();
    const results = parts.map((raw) => assembler.add(parseA2sPacket(raw, "goldsrc") as Extract<ReturnType<typeof parseA2sPacket>, { kind: "split" }>));
    expect(results.slice(0, 3)).toEqual([null, null, null]);
    expect(results[3]!.equals(payload.subarray(4))).toBe(true);
  });

  test("răspunsurile comprimate (bzip2), prea multe părți sau prea mari se refuză", () => {
    const compressed = fx.splitSource(payload, 0x80000001, 2);
    expect(() => parseA2sPacket(compressed[0]!, "source")).toThrow("invalid_response");
    const tooMany = fx.splitSource(payload, 5, 20);
    expect(() => parseA2sPacket(tooMany[0]!, "source")).toThrow("too_large");
    const assembler = new A2sSplitAssembler({ maxBytes: 500 });
    const big = fx.splitSource(payload, 6, 2);
    expect(() => {
      for (const raw of big) assembler.add(parseA2sPacket(raw, "source") as Extract<ReturnType<typeof parseA2sPacket>, { kind: "split" }>);
    }).toThrow("too_large");
  });
});
