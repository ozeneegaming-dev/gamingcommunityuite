/**
 * Conversiile SteamID (specul 2026-10-08-servere-bridge §3.2): `STEAM_X:Y:Z` ↔ SteamID64 ↔ `[U:1:N]`, cu
 * `accountId = Z × 2 + Y` și `SteamID64 = 76561197960265728 + accountId`. Universul `X` (0 sau 1) e ignorat la intrare;
 * ieșirea Steam2 folosește `STEAM_0` pentru CS 1.6 și `STEAM_1` pentru CS2. Fără dependențe de Node.
 */

const BASE = 76561197960265728n;
/** Cel mai mare accountId valid (`4294967295` e rezervat: „niciun cont”). */
const MAX_ACCOUNT = 4_294_967_294;

const STEAM2 = /^(STEAM|VALVE)_([01]):([01]):(\d{1,10})$/;
const STEAM3 = /^\[?U:1:(\d{1,10})\]?$/;
const STEAM64 = /^7656119\d{10}$/;

const valid = (accountId: number): number | null => (Number.isSafeInteger(accountId) && accountId >= 1 && accountId <= MAX_ACCOUNT ? accountId : null);

/** Prefixul formei Steam2 (`VALVE_` vine doar de la clienții non-Steam) și numărul contului. */
export type GcsSteamAuth = { prefix: "STEAM" | "VALVE"; accountId: number };

/**
 * Citește un ID în orice formă acceptată (`STEAM_X:Y:Z`, `VALVE_X:Y:Z`, SteamID64, `[U:1:N]`, `U:1:N`); `null` pentru
 * orice altceva (inclusiv ID-urile LAN / PENDING, `STEAM_666:88:666` sau un cont 0). Textul nu se curăță: un spațiu în
 * plus face ID-ul invalid.
 */
export function parseSteamAuth(value: unknown): GcsSteamAuth | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const s2 = STEAM2.exec(value);
  if (s2) {
    const accountId = valid(Number(s2[4]) * 2 + Number(s2[3]));
    return accountId === null ? null : { prefix: s2[1] as "STEAM" | "VALVE", accountId };
  }
  const s3 = STEAM3.exec(value);
  if (s3 && (value.startsWith("[") === value.endsWith("]"))) {
    const accountId = valid(Number(s3[1]));
    return accountId === null ? null : { prefix: "STEAM", accountId };
  }
  if (STEAM64.test(value)) {
    const diff = BigInt(value) - BASE;
    if (diff < 1n || diff > BigInt(MAX_ACCOUNT)) return null;
    return { prefix: "STEAM", accountId: Number(diff) };
  }
  return null;
}

/** Numărul contului Steam dintr-un ID în orice formă Steam (nu `VALVE_`); `null` dacă nu e un SteamID valid. */
export function steamAccountId(value: unknown): number | null {
  const parsed = parseSteamAuth(value);
  return parsed && parsed.prefix === "STEAM" ? parsed.accountId : null;
}

export function steam64(accountId: number): string {
  return (BASE + BigInt(accountId)).toString();
}

export function steam3(accountId: number): string {
  return `[U:1:${accountId}]`;
}

/** Forma Steam2 pentru jocul serverului: `STEAM_1` în CS2, `STEAM_0` în rest (CS 1.6). */
export function steam2(accountId: number, game: string, prefix: "STEAM" | "VALVE" = "STEAM"): string {
  return `${prefix}_${game === "cs2" && prefix === "STEAM" ? 1 : 0}:${accountId & 1}:${Math.floor(accountId / 2)}`;
}

/** Numărul contului dintr-un SteamID64 (valoarea unei identități `STEAM`). */
export function accountFromSteam64(value: string): number | null {
  return STEAM64.test(value) ? steamAccountId(value) : null;
}
