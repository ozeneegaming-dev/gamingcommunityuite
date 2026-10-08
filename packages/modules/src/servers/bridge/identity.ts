import { isIP } from "node:net";
import { cleanGameText } from "../text";
import { parseSteamAuth, steam2, steam64 } from "./steamid";

/**
 * Identitatea unui jucător (specul 2026-10-08-servere-bridge §3): Steam, non-Steam (ID-ul dat de emulator) sau nume,
 * fiecare cu nivelul lui de încredere. GCS decide identitatea din ce raportează serverul, nu pluginul.
 */

export type GcsIdentityKind = "STEAM" | "NONSTEAM" | "NAME";
export type GcsIdentityTrust = "HIGH" | "MEDIUM" | "LOW";

/** Ce trebuie știut despre server ca să stabilim identitatea (`game_servers`). */
export type GcsIdentityServer = { game: string; identityMode: string; nameIds: boolean };

/** Referința unui jucător, cum o trimite pluginul (§6.3). Toate câmpurile sunt neîncredere. */
export type GcsPlayerRef = { auth?: unknown; steam?: unknown; name?: unknown; ip?: unknown; bot?: unknown };

export type GcsResolvedIdentity = {
  kind: GcsIdentityKind;
  value: string;
  trust: GcsIdentityTrust;
  /** Numele afișat (curățat, max 32), poate fi gol. */
  name: string;
  ip: string | null;
};

export const NAME_MAX = 32;
const TRUST: Record<GcsIdentityKind, GcsIdentityTrust> = { STEAM: "HIGH", NONSTEAM: "MEDIUM", NAME: "LOW" };
/** Numele implicite ale clientului: nu identifică pe nimeni. */
const DEFAULT_NAMES = new Set(["player", "unnamed", "unconnected"]);
/** ID-urile care marchează boții și HLTV-ul (nu sunt urmăriți nici ca nume). */
const NOT_PLAYERS = new Set(["BOT", "HLTV"]);
/** Codurile de culoare de tip `^1` din unele moduri. */
const COLOR_CODES = /\^\d/g;

export function identityTrust(kind: GcsIdentityKind): GcsIdentityTrust {
  return TRUST[kind];
}

/**
 * Numele normalizat (identitățile `NAME`, adminii pe nume): NFKC, fără coduri de culoare și caractere de control,
 * spații comprimate, litere mici, 1–32 de caractere. `null` pentru un nume gol.
 */
export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = cleanGameText(value.normalize("NFKC").replace(COLOR_CODES, ""), 256).toLowerCase();
  const chars = [...clean];
  const cut = (chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join("") : clean).trim();
  return cut === "" ? null : cut;
}

/** IP-ul raportat: IPv4 / IPv6 valid (portul unui IPv4 se taie); orice altceva → `null`. */
export function cleanIp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  const ip = v4 ? v4[1]! : value;
  return isIP(ip) !== 0 ? ip.toLowerCase() : null;
}

/**
 * Identitatea unui jucător pe un server (§3.2):
 * - CS2: doar un SteamID (orice formă) → `STEAM`; altfel neurmărit;
 * - CS 1.6: `STEAM_X:Y:Z` → `STEAM` dacă pluginul a confirmat Steam (`steam: true`) sau serverul e în modul `steam`,
 *   altfel `NONSTEAM`; `VALVE_X:Y:Z` → `NONSTEAM`; restul (LAN, PENDING, invalid) → `NAME` doar cu `nameIds`.
 * Boții, HLTV-ul și numele implicite nu devin identități.
 */
export function resolveIdentity(ref: GcsPlayerRef, server: GcsIdentityServer): GcsResolvedIdentity | null {
  if (!ref || typeof ref !== "object" || ref.bot === true) return null;
  if (typeof ref.auth === "string" && NOT_PLAYERS.has(ref.auth.trim().toUpperCase())) return null;
  const name = cleanGameText(ref.name, NAME_MAX);
  const ip = cleanIp(ref.ip);
  const parsed = parseSteamAuth(ref.auth);
  const make = (kind: GcsIdentityKind, value: string): GcsResolvedIdentity => ({ kind, value, trust: TRUST[kind], name, ip });

  if (server.game !== "cs16") return parsed && parsed.prefix === "STEAM" ? make("STEAM", steam64(parsed.accountId)) : null;

  if (parsed) {
    const steam = parsed.prefix === "STEAM" && (ref.steam === true || (ref.steam !== false && server.identityMode === "steam"));
    return steam ? make("STEAM", steam64(parsed.accountId)) : make("NONSTEAM", steam2(parsed.accountId, "cs16", parsed.prefix));
  }
  if (!server.nameIds) return null;
  const normalized = normalizePlayerName(ref.name);
  return normalized && !DEFAULT_NAMES.has(normalized) ? make("NAME", normalized) : null;
}

/**
 * O identitate scrisă de staff (ținta unei sancțiuni, un admin `PLAYER`): `steam` (implicit) cere un SteamID valid,
 * `nonsteam` un ID de forma `STEAM_X:Y:Z` / `VALVE_X:Y:Z`; un `VALVE_` e mereu non-Steam.
 */
export function parseTypedIdentity(value: unknown, kind?: "steam" | "nonsteam"): { kind: "STEAM" | "NONSTEAM"; value: string } | null {
  const text = typeof value === "string" ? value.trim() : "";
  const parsed = parseSteamAuth(text);
  if (!parsed) return null;
  const steam2Form = /^(STEAM|VALVE)_/.test(text);
  if (parsed.prefix === "VALVE") return kind === "steam" ? null : { kind: "NONSTEAM", value: steam2(parsed.accountId, "cs16", "VALVE") };
  if (kind === "nonsteam") return steam2Form ? { kind: "NONSTEAM", value: steam2(parsed.accountId, "cs16") } : null;
  return { kind: "STEAM", value: steam64(parsed.accountId) };
}
