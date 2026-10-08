import { describe, expect, it } from "vitest";
import { parseSteamAuth, steam2, steam3, steam64, steamAccountId } from "./steamid";

describe("conversiile SteamID", () => {
  it("STEAM_X:Y:Z ↔ SteamID64 ↔ [U:1:N], cu accountId = Z × 2 + Y", () => {
    const id = steamAccountId("STEAM_0:1:12345");
    expect(id).toBe(24691);
    expect(steam64(id!)).toBe("76561197960290419");
    expect(steam3(id!)).toBe("[U:1:24691]");
    expect(steam2(id!, "cs16")).toBe("STEAM_0:1:12345");
    expect(steam2(id!, "cs2")).toBe("STEAM_1:1:12345");
  });

  it("universul X (0 sau 1) e ignorat la intrare", () => {
    expect(steamAccountId("STEAM_1:1:12345")).toBe(steamAccountId("STEAM_0:1:12345"));
  });

  it("acceptă SteamID64, [U:1:N] și U:1:N", () => {
    expect(steamAccountId("76561197960287930")).toBe(22202);
    expect(steamAccountId("[U:1:22202]")).toBe(22202);
    expect(steamAccountId("U:1:22202")).toBe(22202);
    expect(steam2(22202, "cs16")).toBe("STEAM_0:0:11101");
  });

  it("respinge formele invalide și ID-urile care nu sunt identități", () => {
    for (const bad of [
      "",
      "STEAM_ID_LAN",
      "STEAM_ID_PENDING",
      "VALVE_ID_LAN",
      "STEAM_666:88:666",
      "STEAM_2:0:1",
      "STEAM_0:2:1",
      "STEAM_0:0:0",
      "BOT",
      "HLTV",
      "4294967295",
      "76561197960265728",
      "7656119796026572",
      "86561197960287930",
      "[U:2:22202]",
      "[U:1:0]",
      "STEAM_0:1:12345 ",
      "STEAM_0:1:-5",
      "STEAM_0:1:99999999999",
    ]) {
      expect(steamAccountId(bad), bad).toBeNull();
    }
  });

  it("parseSteamAuth: Steam (oricare formă) sau VALVE (doar non-Steam)", () => {
    expect(parseSteamAuth("STEAM_0:1:12345")).toEqual({ prefix: "STEAM", accountId: 24691 });
    expect(parseSteamAuth("VALVE_1:0:7")).toEqual({ prefix: "VALVE", accountId: 14 });
    expect(parseSteamAuth("76561197960290419")).toEqual({ prefix: "STEAM", accountId: 24691 });
    expect(parseSteamAuth("VALVE_ID_LAN")).toBeNull();
    expect(parseSteamAuth(42)).toBeNull();
  });
});
