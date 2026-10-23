import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, GAME_SERVER_IP, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { signBridgeRequest } from "./signing";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

/** O cerere semnată cu cheia dată (timpul = ceasul lumii, dacă nu e dat altul). */
async function call(token: string, opts: { method?: string; path?: string; body?: string; timestamp?: number; nonce?: string; alg?: "hmac-sha256" | "sha256-env"; headers?: Record<string, string>; ip?: string } = {}) {
  const method = opts.method ?? "POST";
  const path = opts.path ?? "/heartbeat";
  const body = opts.body ?? (method === "GET" ? "" : JSON.stringify({ plugin: "test/1", map: "de_dust2", players: [] }));
  const signed = signBridgeRequest({ token, method, path, body, timestamp: opts.timestamp ?? Math.floor(w.clock.now / 1000), ...(opts.nonce ? { nonce: opts.nonce } : {}), alg: opts.alg ?? "hmac-sha256" });
  const headers: Record<string, string> = Object.fromEntries(Object.entries({ ...signed, ...opts.headers }).map(([k, v]) => [k.toLowerCase(), v]));
  const res = await w.bridge.api.handle({ method, path, header: (n) => headers[n.toLowerCase()] ?? null, body, ip: opts.ip ?? GAME_SERVER_IP });
  return { status: res.status, headers: res.headers, json: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null };
}

