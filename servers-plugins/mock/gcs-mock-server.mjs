#!/usr/bin/env node
// GCS Server Bridge — serverul de joc fals (specul 2026-10-08-servere-bridge §18).
//
// Vorbește protocolul v1 exact ca pluginurile (semnarea cererilor, decalajul ceasului, reîncercarea la `clock_skew`):
// heartbeat-uri, conectări, ucideri, runde, un meci mix complet (warmup → live → halftime → ended) și un ban. Fără
// dependențe (doar modulele Node). Transportul e o funcție: testele unitare apelează direct API-ul, E2E-ul și linia de
// comandă folosesc HTTP real.
//
//   node gcs-mock-server.mjs --url https://site.exemplu --key gcs1.<keyId>.<secret> --scenario full [--game cs2|cs16]
//
// Licența: MIT (ca pluginul CS2).

import { createHash, createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const BRIDGE_BASE_PATH = "/api/servers/bridge/v1";

/** Cheia `gcs1.<keyId>.<secret>` → keyId și K = hex(SHA-256(secret)). */
export function parseKey(token) {
  const parts = String(token).trim().split(".");
  if (parts.length !== 3 || parts[0] !== "gcs1" || !/^[a-z0-9]{12}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) {
    throw new Error("Cheie GCS invalidă (forma: gcs1.<keyId>.<secret>)");
  }
  return { keyId: parts[1], signingKey: createHash("sha256").update(parts[2], "utf8").digest("hex") };
}

/** Anteturile unei cereri semnate (§5.2). `alg`: `hmac-sha256` (implicit) sau `sha256-env` (ca pluginul AMX Mod X). */
export function signHeaders({ keyId, signingKey }, method, path, body, timestamp, alg = "hmac-sha256", nonce = randomBytes(18).toString("base64url")) {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const canonical = [method.toUpperCase(), path, String(timestamp), nonce, bodyHash].join("\n");
  const signature =
    alg === "hmac-sha256"
      ? createHmac("sha256", Buffer.from(signingKey, "ascii")).update(canonical, "utf8").digest("hex")
      : createHash("sha256").update(`${signingKey}\n${canonical}\n${signingKey}`, "utf8").digest("hex");
  return { "X-GCS-Key": keyId, "X-GCS-Timestamp": String(timestamp), "X-GCS-Nonce": nonce, "X-GCS-Signature": `${alg}=${signature}` };
}

/** Transportul HTTP real (fetch din Node ≥ 18). */
export function httpTransport(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, "") + BRIDGE_BASE_PATH;
  return async ({ method, path, headers, body }) => {
    const res = await fetch(base + path, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body || undefined });
    const text = res.status === 304 ? null : await res.text();
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text };
  };
}

/** Un jucător fals: referința trimisă de plugin (§6.3). */
export function mockPlayer(game, n, extra = {}) {
  const accountId = 900_000 + n;
  const auth = game === "cs16" ? `STEAM_0:${accountId % 2}:${Math.floor(accountId / 2)}` : `STEAM_1:${accountId % 2}:${Math.floor(accountId / 2)}`;
  return { auth, steam: true, name: `Jucator${n}`, ip: `198.51.100.${10 + n}`, ...extra };
}

export class GcsMockServer {
  /**
   * @param {{ token: string, transport: Function, game?: string, clock?: () => number, alg?: string, runId?: string, log?: (msg: string) => void }} opts
   */
  constructor(opts) {
    this.key = parseKey(opts.token);
    this.transport = opts.transport;
    this.game = opts.game ?? "cs2";
    this.clock = opts.clock ?? (() => Date.now());
    this.alg = opts.alg ?? (this.game === "cs16" ? "sha256-env" : "hmac-sha256");
    this.runId = opts.runId ?? randomBytes(4).toString("hex");
    this.log = opts.log ?? (() => {});
    /** Decalajul față de ceasul GCS (secunde), din `serverTime`. */
    this.offset = 0;
    this.seq = 0;
    this.cursor = 0;
    this.etags = { admins: null, vip: null };
  }

  /** Timpul în ceasul GCS (secunde). */
  now() {
    return Math.floor(this.clock() / 1000) + this.offset;
  }

