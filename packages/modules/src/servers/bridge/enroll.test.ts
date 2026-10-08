import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { onlineStatus } from "../../../test/serverWorld";
import { BRIDGE_SETTING } from "./config";
import { MAX_PENDING, MAX_PENDING_PER_IP } from "./enroll";
import { signBridgeRequest } from "./signing";

let w: GcsBridgeWorld;
beforeEach(async () => {
  w = await createBridgeWorld();
});

const DAY = 86_400_000;
/** Un IP public (interogarea are voie) și unul local permis de excepția lumii de test (127.0.0.1). */
const IP = "93.184.216.34";
const LOCAL = "127.0.0.1";
const secretOf = (n: number) => `secret-${String(n).padStart(4, "0")}-${"x".repeat(40)}`;

async function call(path: string, body: unknown, ip = IP, method = "POST") {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const res = await w.bridge.api.handle({ method, path, header: () => null, body: raw, ip });
  return { status: res.status, headers: res.headers, json: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null };
}

const enrollBody = (over: Record<string, unknown> = {}) => ({
  game: "cs16",
  port: 27015,
  hostname: "GCS | Public",
  map: "de_dust2",
  maxPlayers: 32,
  players: 3,
  plugin: "gcs-amxx/1.1.0",
  secret: secretOf(1),
  ...over,
});

/** Răspunsul A2S al serverului de la IP:port (interogarea falsă a lumii). */
function answer(ip: string, port: number, folder = "cstrike", patch: Record<string, unknown> = {}) {
  w.answers.set(`${ip}:${port}`, onlineStatus({ name: "GCS | Public", map: "de_dust2", folder, ...patch }));
}

async function enroll(over: Record<string, unknown> = {}, ip = IP) {
  const res = await call("/enroll", enrollBody(over), ip);
  return res;
}

const poll = (enrollment: string, secret = secretOf(1), ip = IP) => call("/enroll/status", { enrollment, secret }, ip);

