#!/usr/bin/env node
// GCS Server Bridge — serverul de joc fals (specul 2026-10-08-servere-bridge §18).
//
// Vorbește protocolul v1 exact ca pluginurile (semnarea cererilor, decalajul ceasului, reîncercarea la `clock_skew`):
// heartbeat-uri (cu flag-urile de admin ale jucătorilor, ca pluginurile 1.1), conectări, ucideri, runde, un meci mix
// complet (warmup → live → halftime → ended), un ban și înrolarea automată (specul plugin-v2 §5: cererea fără cheie,
// așteptarea aprobării, cheia primită o singură dată). Fără dependențe (doar modulele Node). Transportul e o funcție:
// testele unitare apelează direct API-ul, E2E-ul și linia de comandă folosesc HTTP real.
//
//   node gcs-mock-server.mjs --url https://site.exemplu --key gcs1.<keyId>.<secret> --scenario full [--game cs2|cs16]
//   node gcs-mock-server.mjs --url https://site.exemplu --scenario enroll [--game cs2|cs16] [--a2s-port 27015]
//
// Licența: MIT (ca pluginul CS2).

import { createHash, createHmac, randomBytes } from "node:crypto";
import dgram from "node:dgram";

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

/**
 * Transportul HTTP real (fetch din Node ≥ 18). `extraHeaders` se adaugă la fiecare cerere (ex. `X-Forwarded-For` în
 * E2E, unde nu există proxy-ul care îl pune în producție).
 */
export function httpTransport(baseUrl, extraHeaders = {}) {
  const base = String(baseUrl).replace(/\/+$/, "") + BRIDGE_BASE_PATH;
  return async ({ method, path, headers, body }) => {
    const res = await fetch(base + path, { method, headers: { ...extraHeaders, ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body || undefined });
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

/**
 * Un server de joc minimal pe UDP (127.0.0.1): răspunde la A2S_INFO (formatul Source) cu folderul jocului (`cstrike` /
 * `csgo`), ca verificarea înrolării să găsească un server real la IP:port.
 */
export function startA2sResponder({ port = 0, game = "cs2", name = "GCS Mock", map = "de_dust2", players = 0, maxPlayers = 32 } = {}) {
  const cstr = (v) => Buffer.concat([Buffer.from(String(v), "utf8"), Buffer.from([0])]);
  const app = Buffer.alloc(2);
  app.writeInt16LE(game === "cs16" ? 10 : 730);
  const info = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
    cstr(name),
    cstr(map),
    cstr(game === "cs16" ? "cstrike" : "csgo"),
    cstr(game === "cs16" ? "Counter-Strike" : "Counter-Strike 2"),
    app,
    Buffer.from([players, maxPlayers, 0, 0x64, 0x6c, 0, 1]),
    cstr("1.0.0.0"),
  ]);
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    if (msg.length >= 5 && msg.readInt32LE(0) === -1 && msg[4] === 0x54) udp.send(info, rinfo.port, rinfo.address);
  });
  return new Promise((resolve) =>
    udp.bind(port, "127.0.0.1", () => resolve({ port: udp.address().port, close: () => new Promise((done) => udp.close(() => done())) })),
  );
}