  /** O cerere semnată; la `clock_skew` își corectează decalajul și retrimite o dată (nonce nou). */
  async request(method, path, payload, extraHeaders = {}) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = { ...signHeaders(this.key, method, path, body, this.now(), this.alg), ...extraHeaders };
      const res = await this.transport({ method, path, headers, body });
      const json = res.body ? JSON.parse(res.body) : null;
      if (json && typeof json.serverTime === "number") this.offset += json.serverTime - this.now();
      if (res.status === 401 && json?.error === "clock_skew" && attempt === 0) continue;
      return { status: res.status, json, headers: res.headers ?? {} };
    }
    throw new Error("unreachable");
  }

  /** Un eveniment cu id unic (aceleași id-uri la retrimitere). */
  event(type, fields = {}) {
    this.seq += 1;
    return { id: `${this.runId}-${String(this.seq).padStart(6, "0")}`, type, at: this.now(), ...fields };
  }

  async heartbeat({ map = "de_dust2", players = [], match, maxPlayers = 32 } = {}) {
    const res = await this.request("POST", "/heartbeat", { plugin: `gcs-mock/${this.game}/1.0.0`, map, maxPlayers, players, ...(match !== undefined ? { match } : {}) });
    if (res.status !== 200) throw new Error(`heartbeat: ${res.status} ${JSON.stringify(res.json)}`);
    return res.json;
  }

  async send(events) {
    const res = await this.request("POST", "/events", { events });
    if (res.status !== 200) throw new Error(`events: ${res.status} ${JSON.stringify(res.json)}`);
    return res.json.results;
  }

  async pullAdmins() {
    const res = await this.request("GET", "/admins", undefined, this.etags.admins ? { "If-None-Match": `"${this.etags.admins}"` } : {});
    if (res.status === 304) return null;
    this.etags.admins = res.json.etag;
    return res.json.admins;
  }

  async pullVip() {
    const res = await this.request("GET", "/vip", undefined, this.etags.vip ? { "If-None-Match": `"${this.etags.vip}"` } : {});
    if (res.status === 304) return null;
    this.etags.vip = res.json.etag;
    return res.json.vip;
  }

  /** Sincronizarea sancțiunilor de la cursorul curent, toate paginile. */
  async pullSanctions() {
    const all = [];
    for (let page = 0; page < 100; page++) {
      const res = await this.request("GET", `/sanctions?since=${this.cursor}`);
      if (res.status !== 200) throw new Error(`sanctions: ${res.status}`);
      all.push(...res.json.sanctions);
      this.cursor = res.json.cursor;
      if (!res.json.more) break;
    }
    return all;
  }

  async check(player) {
    return (await this.request("POST", "/check", { player })).json;
  }

  async link(player, code) {
    return this.request("POST", "/link", { player, code });
  }

  /** Starea unui meci mix (§6.9). */
  matchState(id, status, { map = "de_mirage", round = 0, score = { A: 0, B: 0 }, teamA, teamB, stats } = {}) {
    return {
      id,
      status,
      map,
      round,
      teams: { A: { name: "Echipa 1" }, B: { name: "Echipa 2" } },
      score,
      players: [...teamA.map((p) => ({ player: p, team: "A" })), ...teamB.map((p) => ({ player: p, team: "B" }))].map((x) => ({ ...x, ...(stats?.get(x.player.auth) ?? { kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, mvps: 0 }) })),
    };
  }

  /**
   * Scenariul complet: 10 jucători intră, un meci mix 5v5 (warmup → live → 8 runde → halftime → live → încă 8 runde →
   * ended, 10–6), ucideri, focuri, runde, un ban dat din joc, ieșirile și un heartbeat gol. Întoarce un rezumat.
   */
  async scenarioFull() {
    const map = "de_mirage";
    const players = Array.from({ length: 10 }, (_, i) => mockPlayer(this.game, i + 1));
    const teamA = players.slice(0, 5);
    const teamB = players.slice(5);
    const matchId = `m-${this.runId}`;
    const stats = new Map(players.map((p) => [p.auth, { kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, mvps: 0 }]));
    const roster = () => players.map((p, i) => ({ ...p, team: i < 5 ? "CT" : "T", score: stats.get(p.auth).kills, time: 60 }));

    await this.heartbeat({ map, players: roster() });
    await this.send([this.event("map", { map }), ...players.map((p) => this.event("connect", { player: p }))]);
    await this.send([this.event("match", { match: this.matchState(matchId, "warmup", { map, teamA, teamB, stats }) })]);
    await this.send([this.event("match", { match: this.matchState(matchId, "live", { map, teamA, teamB, stats }) })]);

    const score = { A: 0, B: 0 };
    // Echipa A câștigă 10 runde, B 6 (16 runde); A e CT în prima repriză, T în a doua.
    const winners = ["A", "A", "B", "A", "A", "B", "A", "B", "A", "B", "A", "A", "B", "A", "B", "A"];
    for (const [i, winner] of winners.entries()) {
      const round = i + 1;
      const firstHalf = round <= 8;
      const winTeam = winner === "A" ? teamA : teamB;
      const loseTeam = winner === "A" ? teamB : teamA;
      const events = [];
      for (let k = 0; k < 3; k++) {
        const killer = winTeam[(round + k) % 5];
        const victim = loseTeam[(round * 2 + k) % 5];
        const headshot = (round + k) % 3 === 0;
        events.push(this.event("kill", { killer, victim, weapon: k === 0 ? "ak47" : "m4a1", headshot, map }));
        const s = stats.get(killer.auth);
        s.kills += 1;
        s.headshots += headshot ? 1 : 0;
        s.damage += 100;
        stats.get(victim.auth).deaths += 1;
      }
      score[winner] += 1;
      stats.get(winTeam[round % 5].auth).mvps += 1;
      const ctTeam = firstHalf ? "A" : "B";
      events.push(
        this.event("round_end", {
          winner: winner === ctTeam ? "CT" : "T",
          map,
          players: players.map((p, idx) => ({ player: p, team: (idx < 5) === (ctTeam === "A") ? "CT" : "T" })),
        }),
      );
      events.push(this.event("match_round", { matchId, round, winner, scoreA: score.A, scoreB: score.B, reason: "elimination" }));
      await this.send(events);
      if (round === 8) await this.send([this.event("match", { match: this.matchState(matchId, "halftime", { map, round, score: { ...score }, teamA, teamB, stats }) })]);
      if (round === 8) await this.send([this.event("match", { match: this.matchState(matchId, "live", { map, round, score: { ...score }, teamA, teamB, stats }) })]);
      if (round % 4 === 0) await this.heartbeat({ map, players: roster(), match: this.matchState(matchId, "live", { map, round, score: { ...score }, teamA, teamB, stats }) });
    }
    const ended = await this.send([this.event("match", { match: this.matchState(matchId, "ended", { map, round: winners.length, score: { ...score }, teamA, teamB, stats }) })]);

    await this.send(players.slice(0, 4).map((p, i) => this.event("weapon_stats", { player: p, weapon: "ak47", shots: 100 + i * 10, hits: 40 + i * 5, damage: 1200 + i * 100, headshots: 2 })));
    const cheater = players[9];
    const ban = await this.send([
      this.event("sanction", { kind: "ban", target: { ...cheater }, minutes: 60, reason: "wallhack", scope: "global", admin: { ...players[0] } }),
      this.event("admin_action", { admin: players[0], action: "kick", target: cheater, reason: "wallhack" }),
    ]);
    await this.send(players.map((p) => this.event("disconnect", { player: p, playtime: 1800 })));
    await this.heartbeat({ map, players: [], match: null });
    const sanctions = await this.pullSanctions();
    this.log(`scenariul complet: meciul ${matchId} încheiat ${score.A}–${score.B}, banul ${ban[0]?.sanctionId ?? "?"}`);
    return { matchId, score, players, cheater, ended: ended[0], ban: ban[0], sanctions };
  }
}

// ─── Linia de comandă ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  }
  return out;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.key) {
    console.error("Folosire: node gcs-mock-server.mjs --url <site> --key <gcs1.keyId.secret> [--scenario full|heartbeat] [--game cs2|cs16]");
    process.exit(2);
  }
  const mock = new GcsMockServer({ token: args.key, transport: httpTransport(args.url), game: args.game ?? "cs2", log: (m) => console.log(m) });
  const run = args.scenario === "heartbeat" ? mock.heartbeat({ players: [mockPlayer(mock.game, 1)] }) : mock.scenarioFull();
  run
    .then((result) => {
      console.log(JSON.stringify({ ok: true, matchId: result.matchId ?? null, score: result.score ?? null, ban: result.ban ?? null, config: result.config ?? null }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