describe("înrolarea automată (plugin-v2 §5): cererea", () => {
  it("o cerere nouă: în așteptare, referința dată pluginului, pe site doar hash-ul secretului; interogarea confirmă serverul", async () => {
    answer(IP, 27015);
    const res = await enroll({ hostname: `GCS${String.fromCharCode(0)} | ${String.fromCharCode(0x202e)}Public${String.fromCharCode(10)}` });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "pending", retryAfter: 60 });
    expect(res.json!.enrollment).toMatch(/^[a-z0-9]{24}$/);
    const row = await w.db.gameServerEnrollment.findFirstOrThrow();
    expect(row.secretHash).toBe(createHash("sha256").update(secretOf(1)).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(secretOf(1));
    expect(row).toMatchObject({ ip: IP, port: 27015, game: "cs16", hostname: "GCS | Public", map: "de_dust2", players: 3, maxPlayers: 32, status: "PENDING" });
    expect(row.check).toMatchObject({ result: "ok", folder: "cstrike", nameMatch: true, mapMatch: true });
    expect(w.calls.at(-1)).toMatchObject({ game: "cs16", host: IP, port: 27015 });
    expect(row.expiresAt.getTime() - w.clock.now).toBe(7 * DAY);
  });

  it("același secret: aceeași înrolare (fără copii), datele actualizate; alt secret de la același IP = altă înrolare", async () => {
    const first = await enroll();
    const again = await enroll({ map: "de_inferno", players: 7 });
    expect(again.json!.enrollment).toBe(first.json!.enrollment);
    expect(await w.db.gameServerEnrollment.count()).toBe(1);
    expect(await w.db.gameServerEnrollment.findFirstOrThrow()).toMatchObject({ map: "de_inferno", players: 7 });
    const other = await enroll({ secret: secretOf(2) });
    expect(other.json!.enrollment).not.toBe(first.json!.enrollment);
    expect(await w.db.gameServerEnrollment.count()).toBe(2);
  });

  it("interogarea: alt joc la adresă → game_mismatch; fără răspuns → offline; adresă privată → blocked (fără interogare)", async () => {
    answer(IP, 27016, "csgo");
    await enroll({ port: 27016 });
    expect((await w.db.gameServerEnrollment.findFirstOrThrow()).check).toMatchObject({ result: "game_mismatch", folder: "csgo" });
    await enroll({ port: 27017, secret: secretOf(2) });
    expect((await w.db.gameServerEnrollment.findFirstOrThrow({ where: { port: 27017 } })).check).toMatchObject({ result: "offline" });
    const calls = w.calls.length;
    await enroll({ secret: secretOf(3) }, "10.0.0.5");
    expect((await w.db.gameServerEnrollment.findFirstOrThrow({ where: { ip: "10.0.0.5" } })).check).toMatchObject({ result: "blocked" });
    expect(w.calls.length).toBe(calls);
  });

  it("datele invalide → 400; corpul mare → 413; altă metodă → 405; JSON stricat → 400", async () => {
    expect((await enroll({ game: "minecraft" })).json).toMatchObject({ error: "invalid_game" });
    expect((await enroll({ port: 80 })).json).toMatchObject({ error: "invalid_port" });
    expect((await enroll({ port: 27015.5 })).json).toMatchObject({ error: "invalid_port" });
    expect((await enroll({ secret: "scurt" })).json).toMatchObject({ error: "invalid_secret" });
    expect((await enroll({ secret: "a b".repeat(20) })).status).toBe(400);
    expect((await call("/enroll", { ...enrollBody(), hostname: "x".repeat(5000) })).status).toBe(413);
    expect((await call("/enroll", enrollBody(), IP, "GET")).status).toBe(405);
    expect((await call("/enroll", "{nu e json")).json).toMatchObject({ error: "invalid_json" });
    expect(await w.db.gameServerEnrollment.count()).toBe(0);
  });

  it("setarea oprită → 403 enroll_disabled; IP-ul din lista blocată → 403 blocked (și starea); aplicația oprită → 404", async () => {
    const { json } = await enroll();
    await w.settings.set(BRIDGE_SETTING.enrollEnabled, false, w.root);
    expect(await enroll({ secret: secretOf(2) })).toMatchObject({ status: 403, json: { error: "enroll_disabled" } });
    // Starea unei înrolări existente merge în continuare (aprobările făcute înainte se finalizează).
    expect((await poll(json!.enrollment as string)).json).toMatchObject({ status: "pending" });
    await w.settings.set(BRIDGE_SETTING.enrollEnabled, true, w.root);
    await w.settings.set(BRIDGE_SETTING.enrollBlockedIps, "198.51.100.0/24, 93.184.216.34", w.root);
    expect(await enroll()).toMatchObject({ status: 403, json: { error: "blocked" } });
    expect(await poll(json!.enrollment as string)).toMatchObject({ status: 403, json: { error: "blocked" } });
    expect((await enroll({ secret: secretOf(3) }, "198.51.100.77")).status).toBe(403);
    await expect(w.settings.set(BRIDGE_SETTING.enrollBlockedIps, "1.2.3.4/99", w.root)).rejects.toMatchObject({ code: "validation" });
    await w.apps.setEnabled(w.root, "servers", false);
    expect((await enroll({ secret: secretOf(4) }, "203.0.113.9")).status).toBe(404);
  });

  it("limitele pe IP: 10 înrolări pe oră; 30 de interogări ale stării pe minut; 30 de eșecuri pe minut", async () => {
    for (let i = 0; i < 10; i++) expect((await enroll({ secret: secretOf(1) })).status).toBe(200);
    const limited = await enroll({ secret: secretOf(1) });
    expect(limited).toMatchObject({ status: 429, json: { error: "rate_limited" } });
    expect(Number(limited.headers["Retry-After"])).toBeGreaterThan(0);
    expect((await enroll({ secret: secretOf(2) }, "93.184.216.35")).status).toBe(200);

    const { json } = await enroll({ secret: secretOf(3) }, "93.184.216.36");
    for (let i = 0; i < 30; i++) expect((await poll(json!.enrollment as string, secretOf(3), "93.184.216.36")).status).toBe(200);
    expect((await poll(json!.enrollment as string, secretOf(3), "93.184.216.36")).status).toBe(429);

    for (let i = 0; i < 30; i++) expect((await poll("a".repeat(24), secretOf(9), "93.184.216.37")).status).toBe(404);
    expect((await poll("a".repeat(24), secretOf(9), "93.184.216.37")).status).toBe(429);
  });

  it("plafoanele: max 5 înrolări în așteptare pe IP și max 50 în total → 503 too_many_pending", async () => {
    for (let i = 0; i < MAX_PENDING_PER_IP; i++) expect((await enroll({ secret: secretOf(i), port: 27015 + i })).status).toBe(200);
    expect(await enroll({ secret: secretOf(99), port: 27100 })).toMatchObject({ status: 503, json: { error: "too_many_pending" } });
    const expiresAt = new Date(w.clock.now + DAY);
    await w.db.gameServerEnrollment.createMany({
      data: Array.from({ length: MAX_PENDING - MAX_PENDING_PER_IP }, (_, i) => ({ ref: `r${String(i).padStart(23, "0")}`, secretHash: `h${i}`, game: "cs2", ip: `203.0.113.${i + 1}`, port: 27015, expiresAt })),
    });
    expect(await enroll({ secret: secretOf(98) }, "93.184.216.40")).toMatchObject({ status: 503, json: { error: "too_many_pending" } });
    // Cele expirate nu se numără.
    await w.db.gameServerEnrollment.updateMany({ where: { ip: { startsWith: "203.0.113." } }, data: { expiresAt: new Date(w.clock.now - 1) } });
    expect((await enroll({ secret: secretOf(98) }, "93.184.216.40")).status).toBe(200);
  });
});