describe("autentificarea protocolului (§5.3)", () => {
  it("heartbeat semnat (hmac-sha256 și sha256-env): 200, ritmul, versiunile și timpul serverului", async () => {
    const { token } = await w.bridgeServer();
    const res = await call(token);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, serverTime: Math.floor(w.clock.now / 1000), config: { heartbeat: 30, events: 10, identityMode: "mixed", nameIds: false, isMix: false, linkCommand: "/gcs" }, versions: { sanctions: 0 } });
    expect(res.headers["X-GCS-Time"]).toBe(String(Math.floor(w.clock.now / 1000)));
    expect((await call(token, { alg: "sha256-env" })).status).toBe(200);
  });

  it("anteturi lipsă → missing_auth; cheie necunoscută și semnătură greșită → același cod unauthorized", async () => {
    const { token } = await w.bridgeServer();
    expect((await call(token, { headers: { "X-GCS-Nonce": "scurt" } })).json).toMatchObject({ error: "missing_auth" });
    const unknown = `gcs1.abcdefghijkl.${"A".repeat(43)}`;
    expect(await call(unknown)).toMatchObject({ status: 401, json: { error: "unauthorized" } });
    const forged = await call(token, { headers: { "X-GCS-Signature": `hmac-sha256=${"0".repeat(64)}` } });
    expect(forged).toMatchObject({ status: 401, json: { error: "unauthorized" } });
  });

  it("corpul face parte din semnătură: un corp schimbat după semnare e respins", async () => {
    const { token } = await w.bridgeServer();
    const body = JSON.stringify({ plugin: "a" });
    const signed = signBridgeRequest({ token, method: "POST", path: "/heartbeat", body, timestamp: Math.floor(w.clock.now / 1000) });
    const h = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k.toLowerCase(), v]));
    const res = await w.bridge.api.handle({ method: "POST", path: "/heartbeat", header: (n) => h[n] ?? null, body: JSON.stringify({ plugin: "b" }), ip: GAME_SERVER_IP });
    expect(res.status).toBe(401);
  });

  it("cheia revocată nu mai merge; cheia rotită mai merge 10 minute", async () => {
    const server = await w.bridgeServer();
    const rotated = await w.bridge.keys.rotate(w.root, server.id, server.keyRowId);
    expect((await call(server.token)).status).toBe(200);
    expect((await call(rotated.token)).status).toBe(200);
    w.clock.now += 11 * 60_000;
    expect((await call(server.token)).json).toMatchObject({ error: "unauthorized" });
    expect((await call(rotated.token)).status).toBe(200);
    await w.bridge.keys.revoke(w.root, server.id, rotated.id);
    expect((await call(rotated.token)).json).toMatchObject({ error: "unauthorized" });
    const keys = await w.bridge.keys.list(w.root, server.id);
    expect(keys.map((k) => k.active)).toEqual([false, false]);
    expect(await w.db.auditLog.count({ where: { action: { in: ["servers.key.create", "servers.key.rotate", "servers.key.revoke"] } } })).toBe(3);
  });

  it("cheia nu e păstrată în clar: doar hash-ul secretului, sigilat", async () => {
    const { token, keyId } = await w.bridgeServer();
    const row = await w.db.gameServerKey.findUniqueOrThrow({ where: { keyId } });
    const secret = token.split(".")[2]!;
    expect(row.signingKey).not.toContain(secret);
    expect(row.signingKey).toMatch(/^v1\./);
  });

  it("ceasul: mai mult de 300 s diferență → clock_skew cu serverTime; serverul fals își corectează decalajul", async () => {
    const { token } = await w.bridgeServer();
    const res = await call(token, { timestamp: Math.floor(w.clock.now / 1000) - 400 });
    expect(res).toMatchObject({ status: 401, json: { error: "clock_skew", serverTime: Math.floor(w.clock.now / 1000) } });
    const mock = w.mock(token);
    mock.offset = -900;
    expect((await mock.heartbeat()).ok).toBe(true);
    expect(mock.offset).toBe(0);
  });

  it("reluarea: același nonce a doua oară → 409 replay", async () => {
    const { token } = await w.bridgeServer();
    const nonce = "nonce-reluat-123456";
    expect((await call(token, { nonce })).status).toBe(200);
    expect(await call(token, { nonce })).toMatchObject({ status: 409, json: { error: "replay" } });
  });

  it("serverul dezactivat → 403; aplicația oprită → 404; corpul prea mare → 413; rută necunoscută → 404", async () => {
    const server = await w.bridgeServer();
    expect((await call(server.token, { method: "POST", path: "/nimic", body: "{}" })).status).toBe(404);
    expect((await call(server.token, { body: JSON.stringify({ x: "y".repeat(600 * 1024) }) })).status).toBe(413);
    await w.db.gameServer.update({ where: { id: server.id }, data: { enabled: false } });
    expect(await call(server.token)).toMatchObject({ status: 403, json: { error: "server_disabled" } });
    await w.apps.setEnabled(w.root, "servers", false);
    expect((await call(server.token)).status).toBe(404);
  });

  it("limitele: 30 de eșecuri pe minut pe IP → 429; 240 de cereri pe minut pe cheie → 429 cu Retry-After", async () => {
    const { token, keyId } = await w.bridgeServer();
    const bad = `gcs1.abcdefghijkl.${"B".repeat(43)}`;
    for (let i = 0; i < 30; i++) await call(bad, { ip: "203.0.113.99" });
    expect((await call(token, { ip: "203.0.113.99" })).status).toBe(429);
    expect((await call(token)).status).toBe(200);
    await w.kv.set(`gcs:rl:bridge-key:${keyId}`, "240", { ttlMs: 60_000 });
    const limited = await call(token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("max 5 chei active pe server; jocurile fără punte sunt refuzate", async () => {
    const server = await w.bridgeServer();
    for (let i = 0; i < 4; i++) await w.bridge.keys.create(w.root, server.id);
    await expect(w.bridge.keys.create(w.root, server.id)).rejects.toMatchObject({ fields: { keys: "too_many" } });
    await expect(w.bridge.keys.create(w.member, server.id)).rejects.toMatchObject({ code: "forbidden" });
    const { id } = await w.addServer({ game: "minecraft", port: 25565 });
    const mc = await w.bridge.keys.create(w.root, id);
    expect(await call(mc.token)).toMatchObject({ status: 403, json: { error: "unsupported_game" } });
  });

  it("modulele opționale (plugin-v2 §1.2): implicit toate oprite (colectorul); pornite din ACP ajung în config, cu jurnal", async () => {
    const server = await w.bridgeServer();
    expect((await call(server.token)).json!.config).toMatchObject({ features: { admins: false, sanctions: false, vip: false, mixReady: false, commands: false } });
    await w.bridge.saveConfig(w.root, server.id, { identityMode: "mixed", nameIds: false, isMix: true, manageAdmins: true, enforceSanctions: true });
    expect((await call(server.token)).json!.config).toMatchObject({ isMix: true, features: { admins: true, sanctions: true, vip: false, mixReady: false, commands: false } });
    // Fără câmpurile modulelor, ele rămân neschimbate.
    await w.bridge.saveConfig(w.root, server.id, { identityMode: "steam", nameIds: false, isMix: true });
    expect((await w.bridge.status(w.root, server.id))!.features).toEqual({ admins: true, sanctions: true, vip: false, mixReady: false, commands: false });
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: "servers.bridge.update" }, orderBy: { createdAt: "asc" }, skip: 1 });
    expect(audit.after).toMatchObject({ manageAdmins: true, enforceSanctions: true, adminCommands: false });
    await expect(w.bridge.saveConfig(w.member, server.id, { identityMode: "mixed", nameIds: false, isMix: false, manageAdmins: true })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("heartbeat-ul: modulele active pe server și scorul echipelor ajung în starea punții; doar cheile cunoscute", async () => {
    const server = await w.bridgeServer();
    await call(server.token, { body: JSON.stringify({ plugin: "gcs-amxx/1.1.0", map: "de_dust2", players: [], modules: ["admins", "evil", 5, "admins"], scores: { ct: 7, t: 3 } }) });
    const status = await w.bridge.status(w.root, server.id);
    expect(status!.roster).toMatchObject({ modules: ["admins"], scores: { ct: 7, t: 3 } });
  });
});
