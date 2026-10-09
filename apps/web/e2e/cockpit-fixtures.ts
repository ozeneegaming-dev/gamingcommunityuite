import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { sql } from "./helpers";

/**
 * Datele testelor Hero Cockpit (antetul construit, consola, clasamentul): setările temei implicite (`nova`) schimbate
 * direct în bază (și refăcute după test), servere cu status în Redis și un meci mix live.
 */

async function redis() {
  const { default: Redis } = await import("ioredis");
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
}

/** Golește cache-ul temelor (serviciul le ține în Redis sub `gcs:k:themes*`). */
export async function clearThemeCache(): Promise<void> {
  const r = await redis();
  try {
    const keys = await r.keys("gcs:k:themes*");
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

/** Setările publicate ale temei implicite Nova (pentru refacere după test). */
export async function novaSettings(): Promise<Record<string, unknown>> {
  const [row] = await sql<{ settings: Record<string, unknown> }>(`SELECT settings FROM themes WHERE key = 'nova'`);
  return row?.settings ?? {};
}

/** Îmbină setările date peste cele ale temei Nova (pe primul și al doilea nivel), ca și cum ar fi fost publicate. */
export async function patchNova(patch: Record<string, Record<string, unknown>>): Promise<void> {
  const current = await novaSettings();
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) next[k] = { ...((current[k] as Record<string, unknown> | undefined) ?? {}), ...v };
  await sql(`UPDATE themes SET settings = $1::jsonb, draft = NULL, version = version + 1 WHERE key = 'nova'`, [JSON.stringify(next)]);
  await clearThemeCache();
}

export async function restoreNova(settings: Record<string, unknown>): Promise<void> {
  await sql(`UPDATE themes SET settings = $1::jsonb, draft = NULL, version = version + 1 WHERE key = 'nova'`, [JSON.stringify(settings)]);
  await clearThemeCache();
}

/** Aspectele presetărilor (aceleași ca `headerPreset` din `@gcs/core/themes`). */
export async function preset(name: "cockpit" | "esports" | "centered" | "side" | "classic"): Promise<unknown> {
  const { headerPreset } = await import("@gcs/core/themes");
  return headerPreset(name);
}

export type SeededServer = { id: number; name: string };

/**
 * Servere de joc cu status „online” în Redis (adresele de documentație nu răspund; programarea următoarei interogări e
 * mutată departe, ca worker-ul să nu le suprascrie statusul).
 */
export async function seedServers(list: { name: string; game: "cs16" | "cs2"; players: number; max: number; map: string }[]): Promise<SeededServer[]> {
  const out: SeededServer[] = [];
  const r = await redis();
  try {
    for (const [i, s] of list.entries()) {
      const slug = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
      const [row] = await sql<{ id: number }>(
        `INSERT INTO game_servers (game, host, port, name, slug, position, "updatedAt") VALUES ($1, '192.0.2.60', $2, $3, $4, $5, now()) RETURNING id`,
        [s.game, 27_000 + Math.floor(Math.random() * 900) + i, s.name, slug, 800 + i],
      );
      const id = row!.id;
      const status = { online: true, name: s.name, map: s.map, players: s.players, maxPlayers: s.max, bots: 0, ping: 12, version: null, playerList: null, updatedAt: new Date().toISOString(), error: null };
      await r.multi().set(`gcs:servers:status:${id}`, JSON.stringify(status), "EX", 3600).hset("gcs:servers:next", String(id), String(Date.now() + 3_600_000)).hset("gcs:servers:fails", String(id), "0").exec();
      out.push({ id, name: s.name });
    }
    // Lista serverelor e în cache (adăugarea din ACP o invalidează; aici scriem direct în bază).
    const keys = await r.keys("gcs:k:servers*");
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
  return out;
}

export async function removeServers(list: SeededServer[]): Promise<void> {
  if (list.length === 0) return;
  const ids = list.map((s) => s.id);
  await sql(`DELETE FROM game_servers WHERE id = ANY($1::int[])`, [ids]);
  const r = await redis();
  try {
    await r.del(...ids.map((id) => `gcs:servers:status:${id}`), ...ids.map((id) => `gcs:bridge:match:${id}`));
    const keys = await r.keys("gcs:k:servers*");
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

/** Un meci mix live pe server: rândul din bază și starea live din Redis (scorul, echipele, jucătorii legați de membri). */
export async function seedLiveMatch(serverId: number, players: { name: string; team: "A" | "B"; kills: number; deaths: number; userId?: string }[], score: { a: number; b: number }) {
  const [match] = await sql<{ id: number }>(
    `INSERT INTO game_matches ("serverId", "externalId", map, status, "teamAName", "teamBName", "scoreA", "scoreB", round, "startedAt", "liveAt", "updatedAt")
     VALUES ($1, $2, 'de_inferno', 'LIVE', 'Echipa CT', 'Echipa T', $3, $4, $5, now(), now(), now()) RETURNING id`,
    [serverId, `e2e-${Math.random().toString(36).slice(2, 8)}`, score.a, score.b, score.a + score.b + 1],
  );
  const rows: { playerId: number; name: string; team: "A" | "B"; kills: number; deaths: number }[] = [];
  for (const p of players) {
    const [player] = await sql<{ id: number }>(
      `INSERT INTO game_players (kind, value, trust, "userId", name, "lastSeenAt") VALUES ('STEAM', $1, 'HIGH', $2, $3, now()) RETURNING id`,
      [`STEAM_0:1:${Math.floor(Math.random() * 1e9)}`, p.userId ?? null, p.name],
    );
    rows.push({ playerId: player!.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths });
  }
  const live = {
    id: match!.id,
    externalId: "e2e",
    serverId,
    status: "live",
    map: "de_inferno",
    round: score.a + score.b + 1,
    teams: { A: { name: "Echipa CT", score: score.a }, B: { name: "Echipa T", score: score.b } },
    players: rows.map((r) => ({ ...r, assists: 0, headshots: 0, damage: 0, mvps: 0 })),
    updatedAt: new Date().toISOString(),
  };
  const r = await redis();
  try {
    await r.set(`gcs:bridge:match:${serverId}`, JSON.stringify(live), "EX", 3600);
  } finally {
    r.disconnect();
  }
  return { matchId: match!.id, playerIds: rows.map((r) => r.playerId) };
}

/** Capturile pentru comparația cu macheta (doar cu `GCS_SHOTS_DIR`). */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  const dir = process.env.GCS_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: opts.fullPage ?? false });
}