describe("înrolarea automată: starea, aprobarea și cheia livrată o singură dată", () => {
  it("referința necunoscută și secretul greșit dau același 404; în așteptare → pending", async () => {
    answer(IP, 27015);
    const { json } = await enroll();
    const ref = json!.enrollment as string;
    expect(await poll(ref)).toMatchObject({ status: 200, json: { status: "pending" } });
    const wrong = await poll(ref, secretOf(2));
    const unknown = await poll("b".repeat(24));
    expect(wrong).toMatchObject({ status: 404, json: { error: "unknown_enrollment" } });
    expect(unknown).toMatchObject({ status: 404, json: { error: "unknown_enrollment" } });
    expect((await call("/enroll/status", { enrollment: ref })).status).toBe(404);
  });

  it("aprobarea fără interogare confirmată cere confirmarea; serverul nou din datele curățate; cheia o singură dată, apoi merge semnat", async () => {
    const { json } = await enroll({ hostname: "Noul | Server" });
    const ref = json!.enrollment as string;
    const [row] = await w.bridge.enrollments.list(w.root);
    expect(row).toMatchObject({ status: "PENDING", check: { result: "offline" }, sameAddress: null, duplicate: false });
    await expect(w.bridge.enrollments.approve(w.root, row!.id)).rejects.toMatchObject({ fields: { check: "not_verified" } });
    await expect(w.bridge.enrollments.approve(w.member, row!.id, { force: true })).rejects.toMatchObject({ code: "forbidden" });
    const approved = await w.bridge.enrollments.approve(w.root, row!.id, { force: true });
    expect(approved.created).toBe(true);
    expect(await w.db.gameServer.findUniqueOrThrow({ where: { id: approved.serverId } })).toMatchObject({ game: "cs16", host: IP, port: 27015, name: "Noul | Server", manageAdmins: false, enforceSanctions: false });
    expect(await w.db.auditLog.findFirst({ where: { action: "servers.enroll.approve" } })).toMatchObject({ actorId: w.root.userId, targetId: String(approved.serverId) });
    expect(await w.db.auditLog.count({ where: { action: "servers.create" } })).toBe(1);

    const first = await poll(ref);
    expect(first.json).toMatchObject({ status: "approved" });
    const token = first.json!.key as string;
    expect(token).toMatch(/^gcs1\.[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
    const audit = await w.db.auditLog.findFirstOrThrow({ where: { action: "servers.key.create" }, orderBy: { createdAt: "desc" } });
    expect(audit.actorId).toBeNull();
    expect(audit.after).toMatchObject({ source: "enrollment", label: expect.stringMatching(/^Înrolare automată \d{4}-\d{2}-\d{2}$/) });
    expect(JSON.stringify(audit)).not.toContain(token.split(".")[2]!);

    // Cheia merge pe protocolul semnat; după prima folosire nu se mai livrează nimic.
    const body = JSON.stringify({ plugin: "gcs-amxx/1.1.0", map: "de_dust2", players: [] });
    const signed = signBridgeRequest({ token, method: "POST", path: "/heartbeat", body, timestamp: Math.floor(w.clock.now / 1000), alg: "sha256-env" });
    const h = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k.toLowerCase(), v]));
    expect((await w.bridge.api.handle({ method: "POST", path: "/heartbeat", header: (n) => h[n.toLowerCase()] ?? null, body, ip: IP })).status).toBe(200);
    expect((await poll(ref)).json).toEqual({ status: "approved", delivered: true, serverTime: expect.any(Number) });
    expect((await w.bridge.enrollments.list(w.root))[0]).toMatchObject({ status: "APPROVED", delivered: true, server: { id: approved.serverId } });
  });

  it("răspunsul pierdut: o cheie livrată și nefolosită se revocă și se emite alta, de cel mult 3 ori", async () => {
    answer(IP, 27015);
    const { json } = await enroll();
    const ref = json!.enrollment as string;
    const [row] = await w.bridge.enrollments.list(w.root);
    const { serverId } = await w.bridge.enrollments.approve(w.root, row!.id);
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) tokens.push((await poll(ref)).json!.key as string);
    expect(new Set(tokens).size).toBe(3);
    expect((await poll(ref)).json).toMatchObject({ status: "approved", delivered: true });
    const keys = await w.bridge.keys.list(w.root, serverId);
    expect(keys.filter((k) => k.active)).toHaveLength(1);
    expect(keys.find((k) => k.active)!.keyId).toBe(tokens[2]!.split(".")[1]);
    expect(await w.db.auditLog.count({ where: { action: "servers.key.revoke" } })).toBe(2);
  });

  it("atașarea la un server existent al aceluiași joc (implicit cel cu aceeași adresă); alt joc → refuzat", async () => {
    const existing = await w.addServer({ game: "cs16", host: IP, port: 27015, name: "Existent" });
    const other = await w.addServer({ game: "cs2", host: IP, port: 27020 });
    answer(IP, 27015);
    const { json } = await enroll();
    const [row] = await w.bridge.enrollments.list(w.root);
    expect(row!.sameAddress).toEqual({ id: existing.id, name: "Existent" });
    await expect(w.bridge.enrollments.approve(w.root, row!.id, { serverId: other.id })).rejects.toMatchObject({ fields: { serverId: "invalid" } });
    // Fără atașare, adresa duplicată e refuzată de aplicația Servere, iar înrolarea rămâne în așteptare.
    await expect(w.bridge.enrollments.approve(w.root, row!.id)).rejects.toMatchObject({ fields: { host: "duplicate_server" } });
    expect((await w.bridge.enrollments.list(w.root))[0]!.status).toBe("PENDING");
    expect(await w.bridge.enrollments.approve(w.root, row!.id, { serverId: existing.id })).toEqual({ serverId: existing.id, created: false });
    expect((await poll(json!.enrollment as string)).json).toMatchObject({ status: "approved", key: expect.any(String) });
  });

  it("respingerea: pluginul află; același secret rămâne respins; jurnalul", async () => {
    const { json } = await enroll();
    const [row] = await w.bridge.enrollments.list(w.root);
    await w.bridge.enrollments.reject(w.root, row!.id);
    expect((await poll(json!.enrollment as string)).json).toMatchObject({ status: "rejected" });
    expect((await enroll()).json).toMatchObject({ status: "rejected" });
    expect(await w.db.auditLog.count({ where: { action: "servers.enroll.reject" } })).toBe(1);
    await expect(w.bridge.enrollments.reject(w.root, row!.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("„Blochează IP”: IP-ul intră în listă (jurnalul setărilor), înrolările lui în așteptare sunt respinse", async () => {
    await enroll();
    await enroll({ secret: secretOf(2), port: 27016 });
    const keep = await enroll({ secret: secretOf(3) }, "93.184.216.99");
    const row = (await w.bridge.enrollments.list(w.root)).find((r) => r.ip === IP)!;
    expect(await w.bridge.enrollments.blockIp(w.root, row.id)).toEqual({ rejected: 2 });
    expect(await w.settings.get(BRIDGE_SETTING.enrollBlockedIps)).toBe(IP);
    expect(await enroll({ secret: secretOf(4) })).toMatchObject({ status: 403, json: { error: "blocked" } });
    expect((await poll(keep.json!.enrollment as string, secretOf(3), "93.184.216.99")).json).toMatchObject({ status: "pending" });
    expect(await w.db.auditLog.count({ where: { action: { in: ["servers.enroll.block", "settings.update"] } } })).toBe(2);
  });

  it("expirarea: după 7 zile înrolarea dispare (starea → 404, jobul o șterge); același secret se înrolează din nou", async () => {
    const { json } = await enroll();
    w.clock.now += 7 * DAY + 1;
    expect((await poll(json!.enrollment as string)).status).toBe(404);
    expect((await w.bridge.sweep()).enrollments).toBe(1);
    const again = await enroll();
    expect(again.json).toMatchObject({ status: "pending" });
    expect(again.json!.enrollment).not.toBe(json!.enrollment);
  });

  it("serverul șters după aprobare: înrolarea dispare, pluginul se înrolează din nou", async () => {
    answer(IP, 27015);
    const { json } = await enroll();
    const [row] = await w.bridge.enrollments.list(w.root);
    const { serverId } = await w.bridge.enrollments.approve(w.root, row!.id);
    await w.servers.remove(w.root, serverId);
    expect((await poll(json!.enrollment as string)).status).toBe(404);
    expect((await enroll()).json).toMatchObject({ status: "pending" });
  });

  it("interogarea se repetă: la stare (cel mult o dată la 5 minute, de la același IP) și din ACP („Verifică din nou”)", async () => {
    const { json } = await enroll();
    const ref = json!.enrollment as string;
    answer(IP, 27015);
    await poll(ref);
    expect((await w.db.gameServerEnrollment.findFirstOrThrow()).check).toMatchObject({ result: "offline" });
    w.clock.now += 5 * 60_000;
    await poll(ref);
    expect((await w.db.gameServerEnrollment.findFirstOrThrow()).check).toMatchObject({ result: "ok" });
    w.answers.clear();
    const [row] = await w.bridge.enrollments.list(w.root);
    expect(await w.bridge.enrollments.recheck(w.root, row!.id)).toMatchObject({ result: "offline" });
  });

  it("ACP: aceeași adresă cerută de două înrolări e semnalată; vizitatorii nu văd lista", async () => {
    await enroll();
    await enroll({ secret: secretOf(2) });
    const list = await w.bridge.enrollments.list(w.root);
    expect(list.map((r) => r.duplicate)).toEqual([true, true]);
    await expect(w.bridge.enrollments.list(w.member)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("local (excepția operatorului): 127.0.0.1 se interoghează; CS2 cere folderul csgo", async () => {
    answer(LOCAL, 27030, "csgo");
    await enroll({ game: "cs2", port: 27030, plugin: "gcs-cs2/1.1.0" }, LOCAL);
    expect((await w.db.gameServerEnrollment.findFirstOrThrow()).check).toMatchObject({ result: "ok", folder: "csgo" });
  });
});