export class GcsMockServer {
  /**
   * `token` lipsă = serverul nu are încă o cheie: se înrolează (`enroll`, `waitForKey`).
   * @param {{ token?: string, transport: Function, game?: string, clock?: () => number, alg?: string, runId?: string, log?: (msg: string) => void }} opts
   */
  constructor(opts) {
    this.key = opts.token ? parseKey(opts.token) : null;
    this.token = opts.token ?? null;
    /** Secretul înrolării (generat o singură dată) și referința primită de la site. */
    this.enrollSecret = randomBytes(32).toString("base64url");
    this.enrollment = null;
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
    if (!this.key) throw new Error("Serverul fals nu are încă o cheie (înrolează-l: enroll / waitForKey).");
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

  /** O cerere a înrolării: fără semnătură (pluginul nu are încă o cheie). */
  async plain(path, payload) {
    const body = JSON.stringify(payload);
    const res = await this.transport({ method: "POST", path, headers: {}, body });
    const json = res.body ? JSON.parse(res.body) : null;
    if (json && typeof json.serverTime === "number") this.offset += json.serverTime - this.now();
    return { status: res.status, json, headers: res.headers ?? {} };
  }

  /** `POST /enroll` (specul plugin-v2 §5.2): jocul, portul, numele, harta, secretul; ține minte referința primită. */
  async enroll({ port = 27015, hostname = "GCS Mock", map = "de_dust2", players = 0, maxPlayers = 32 } = {}) {
    const res = await this.plain("/enroll", { game: this.game, port, hostname, map, maxPlayers, players, plugin: `gcs-mock/${this.game}/1.1.0`, secret: this.enrollSecret });
    if (res.status === 200 && res.json?.enrollment) this.enrollment = res.json.enrollment;
    return res;
  }

  /** `POST /enroll/status`: cu cheia livrată, serverul fals trece pe protocolul semnat. */
  async enrollStatus() {
    const res = await this.plain("/enroll/status", { enrollment: this.enrollment, secret: this.enrollSecret });
    if (res.status === 200 && typeof res.json?.key === "string") {
      this.key = parseKey(res.json.key);
      this.token = res.json.key;
    }
    return res;
  }

  /** Întreabă starea până la cheie (aprobarea din ACP); `rejected`, înrolarea dispărută sau timpul expirat → eroare. */
  async waitForKey({ intervalMs = 1000, timeoutMs = 120_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await this.enrollStatus();
      if (this.key) return this.token;
      if (res.json?.status === "rejected") throw new Error("Înrolarea a fost respinsă în ACP.");
      if (res.status === 404) throw new Error("Înrolarea nu mai există (expirată sau ștearsă).");
      if (Date.now() >= deadline) throw new Error("Nicio aprobare în timpul dat.");
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async heartbeat({ map = "de_dust2", players = [], match, maxPlayers = 32, modules, scores } = {}) {
    const res = await this.request("POST", "/heartbeat", {
      plugin: `gcs-mock/${this.game}/1.1.0`,
      map,
      maxPlayers,
      players,
      ...(match !== undefined ? { match } : {}),
      ...(modules !== undefined ? { modules } : {}),
      ...(scores !== undefined ? { scores } : {}),
    });
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

// Rulat direct (node gcs-mock-server.mjs …). Fără import.meta: testele E2E îl încarcă și prin loader-ul Playwright (CJS).
const isMain = /gcs-mock-server\.mjs$/.test(process.argv[1] ?? "");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || (!args.key && args.scenario !== "enroll")) {
    console.error("Folosire: node gcs-mock-server.mjs --url <site> --key <gcs1.keyId.secret> [--scenario full|heartbeat] [--game cs2|cs16]");
    console.error("          node gcs-mock-server.mjs --url <site> --scenario enroll [--game cs2|cs16] [--a2s-port <port>]");
    process.exit(2);
  }
  const mock = new GcsMockServer({ token: args.key, transport: httpTransport(args.url), game: args.game ?? "cs2", log: (m) => console.log(m) });
  const enrollScenario = async () => {
    // Un server de joc minimal la 127.0.0.1:<port> (pentru verificarea site-ului; doar cu excepția operatorului).
    const a2s = await startA2sResponder({ port: Number(args["a2s-port"] ?? 0), game: mock.game });
    try {
      const res = await mock.enroll({ port: a2s.port });
      if (res.status !== 200) throw new Error(`enroll: ${res.status} ${JSON.stringify(res.json)}`);
      console.log(`Înrolarea ${res.json.status}: aprobă serverul în ACP → Gaming → Servere → Servere noi detectate.`);
      const token = await mock.waitForKey({ intervalMs: 5000, timeoutMs: 15 * 60_000 });
      const hb = await mock.heartbeat({ players: [mockPlayer(mock.game, 1)] });
      return { config: hb.config, key: `${token.split(".").slice(0, 2).join(".")}.…` };
    } finally {
      await a2s.close();
    }
  };
  const run = args.scenario === "heartbeat" ? mock.heartbeat({ players: [mockPlayer(mock.game, 1)] }) : args.scenario === "enroll" ? enrollScenario() : mock.scenarioFull();
  run
    .then((result) => {
      console.log(JSON.stringify({ ok: true, matchId: result.matchId ?? null, score: result.score ?? null, ban: result.ban ?? null, config: result.config ?? null, key: result.key ?? null }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
