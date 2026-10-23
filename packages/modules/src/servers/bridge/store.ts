import { defineKvScript, type GcsKv } from "@gcs/core";

/**
 * Starea punții din `GcsKv` (Redis / baza de date) (specul 2026-10-08-servere-bridge §4.14): nonce-urile (protecția la reluare), lista jucătorilor
 * din ultimul heartbeat, starea live a meciului mix, harta curentă, versiunea listelor (admini, VIP) cu cache-ul lor și
 * contoarele eșecurilor (autentificare, coduri de legare).
 */

const NONCE = (keyId: string, nonce: string) => `gcs:bridge:nonce:${keyId}:${nonce}`;
const ROSTER = (serverId: number) => `gcs:bridge:roster:${serverId}`;
const MATCH = (serverId: number) => `gcs:bridge:match:${serverId}`;
const MAP = (serverId: number) => `gcs:bridge:map:${serverId}`;
const VERSION = "gcs:bridge:version";
const LIST = (kind: string, serverId: number, version: string) => `gcs:bridge:list:${kind}:${serverId}:${version}`;
const FAILS = (key: string) => `gcs:bridge:fail:${key}`;

const NONCE_TTL = 600;
const ROSTER_TTL = 300;
const MATCH_TTL = 6 * 3600;
const MAP_TTL = 86_400;
const LIST_TTL = 60;
/** Incrementează contorul; fereastra (TTL-ul) începe la primul eșec. */
const FAIL_SCRIPT = defineKvScript<number>({
  lua: `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`,
  run: async (kv, [key], [windowSec]) => (await kv.incrWindow(key!, Number(windowSec))).count,
  fromRedis: Number,
});

/** Un jucător din ultimul heartbeat (identitatea rezolvată de GCS). */
export type GcsRosterEntry = {
  playerId: number;
  kind: string;
  name: string;
  team: string | null;
  score: number | null;
  time: number | null;
  /** Adminul recunoscut (identitate sau `admin_login`). */
  adminId: number | null;
  /**
   * Flag-urile de admin raportate de server din sistemul lui de admini (litere AMXX, specul plugin-v2 §2); lipsă la
   * listele salvate de versiunea veche.
   */
  flags?: string | null;
};

export type GcsRoster = {
  at: number;
  map: string | null;
  maxPlayers: number;
  players: GcsRosterEntry[];
  /** Modulele opționale active pe server (raportate de plugin, după acordul local). */
  modules?: string[];
  /** Scorul echipelor (CT / T) raportat de plugin. */
  scores?: { ct: number; t: number } | null;
  /**
   * Transmisia raportată de plugin (specul 2026-10-08-servere-hltv §8): CS2 — GOTV pornit, întârzierea, portul, dacă
   * înregistrează; CS 1.6 — câte proxy-uri HLTV sunt conectate.
   */
  tv?: GcsRosterTv | null;
};

export type GcsRosterTv = { enabled?: boolean; delay?: number | null; port?: number | null; recording?: boolean; hltv?: number };

export class GcsBridgeStore {
  constructor(private readonly kv: GcsKv) {}

  /** Rezervă nonce-ul (`SET NX`, 10 minute); `false` = folosit deja (reluare). */
  async claimNonce(keyId: string, nonce: string): Promise<boolean> {
    return this.kv.set(NONCE(keyId, nonce), "1", { ttlMs: NONCE_TTL * 1000, nx: true });
  }

  async saveRoster(serverId: number, roster: GcsRoster): Promise<void> {
    await this.kv.set(ROSTER(serverId), JSON.stringify(roster), { ttlMs: ROSTER_TTL * 1000 });
  }

  async roster(serverId: number): Promise<GcsRoster | null> {
    return (await this.rosters([serverId])).get(serverId) ?? null;
  }

  async rosters(serverIds: number[]): Promise<Map<number, GcsRoster>> {
    const out = new Map<number, GcsRoster>();
    if (serverIds.length === 0) return out;
    const raw = await this.kv.mget(serverIds.map(ROSTER));
    raw.forEach((value, i) => {
      const parsed = parseJson<GcsRoster>(value);
      if (parsed) out.set(serverIds[i]!, parsed);
    });
    return out;
  }

  async clearRoster(serverId: number): Promise<void> {
    await this.kv.del(ROSTER(serverId), MATCH(serverId), MAP(serverId));
  }

  async saveMatch(serverId: number, state: unknown): Promise<void> {
    if (state === null) await this.kv.del(MATCH(serverId));
    else await this.kv.set(MATCH(serverId), JSON.stringify(state), { ttlMs: MATCH_TTL * 1000 });
  }

  async match<T>(serverId: number): Promise<T | null> {
    return parseJson<T>(await this.kv.get(MATCH(serverId)));
  }

  async setMap(serverId: number, map: string): Promise<void> {
    await this.kv.set(MAP(serverId), map, { ttlMs: MAP_TTL * 1000 });
  }

  async currentMap(serverId: number): Promise<string | null> {
    return this.kv.get(MAP(serverId));
  }

  /** Versiunea listelor (admini, VIP): crește la orice schimbare care le poate afecta. */
  async version(): Promise<string> {
    return (await this.kv.get(VERSION)) ?? "0";
  }

  async bumpVersion(): Promise<void> {
    await this.kv.incr(VERSION);
  }

  /** O listă din cache (60 s, pe versiune), altfel calculată și pusă în cache. */
  async cachedList<T>(kind: string, serverId: number, build: () => Promise<T>): Promise<T> {
    const key = LIST(kind, serverId, await this.version());
    const hit = parseJson<T>(await this.kv.get(key));
    if (hit !== null) return hit;
    const value = await build();
    await this.kv.set(key, JSON.stringify(value), { ttlMs: LIST_TTL * 1000 });
    return value;
  }

  /** Eșecurile din fereastra curentă (fără să numere o încercare). */
  async failures(key: string): Promise<number> {
    return Number((await this.kv.get(FAILS(key))) ?? 0);
  }

  /** Numără un eșec; fereastra (secunde) începe la primul. */
  async fail(key: string, windowSec: number): Promise<number> {
    return this.kv.script(FAIL_SCRIPT, [FAILS(key)], [windowSec]);
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
