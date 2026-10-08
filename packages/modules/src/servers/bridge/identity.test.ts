import { describe, expect, it } from "vitest";
import { cleanIp, identityTrust, normalizePlayerName, parseTypedIdentity, resolveIdentity, type GcsIdentityServer } from "./identity";

const cs16: GcsIdentityServer = { game: "cs16", identityMode: "mixed", nameIds: false };
const cs16Steam: GcsIdentityServer = { game: "cs16", identityMode: "steam", nameIds: false };
const cs16Names: GcsIdentityServer = { game: "cs16", identityMode: "mixed", nameIds: true };
const cs2: GcsIdentityServer = { game: "cs2", identityMode: "mixed", nameIds: true };

describe("identitatea jucătorului (resolveIdentity, server-side)", () => {
  it("CS2: orice formă de SteamID → STEAM (SteamID64), altfel neurmărit (și cu nameIds)", () => {
    expect(resolveIdentity({ auth: "STEAM_1:0:11101", name: "Ion" }, cs2)).toMatchObject({ kind: "STEAM", value: "76561197960287930", trust: "HIGH", name: "Ion" });
    expect(resolveIdentity({ auth: "[U:1:22202]" }, cs2)).toMatchObject({ kind: "STEAM", value: "76561197960287930" });
    expect(resolveIdentity({ auth: "STEAM_ID_LAN", name: "Ion" }, cs2)).toBeNull();
    expect(resolveIdentity({ auth: "VALVE_0:0:7", name: "Ion" }, cs2)).toBeNull();
  });

  it("CS 1.6: steam true → STEAM, steam false → NONSTEAM, lipsă → după modul serverului", () => {
    expect(resolveIdentity({ auth: "STEAM_0:1:42", steam: true }, cs16)).toMatchObject({ kind: "STEAM", value: "76561197960265813", trust: "HIGH" });
    expect(resolveIdentity({ auth: "STEAM_0:1:42", steam: false }, cs16)).toMatchObject({ kind: "NONSTEAM", value: "STEAM_0:1:42", trust: "MEDIUM" });
    expect(resolveIdentity({ auth: "STEAM_1:1:42" }, cs16)).toMatchObject({ kind: "NONSTEAM", value: "STEAM_0:1:42" });
    expect(resolveIdentity({ auth: "STEAM_0:1:42" }, cs16Steam)).toMatchObject({ kind: "STEAM", value: "76561197960265813" });
    expect(resolveIdentity({ auth: "VALVE_1:0:7", steam: true }, cs16)).toMatchObject({ kind: "NONSTEAM", value: "VALVE_0:0:7" });
  });

  it("un NONSTEAM cu aceleași cifre ca un SteamID real e altă identitate (alt kind)", () => {
    const real = resolveIdentity({ auth: "STEAM_0:1:42", steam: true }, cs16)!;
    const emulated = resolveIdentity({ auth: "STEAM_0:1:42", steam: false }, cs16)!;
    expect(real.kind).not.toBe(emulated.kind);
    expect(real.value).not.toBe(emulated.value);
  });

  it("ID-urile LAN / PENDING / invalide devin NAME doar cu nameIds; numele implicite nu devin identități", () => {
    for (const auth of ["STEAM_ID_LAN", "VALVE_ID_PENDING", "STEAM_666:88:666", "UNKNOWN", "4294967295", "", undefined]) {
      expect(resolveIdentity({ auth, name: "Ion" }, cs16), String(auth)).toBeNull();
      expect(resolveIdentity({ auth, name: "  ION ^1 " }, cs16Names), String(auth)).toMatchObject({ kind: "NAME", value: "ion", trust: "LOW" });
    }
    for (const name of ["Player", "unnamed", "UNCONNECTED", "", "   "]) expect(resolveIdentity({ auth: "STEAM_ID_LAN", name }, cs16Names), name).toBeNull();
  });

  it("boții și HLTV-ul nu sunt urmăriți", () => {
    expect(resolveIdentity({ auth: "STEAM_0:1:42", steam: true, bot: true }, cs16)).toBeNull();
    expect(resolveIdentity({ auth: "BOT", name: "Bot Ion" }, cs16Names)).toBeNull();
    // Consola serverului (acțiunile din rcon) nu devine identitate pe nume.
    expect(resolveIdentity({ auth: "CONSOLE", name: "Console" }, cs16Names)).toBeNull();
  });

  it("numele afișat e curățat (fără caractere de control), max 32", () => {
    const id = resolveIdentity({ auth: "STEAM_0:1:42", steam: true, name: "\u0001Ion\u202E<b>" + "x".repeat(40) }, cs16)!;
    expect(id.name).toBe(("Ion<b>" + "x".repeat(40)).slice(0, 32));
  });

  it("IP-ul: IPv4 / IPv6 valid, portul tăiat, restul ignorat", () => {
    expect(cleanIp("198.51.100.7")).toBe("198.51.100.7");
    expect(cleanIp("198.51.100.7:27005")).toBe("198.51.100.7");
    expect(cleanIp("2001:db8::1")).toBe("2001:db8::1");
    expect(cleanIp("loopback")).toBeNull();
    expect(cleanIp(42)).toBeNull();
  });

  it("normalizarea numelui: NFKC, fără coduri de culoare, spații comprimate, litere mici", () => {
    expect(normalizePlayerName("ＩＯＮ   ^2Pro")).toBe("ion pro");
    expect(normalizePlayerName("x".repeat(40))).toHaveLength(32);
    expect(normalizePlayerName("\u0007")).toBeNull();
  });

  it("încrederea pe tipuri", () => {
    expect(identityTrust("STEAM")).toBe("HIGH");
    expect(identityTrust("NONSTEAM")).toBe("MEDIUM");
    expect(identityTrust("NAME")).toBe("LOW");
  });

  it("identitatea scrisă de staff (sancțiuni, admini)", () => {
    expect(parseTypedIdentity("STEAM_0:0:11101", "steam")).toEqual({ kind: "STEAM", value: "76561197960287930" });
    expect(parseTypedIdentity("76561197960287930")).toEqual({ kind: "STEAM", value: "76561197960287930" });
    expect(parseTypedIdentity("STEAM_1:0:11101", "nonsteam")).toEqual({ kind: "NONSTEAM", value: "STEAM_0:0:11101" });
    expect(parseTypedIdentity("VALVE_0:1:5")).toEqual({ kind: "NONSTEAM", value: "VALVE_0:1:5" });
    expect(parseTypedIdentity("VALVE_0:1:5", "steam")).toBeNull();
    expect(parseTypedIdentity("[U:1:22202]", "nonsteam")).toBeNull();
    expect(parseTypedIdentity("STEAM_ID_LAN")).toBeNull();
  });
});
