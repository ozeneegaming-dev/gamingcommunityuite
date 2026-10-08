import type { GamePlayerKind } from "@gcs/db";
import { accountFromSteam64, steam2 } from "./steamid";

/** Serverul unei cereri a punții (ce trebuie știut din `game_servers`), cu modulele opționale (specul plugin-v2 §1.2). */
export type GcsBridgeServer = {
  id: number;
  game: string;
  name: string;
  enabled: boolean;
  identityMode: string;
  nameIds: boolean;
  isMix: boolean;
  manageAdmins: boolean;
  enforceSanctions: boolean;
  manageVip: boolean;
  mixReady: boolean;
  adminCommands: boolean;
};
export const BRIDGE_SERVER_SELECT = {
  id: true,
  game: true,
  name: true,
  enabled: true,
  identityMode: true,
  nameIds: true,
  isMix: true,
  manageAdmins: true,
  enforceSanctions: true,
  manageVip: true,
  mixReady: true,
  adminCommands: true,
} as const;

/** Modulele opționale ale pluginului, cum le primește în `config.features` (toate oprite implicit: colectorul). */
export type GcsBridgeFeatures = { admins: boolean; sanctions: boolean; vip: boolean; mixReady: boolean; commands: boolean };

export function bridgeFeatures(s: Pick<GcsBridgeServer, "manageAdmins" | "enforceSanctions" | "manageVip" | "mixReady" | "adminCommands">): GcsBridgeFeatures {
  return { admins: s.manageAdmins, sanctions: s.enforceSanctions, vip: s.manageVip, mixReady: s.mixReady, commands: s.adminCommands };
}

/** O identitate de joc, cum o folosesc serviciile punții. */
export type GcsPlayerRow = { id: number; kind: GamePlayerKind; value: string; userId: string | null; name: string };
export const PLAYER_ROW_SELECT = { id: true, kind: true, value: true, userId: true, name: true } as const;

/** O eroare a protocolului: `code` stabil (citit de plugin), statusul HTTP. */
export class GcsBridgeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "GcsBridgeError";
  }
}

/** Cheia unei identități în listele trimise serverelor (`steam:7656…`, `nonsteam:STEAM_0:1:5`, `name:ion`). */
export const identityKey = (kind: GamePlayerKind | string, value: string) => `${kind.toLowerCase()}:${value}`;

export type GcsBridgeAuth = { kind: "steam"; steamId64: string; steam2: string } | { kind: "nonsteam"; id: string };

/** Forma unei identități în listele pentru plugin; `null` pentru `NAME` (numele merge separat). */
export function authOf(kind: GamePlayerKind | string, value: string, game: string): GcsBridgeAuth | null {
  if (kind === "STEAM") {
    const account = accountFromSteam64(value);
    return account === null ? null : { kind: "steam", steamId64: value, steam2: steam2(account, game) };
  }
  if (kind === "NONSTEAM") return { kind: "nonsteam", id: value };
  return null;
}

/** Timpul Unix (secunde), `null` rămâne `null`. */
export const unix = (d: Date | null | undefined): number | null => (d ? Math.floor(d.getTime() / 1000) : null);

/** Un text liber al staff-ului / al jocului: fără caractere de control, spații comprimate, tăiat la `max`. */
export function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return [...clean].slice(0, max).join("");
}

/** Numele unei hărți: litere mici, `[a-z0-9_.-]`, max 64; altfel `null` (definit lângă imaginile hărților). */
export { cleanMapName } from "./mapImages";

/** Numele unei arme: litere mici, `[a-z0-9_-]`, fără prefixul `weapon_`, max 32; altfel `null`. */
export function cleanWeapon(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase().replace(/^weapon_/, "");
  return /^[a-z0-9_-]{1,32}$/.test(name) ? name : null;
}
