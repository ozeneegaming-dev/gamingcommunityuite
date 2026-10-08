import { createHash } from "node:crypto";
import dgram from "node:dgram";
import { openSecret } from "@gcs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDemo, startHttpDemoServer, type DemoFiles } from "../../../../test/demoServers";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../../test/bridgeWorld";
import { BRIDGE_SETTING } from "../config";
import type { GcsServerTvInput } from "../tv";

let w: GcsBridgeWorld;
const cleanups: (() => Promise<void>)[] = [];
beforeEach(async () => {
  w = await createBridgeWorld();
});
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

/** `AALLZZhhmm` (UTC) al unui moment: data din numele unui demo HLTV. */
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(2, 12);
const body = async (stream: ReadableStream<Uint8Array>) => Buffer.from(await new Response(stream).arrayBuffer());
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const tvInput = (patch: Partial<GcsServerTvInput> = {}): GcsServerTvInput => ({
  address: "",
  delay: null,
  source: "none",
  host: "",
  port: null,
  username: "",
  remoteDir: "/",
  tlsInsecure: false,
  hostKey: "",
  httpTemplate: "",
  namePrefix: "",
  timeZone: "UTC",
  record: false,
  ...patch,
});

/** Un server mix cu sursa HTTP (un folder local cu fișierele date) și jocul dat. */
async function httpServer(files: DemoFiles, game: "cs16" | "cs2" = "cs16", patch: Partial<GcsServerTvInput> = {}) {
  const srv = await startHttpDemoServer(files);
  cleanups.push(srv.close);
  const { id, token } = await w.bridgeServer({ game, isMix: true });
  await w.bridge.tv.save(w.root, id, tvInput({ source: "http", httpTemplate: `${srv.url}{file}`, ...patch }));
  return { id, token, srv };
}

describe("setările HLTV / GOTV (ACP)", () => {
  it("secretele sigilate: nimic în clar în baza de date sau în jurnal; gol = păstrat; ștergerea", async () => {
    const { id } = await w.bridgeServer({ game: "cs16" });
    await w.bridge.tv.save(w.root, id, tvInput({ address: "217.156.22.86:27020", delay: 90, source: "ftp", host: "ftp.exemplu.ro", username: "hltv", password: "parola-ftp-secreta", remoteDir: "/cstrike", record: true, rconPassword: "parola-rcon-hltv" }));
    const row = await w.db.gameServerTv.findUniqueOrThrow({ where: { serverId: id } });
    expect(JSON.stringify(row)).not.toContain("parola-ftp-secreta");
    expect(JSON.stringify(row)).not.toContain("parola-rcon-hltv");
    expect(openSecret(row.secret!)).toBe("parola-ftp-secreta");
    expect(openSecret(row.rconPassword!)).toBe("parola-rcon-hltv");
    const view = await w.bridge.tv.view(w.root, id);
    expect(view).toMatchObject({ address: "217.156.22.86:27020", delay: 90, source: "ftp", host: "ftp.exemplu.ro", port: 21, username: "hltv", hasPassword: true, hasRconPassword: true, record: true });
    expect(JSON.stringify(view)).not.toContain("parola");
    const audit = await w.db.auditLog.findMany({ where: { action: "servers.tv.update" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("parola-ftp-secreta");
    expect(audit[0]!.after).toMatchObject({ secret: "set", rconPassword: "set", privateKey: "unset" });

    // Gol = păstrat; `clearPassword` fără parolă nouă → câmpul cerut (FTP fără parolă nu se poate).
    await w.bridge.tv.save(w.root, id, tvInput({ address: "217.156.22.86:27020", source: "ftp", host: "ftp.exemplu.ro", username: "hltv", remoteDir: "/cstrike", record: true }));
    expect(openSecret((await w.db.gameServerTv.findUniqueOrThrow({ where: { serverId: id } })).secret!)).toBe("parola-ftp-secreta");
    await expect(w.bridge.tv.save(w.root, id, tvInput({ source: "ftp", host: "ftp.exemplu.ro", username: "hltv", clearPassword: true }))).rejects.toMatchObject({ fields: { password: "required" } });
    // Sursa „fără”: secretele dispar.
    await w.bridge.tv.save(w.root, id, tvInput({ clearRconPassword: true }));
    const off = await w.db.gameServerTv.findUniqueOrThrow({ where: { serverId: id } });
    expect([off.secret, off.rconPassword, off.host]).toEqual([null, null, null]);
  });

  it("validarea: pluginul doar pe CS2 și cu înregistrarea; rcon-ul cere adresa și parola; host, șablon, fus orar", async () => {
    const cs16 = await w.bridgeServer({ game: "cs16" });
    const cs2 = await w.bridgeServer({ game: "cs2" });
    await expect(w.bridge.tv.save(w.root, cs16.id, tvInput({ source: "plugin", record: true }))).rejects.toMatchObject({ fields: { source: "plugin_cs2_only" } });
    await expect(w.bridge.tv.save(w.root, cs2.id, tvInput({ source: "plugin" }))).rejects.toMatchObject({ fields: { record: "plugin_needs_record" } });
    await w.bridge.tv.save(w.root, cs2.id, tvInput({ source: "plugin", record: true, address: "cs2.exemplu.ro:27020" }));
    await expect(w.bridge.tv.save(w.root, cs16.id, tvInput({ record: true }))).rejects.toMatchObject({ fields: { address: "rcon_needs_address", rconPassword: "required" } });
    await expect(w.bridge.tv.save(w.root, cs16.id, tvInput({ address: "localhost:27020", timeZone: "Marte/Olympus", source: "http", httpTemplate: "https://x.ro/demos/" }))).rejects.toMatchObject({
      fields: { address: "invalid_address", timeZone: "invalid_time_zone", httpTemplate: "invalid_template" },
    });
    await expect(w.bridge.tv.save(w.root, cs16.id, tvInput({ source: "sftp", host: "intern", username: "u", password: "p", hostKey: "MD5:xx" }))).rejects.toMatchObject({ fields: { host: "invalid_host", hostKey: "invalid_host_key" } });
    await expect(w.bridge.tv.save(w.root, cs16.id, tvInput({ delay: 4000 }))).rejects.toMatchObject({ fields: { delay: "invalid_range" } });
  });

  it("drepturile: un membru fără ACP nu vede, nu schimbă și nu testează", async () => {
    const { id } = await w.bridgeServer({ game: "cs16" });
    await expect(w.bridge.tv.view(w.member, id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(w.bridge.tv.save(w.member, id, tvInput())).rejects.toMatchObject({ code: "forbidden" });
    await expect(w.bridge.tv.test(w.member, id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(w.bridge.demos.recent(w.member, id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("„Testează conexiunea”: setările salvate, câte demo-uri vede, jurnalul, limita", async () => {
    const files: DemoFiles = new Map([["mix-2610082001-de_mirage.dem", { bytes: fakeDemo("cs16") }]]);
    const { id } = await httpServer(files);
    expect(await w.bridge.tv.test(w.root, id)).toEqual({ ok: true, files: 1, sample: ["mix-2610082001-de_mirage.dem"], hostKey: null });
    expect(await w.db.auditLog.count({ where: { action: "servers.tv.test" } })).toBe(1);
    const other = await w.bridgeServer({ game: "cs16" });
    expect(await w.bridge.tv.test(w.root, other.id)).toEqual({ ok: false, error: "not_configured" });
    for (let i = 0; i < 9; i++) await w.bridge.tv.test(w.root, id);
    await expect(w.bridge.tv.test(w.root, id)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("demo-ul unui meci mix (sursa HTTP)", () => {
  it("la final: rândul în așteptare, jobul programat; aducerea → disponibil, comprimat, descărcat identic, contorul", async () => {
    const demo = fakeDemo("cs16", 200_000);
    const files: DemoFiles = new Map([[`mix-${stamp(w.clock.now - 60_000)}-de_mirage.dem`, { bytes: demo }], [`mix-${stamp(w.clock.now - 3_600_000)}-de_dust2.dem`, { bytes: fakeDemo("cs16", 100) }]]);
    const { id, token } = await httpServer(files, "cs16", { delay: 30 });
    const mock = w.mock(token, "cs16");
    const ctx = await mock.startMix({ map: "de_mirage" });
    expect(await w.db.gameMatchDemo.count()).toBe(0);
    await mock.finishMix(ctx);
    const match = await w.db.gameMatch.findFirstOrThrow({ where: { serverId: id, externalId: ctx.matchId } });
    const waiting = await w.db.gameMatchDemo.findFirstOrThrow({ where: { matchId: match.id } });
    expect(waiting).toMatchObject({ status: "WAITING", part: 1, source: "http" });
    // Întârzierea transmisiei (30 s) + 30 s.
    expect(waiting.nextAttemptAt!.getTime()).toBe(w.clock.now + 60_000);
    expect(w.enqueued).toContainEqual({ name: "servers.demos.fetch", data: { matchId: match.id }, opts: { jobId: `demos-fetch-${match.id}`, delayMs: 60_000 } });
    // Înainte de termen nu se aduce nimic.
    expect(await w.bridge.demos.fetchDue()).toEqual({ fetched: 0, failed: 0 });
    w.clock.now += 61_000;
    expect(await w.bridge.demos.fetchDue()).toEqual({ fetched: 1, failed: 0 });
    const row = await w.db.gameMatchDemo.findFirstOrThrow({ where: { matchId: match.id } });
    expect(row).toMatchObject({ status: "AVAILABLE", encoding: "gzip", size: demo.length, sha256: sha(demo), remoteName: [...files.keys()][0], fileName: `de_mirage-${match.startedAt.toISOString().slice(0, 10)}-m${match.id}.dem` });
    expect(row.storedSize!).toBeLessThan(demo.length * 0.9);
    expect(row.storageKey).toMatch(/^servers\/demos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.dem\.gz$/);
    expect((await w.bridge.tv.view(w.root, id)).lastFetch).toMatchObject({ ok: true, info: { matchId: match.id, files: 2, matched: 1 } });

    const view = await w.bridge.demos.forMatch(w.guest, match.id);
    expect(view).toMatchObject({ canDownload: true, available: true, staff: null, files: [{ id: row.id, part: 1, size: demo.length, downloads: 0, url: `/api/servers/demos/${row.id}` }] });
    const opened = await w.bridge.demos.open(w.guest, row.id, "ip:203.0.113.9");
    expect(opened).toMatchObject({ size: demo.length, fileName: row.fileName });
    expect((await body(opened.body)).equals(demo)).toBe(true);
    expect((await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: row.id } })).downloads).toBe(1);
    // Staff-ul vede stările.
    expect((await w.bridge.demos.forMatch(w.root, match.id)).staff).toMatchObject([{ id: row.id, status: "available", attempts: 0, error: null }]);
  });

  it("fără fișier potrivit: reîncercările (2, 5 … minute), apoi negăsit; ultimul rezultat în ACP", async () => {
    const { id, token } = await httpServer(new Map([["mix-2001010000-de_mirage.dem", { bytes: fakeDemo("cs16") }]]));
    const mock = w.mock(token, "cs16");
    await mock.finishMix(await mock.startMix());
    const minutes = [2, 5, 10, 20, 40, 60, 120];
    w.clock.now += 31_000;
    for (const [i, m] of minutes.entries()) {
      expect(await w.bridge.demos.fetchDue()).toEqual({ fetched: 0, failed: 1 });
      const row = await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } });
      expect(row).toMatchObject({ status: "WAITING", attempts: i + 1, error: "not_found" });
      expect(row.nextAttemptAt!.getTime()).toBe(w.clock.now + m * 60_000);
      w.clock.now += m * 60_000;
    }
    await w.bridge.demos.fetchDue();
    expect(await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } })).toMatchObject({ status: "NOT_FOUND", attempts: 8, nextAttemptAt: null });
    expect((await w.bridge.tv.view(w.root, id)).lastFetch).toMatchObject({ ok: false, code: "not_found", info: { files: 1, matched: 0 } });
  });

  it("demo-urile împărțite: părțile 1 și 2, în ordine, cu numele descărcărilor", async () => {
    const t = w.clock.now;
    const one = fakeDemo("cs16", 3000, 1);
    const two = fakeDemo("cs16", 2000, 2);
    const { token } = await httpServer(new Map([[`tv-${stamp(t + 60_000)}-de_mirage.dem`, { bytes: two }], [`tv-${stamp(t - 120_000)}-de_mirage.dem`, { bytes: one }]]));
    const mock = w.mock(token, "cs16");
    const ctx = await mock.startMix();
    w.clock.now += 5 * 60_000;
    await mock.finishMix(ctx);
    w.clock.now += 31_000;
    await w.bridge.demos.fetchDue();
    const rows = await w.db.gameMatchDemo.findMany({ orderBy: { part: "asc" } });
    expect(rows.map((r) => [r.part, r.status, r.size])).toEqual([
      [1, "AVAILABLE", one.length],
      [2, "AVAILABLE", two.length],
    ]);
    expect(rows.map((r) => r.fileName)).toEqual([expect.stringMatching(/-m\d+-p1\.dem$/), expect.stringMatching(/-m\d+-p2\.dem$/)]);
    const files = (await w.bridge.demos.forMatch(w.guest, rows[0]!.matchId!)).files;
    expect(files.map((f) => f.part)).toEqual([1, 2]);
  });

  it("prea mare sau alt joc (antet greșit) → eșuat, fără reîncercare; fișierul nu ajunge în store", async () => {
    await w.settings.set(BRIDGE_SETTING.demoMaxMb, 10, w.root);
    const big = await httpServer(new Map([[`mix-${stamp(w.clock.now - 60_000)}-de_mirage.dem`, { bytes: fakeDemo("cs16", 11 * 1024 * 1024) }]]));
    const mock = w.mock(big.token, "cs16");
    await mock.finishMix(await mock.startMix());
    const wrong = await httpServer(new Map([[`mix-${stamp(w.clock.now - 60_000)}-de_mirage.dem`, { bytes: fakeDemo("cs2") }]]));
    const mock2 = w.mock(wrong.token, "cs16");
    await mock2.finishMix(await mock2.startMix());
    w.clock.now += 31_000;
    await w.bridge.demos.fetchDue();
    expect(await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: big.id } })).toMatchObject({ status: "FAILED", error: "too_large", attempts: 1, storageKey: null });
    expect(await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: wrong.id } })).toMatchObject({ status: "FAILED", error: "invalid_demo", storageKey: null });
  });

  it("meciul anulat nu are demo; un server fără sursă nu are rânduri", async () => {
    const { token } = await httpServer(new Map());
    const mock = w.mock(token, "cs16");
    await mock.finishMix(await mock.startMix(), { status: "aborted", rounds: 1 });
    const plain = await w.bridgeServer({ game: "cs16", isMix: true });
    const mock2 = w.mock(plain.token, "cs16");
    await mock2.finishMix(await mock2.startMix());
    expect(await w.db.gameMatchDemo.count()).toBe(0);
    expect(w.enqueued.filter((j) => j.name === "servers.demos.fetch")).toEqual([]);
  });
});

describe("descărcarea: drepturile", () => {
  async function available() {
    const { id, token } = await httpServer(new Map([[`mix-${stamp(w.clock.now - 60_000)}-de_mirage.dem`, { bytes: fakeDemo("cs16", 5000) }]]));
    const mock = w.mock(token, "cs16");
    await mock.finishMix(await mock.startMix());
    w.clock.now += 31_000;
    await w.bridge.demos.fetchDue();
    const row = await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id, status: "AVAILABLE" } });
    return { id, row };
  }

  it("implicit oricine vede meciul; banat, fără drept sau serverul ascuns → „nu există”", async () => {
    const { id, row } = await available();
    expect(await w.bridge.demos.canDownload(w.member, id)).toBe(true);
    await expect(w.bridge.demos.open({ ...w.guest, isBanned: true }, row.id, "b")).rejects.toMatchObject({ code: "not_found" });
    await w.db.groupSetting.upsert({
      where: { groupId_key: { groupId: w.groups.guest!, key: "servers.demos_download" } },
      create: { groupId: w.groups.guest!, key: "servers.demos_download", value: false },
      update: { value: false },
    });
    await w.permissions.bumpVersion();
    await expect(w.bridge.demos.open(w.guest, row.id, "g")).rejects.toMatchObject({ code: "not_found" });
    expect(await w.bridge.demos.forMatch(w.guest, row.matchId!)).toMatchObject({ canDownload: false, available: true, files: [] });
    await w.db.gameServer.update({ where: { id }, data: { groups: [w.groups.root_admin!] } });
    await w.cache.invalidateTags(["servers"]);
    await expect(w.bridge.demos.open(w.member, row.id, "m")).rejects.toMatchObject({ code: "not_found" });
    expect((await body((await w.bridge.demos.open(w.root, row.id, "r")).body)).length).toBe(5000);
  });

  it("limita pe viewer: 30 de descărcări în 10 minute", async () => {
    const { row } = await available();
    for (let i = 0; i < 30; i++) await (await w.bridge.demos.open(w.guest, row.id, "ip:1")).body.cancel();
    await expect(w.bridge.demos.open(w.guest, row.id, "ip:1")).rejects.toMatchObject({ code: "rate_limited" });
    await (await w.bridge.demos.open(w.guest, row.id, "ip:2")).body.cancel();
  });

  it("staff: „Caută din nou” (jurnal, jobul) și „Șterge” (fișierul șters, rândul expirat)", async () => {
    const { id, row } = await available();
    await expect(w.bridge.demos.refetch(w.member, row.matchId!)).rejects.toMatchObject({ code: "forbidden" });
    await w.bridge.demos.refetch(w.root, row.matchId!);
    expect(await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "WAITING", attempts: 0, storageKey: row.storageKey });
    expect(w.enqueued.at(-1)).toMatchObject({ name: "servers.demos.fetch", data: { matchId: row.matchId } });
    await w.bridge.demos.fetchDue();
    const again = await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: row.id } });
    expect(again.status).toBe("AVAILABLE");
    expect(again.storageKey).not.toBe(row.storageKey);
    expect(await w.files.get(row.storageKey!)).toBeNull();
    await w.bridge.demos.remove(w.root, row.id);
    expect(await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "EXPIRED", storageKey: null, error: "deleted" });
    expect(await w.files.get(again.storageKey!)).toBeNull();
    expect(await w.db.auditLog.count({ where: { action: { in: ["servers.demo.refetch", "servers.demo.delete"] } } })).toBe(2);
    expect((await w.bridge.demos.recent(w.root, id)).map((r) => r.status)).toEqual(["expired"]);
  });
});

describe("retenția, cota și curățenia", () => {
  it("retenția în zile și cota: cele vechi expiră, fișierele se șterg; rândurile fără meci dispar", async () => {
    const make = async (n: number) => {
      const { id, token } = await httpServer(new Map([[`mix-${stamp(w.clock.now - 60_000)}-de_mirage.dem`, { bytes: fakeDemo("cs16", 4000, n) }]]));
      const mock = w.mock(token, "cs16");
      await mock.finishMix(await mock.startMix());
      w.clock.now += 31_000;
      await w.bridge.demos.fetchDue();
      return { id, row: await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } }) };
    };
    const a = await make(1);
    w.clock.now += 10 * 86_400_000;
    const b = await make(2);
    w.clock.now += 5 * 86_400_000;
    // a are 15 zile (> 14): expiră; b rămâne.
    expect(await w.bridge.demos.cleanup()).toMatchObject({ expired: 1 });
    expect(await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: a.row.id } })).toMatchObject({ status: "EXPIRED", error: "retention", storageKey: null });
    expect(await w.files.get(a.row.storageKey!)).toBeNull();
    expect((await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: b.row.id } })).status).toBe("AVAILABLE");
    // Serverul șters: meciul dispare, rândul rămas fără meci se curăță cu fișierul lui.
    await w.db.gameServer.delete({ where: { id: b.id } });
    expect(await w.bridge.demos.cleanup()).toMatchObject({ orphans: 1 });
    expect(await w.db.gameMatchDemo.count({ where: { id: b.row.id } })).toBe(0);
    expect(await w.files.get(b.row.storageKey!)).toBeNull();
  });

  it("cota: un demo nou scoate cele mai vechi până sub cotă (niciodată pe el)", async () => {
    await w.settings.set(BRIDGE_SETTING.demoQuotaGb, 1, w.root);
    const rows = [];
    for (let i = 0; i < 2; i++) {
      const { token, id } = await httpServer(new Map([[`mix-${stamp(w.clock.now - 60_000)}-de_mirage.dem`, { bytes: fakeDemo("cs16", 3000, i) }]]));
      const mock = w.mock(token, "cs16");
      await mock.finishMix(await mock.startMix());
      w.clock.now += 31_000;
      await w.bridge.demos.fetchDue();
      rows.push(await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } }));
    }
    // Totalul stocat (artificial) peste cotă: următoarea curățenie scoate cel mai vechi.
    await w.db.gameMatchDemo.update({ where: { id: rows[0]!.id }, data: { storedSize: 2 ** 30 } });
    await w.bridge.demos.cleanup();
    expect((await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: rows[0]!.id } })).error).toBe("quota");
    expect((await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: rows[1]!.id } })).status).toBe("AVAILABLE");
  });

  it("un transfer blocat (30 min) revine în așteptare", async () => {
    const { token, id } = await httpServer(new Map());
    const mock = w.mock(token, "cs16");
    await mock.finishMix(await mock.startMix());
    await w.db.gameMatchDemo.updateMany({ data: { status: "FETCHING", updatedAt: new Date(w.clock.now - 31 * 60_000) } });
    expect(await w.bridge.demos.cleanup()).toMatchObject({ stale: 1 });
    expect((await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } })).status).toBe("WAITING");
  });
});

describe("încărcarea pluginului CS2 (§4.3)", () => {
  async function pluginServer() {
    const { id, token } = await w.bridgeServer({ game: "cs2", isMix: true });
    await w.bridge.tv.save(w.root, id, tvInput({ source: "plugin", record: true }));
    return { id, token, mock: w.mock(token, "cs2") };
  }

  it("heartbeat-ul: modulul `demos` și încărcarea pornite doar cu setările; colectorul rămâne implicit", async () => {
    const plain = await w.bridgeServer({ game: "cs2", isMix: true });
    expect((await w.mock(plain.token).heartbeat()).config).toMatchObject({ features: { demos: false, admins: false }, tv: { upload: false, chunkSize: 524_288, rate: 1_048_576 } });
    const { mock } = await pluginServer();
    expect((await mock.heartbeat()).config).toMatchObject({ features: { demos: true }, tv: { upload: true } });
  });

  it("start, bucăți, reluarea după întrerupere, bucata repetată, lipirea → disponibil; din nou → done", async () => {
    const { id, mock } = await pluginServer();
    const ctx = await mock.startMix();
    const demo = fakeDemo("cs2", 1_300_000);
    // În timpul meciului: încă deschis.
    expect(await mock.uploadDemo({ match: ctx.matchId, file: `gcs-${ctx.matchId}.dem`, bytes: demo })).toMatchObject({ status: 409, json: { error: "match_open" } });
    await mock.finishMix(ctx);
    const row = await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } });
    expect(row).toMatchObject({ status: "WAITING", source: "plugin" });
    // Fetch-ul periodic nu atinge rândurile pluginului.
    w.clock.now += 120_000;
    expect(await w.bridge.demos.fetchDue()).toEqual({ fetched: 0, failed: 0 });

    const first = await mock.uploadDemo({ match: ctx.matchId, file: `gcs-${ctx.matchId}.dem`, bytes: demo, stopAfter: 1 });
    expect(first.json).toMatchObject({ interrupted: true, received: 524_288 });
    // O bucată repetată (răspunsul pierdut) se confirmă fără să se scrie din nou; una sărită → offset_mismatch.
    const again = await mock.requestBinary("POST", `/demos/chunk?upload=${row.id}&offset=0`, demo.subarray(0, 524_288));
    expect(again).toMatchObject({ status: 200, json: { received: 524_288 } });
    const skip = await mock.requestBinary("POST", `/demos/chunk?upload=${row.id}&offset=1048576`, demo.subarray(1_048_576));
    expect(skip).toMatchObject({ status: 409, json: { error: "offset_mismatch", received: 524_288 } });
    const short = await mock.requestBinary("POST", `/demos/chunk?upload=${row.id}&offset=524288`, demo.subarray(524_288, 600_000));
    expect(short).toMatchObject({ status: 400, json: { error: "invalid_chunk" } });

    // Reluarea: aceeași mărime și același sha256 → de la `received`.
    const done = await mock.uploadDemo({ match: ctx.matchId, file: `gcs-${ctx.matchId}.dem`, bytes: demo });
    expect(done.json).toMatchObject({ received: demo.length, complete: true });
    expect(w.enqueued.at(-1)).toEqual({ name: "servers.demos.ingest", data: { demoId: row.id }, opts: { jobId: `demos-ingest-${row.id}` } });
    expect(await mock.uploadDemo({ match: ctx.matchId, file: `gcs-${ctx.matchId}.dem`, bytes: demo })).toMatchObject({ status: 200, json: { processing: true } });
    expect(await w.bridge.demos.ingest(row.id)).toBe(true);
    const stored = await w.db.gameMatchDemo.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ status: "AVAILABLE", size: demo.length, sha256: sha(demo), source: "plugin" });
    // Bucățile au dispărut din store.
    expect(await w.files.get(`servers/demo-uploads/${row.id}/000000000000`)).toBeNull();
    expect((await body((await w.bridge.demos.open(w.guest, row.id, "x")).body)).equals(demo)).toBe(true);
    expect(await mock.uploadDemo({ match: ctx.matchId, file: `gcs-${ctx.matchId}.dem`, bytes: demo })).toMatchObject({ status: 200, json: { done: true } });
  });

  it("sha256 greșit la lipire → eșuat (o încărcare nouă începe de la 0); antet greșit → eșuat", async () => {
    const { mock, id } = await pluginServer();
    const ctx = await mock.startMix();
    await mock.finishMix(ctx);
    const demo = fakeDemo("cs2", 600_000);
    const start = await mock.request("POST", "/demos/upload", { match: ctx.matchId, file: "gcs-x.dem", size: demo.length, sha256: "0".repeat(64) });
    await mock.requestBinary("POST", `/demos/chunk?upload=${start.json.upload}&offset=0`, demo.subarray(0, 524_288));
    await mock.requestBinary("POST", `/demos/chunk?upload=${start.json.upload}&offset=524288`, demo.subarray(524_288));
    expect(await w.bridge.demos.ingest(start.json.upload)).toBe(false);
    expect(await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } })).toMatchObject({ status: "FAILED", error: "checksum_mismatch", received: 0 });
    expect(await mock.uploadDemo({ match: ctx.matchId, file: "gcs-x.dem", bytes: fakeDemo("cs16", 600_000) })).toMatchObject({ json: { complete: true } });
    expect(await w.bridge.demos.ingest(start.json.upload)).toBe(false);
    expect(await w.db.gameMatchDemo.findFirstOrThrow({ where: { serverId: id } })).toMatchObject({ status: "FAILED", error: "invalid_demo" });
  });

  it("refuzurile: modulul oprit, alt server, meci necunoscut / anulat, prea mare, date invalide", async () => {
    const plain = await w.bridgeServer({ game: "cs2", isMix: true });
    expect((await w.mock(plain.token).request("POST", "/demos/upload", { match: "m-1", file: "a.dem", size: 10, sha256: "a".repeat(64) })).json).toMatchObject({ error: "demos_disabled" });
    const { mock } = await pluginServer();
    const sha256 = "a".repeat(64);
    expect((await mock.request("POST", "/demos/upload", { match: "m-lipsa", file: "a.dem", size: 10, sha256 })).status).toBe(404);
    const aborted = await mock.startMix();
    await mock.finishMix(aborted, { status: "aborted", rounds: 1 });
    expect(await mock.request("POST", "/demos/upload", { match: aborted.matchId, file: "a.dem", size: 10, sha256 })).toMatchObject({ status: 410, json: { error: "not_wanted" } });
    const ctx = await mock.startMix();
    await mock.finishMix(ctx);
    expect(await mock.request("POST", "/demos/upload", { match: ctx.matchId, file: "a.dem", size: 301 * 1024 * 1024, sha256 })).toMatchObject({ status: 413, json: { error: "too_large" } });
    expect((await mock.request("POST", "/demos/upload", { match: ctx.matchId, file: "../a.dem", size: 10, sha256 })).json).toMatchObject({ error: "invalid_file" });
    expect((await mock.request("POST", "/demos/upload", { match: ctx.matchId, file: "a.dem", size: 10, sha256: "xyz" })).json).toMatchObject({ error: "invalid_sha256" });
    // O bucată de peste 1 MiB nu trece de limita corpului (înainte de autentificare).
    expect((await mock.requestBinary("POST", "/demos/chunk?upload=1&offset=0", Buffer.alloc(1024 * 1024 + 1))).status).toBe(413);
    // Încărcarea altui server nu se poate continua cu cheia acestuia.
    const other = await pluginServer();
    const o = await other.mock.startMix();
    await other.mock.finishMix(o);
    const started = await other.mock.request("POST", "/demos/upload", { match: o.matchId, file: "a.dem", size: 100, sha256 });
    expect((await mock.requestBinary("POST", `/demos/chunk?upload=${started.json.upload}&offset=0`, Buffer.alloc(100))).json).toMatchObject({ error: "unknown_upload" });
  });

  it("încărcarea abandonată (24 h): bucățile șterse, eșuat; demo-ul niciodată încărcat → negăsit", async () => {
    const { mock, id } = await pluginServer();
    const ctx = await mock.startMix();
    await mock.finishMix(ctx);
    const demo = fakeDemo("cs2", 700_000);
    await mock.uploadDemo({ match: ctx.matchId, file: "gcs-a.dem", bytes: demo, stopAfter: 1 });
    const ctx2 = await mock.startMix();
    await mock.finishMix(ctx2);
    const rows = await w.db.gameMatchDemo.findMany({ where: { serverId: id }, orderBy: { id: "asc" } });
    await w.db.gameMatchDemo.updateMany({ data: { updatedAt: new Date(w.clock.now - 25 * 3_600_000) } });
    expect(await w.bridge.demos.cleanup()).toMatchObject({ abandoned: 2 });
    expect((await w.db.gameMatchDemo.findMany({ where: { serverId: id }, orderBy: { id: "asc" } })).map((r) => [r.status, r.error])).toEqual([
      ["FAILED", "upload_abandoned"],
      ["NOT_FOUND", "upload_missing"],
    ]);
    expect(await w.files.get(`servers/demo-uploads/${rows[0]!.id}/000000000000`)).toBeNull();
  });
});

describe("rcon HLTV (CS 1.6, varianta B)", () => {
  /** Un HLTV fals pe UDP: challenge-ul, apoi comanda cu parola. */
  async function fakeHltv(password: string) {
    const seen: string[] = [];
    const udp = dgram.createSocket("udp4");
    udp.on("message", (msg, rinfo) => {
      const text = msg.subarray(4).toString("latin1");
      seen.push(text.replace(password, "***"));
      const reply = (s: string) => udp.send(Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from(s, "latin1")]), rinfo.port, rinfo.address);
      if (text.startsWith("challenge rcon")) return reply("challenge rcon 424242\n");
      const m = /^rcon 424242 "([^"]*)" (.*)\n$/.exec(text);
      reply(m && m[1] === password ? `lOK: ${m[2]}\n` : "lBad rcon_password.\n");
    });
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", () => resolve()));
    cleanups.push(() => new Promise((resolve) => udp.close(() => resolve())));
    return { port: udp.address().port, seen };
  }

  it("la live: `record gcs-m<id>`; la final: `stoprecording` după întârziere + 5 s; doar la adresa configurată", async () => {
    const hltv = await fakeHltv("parola-hltv");
    const { id, token } = await w.bridgeServer({ game: "cs16", isMix: true });
    await w.bridge.tv.save(w.root, id, tvInput({ address: `127.0.0.1:${hltv.port}`, delay: 90, record: true, rconPassword: "parola-hltv" }));
    const mock = w.mock(token, "cs16");
    const ctx = await mock.startMix();
    const match = await w.db.gameMatch.findFirstOrThrow({ where: { serverId: id, externalId: ctx.matchId } });
    expect(w.enqueued).toContainEqual({ name: "servers.tv.rcon", data: { serverId: id, matchId: match.id, action: "record" }, opts: { jobId: `tv-rcon-${match.id}-record` } });
    await mock.finishMix(ctx);
    expect(w.enqueued).toContainEqual({ name: "servers.tv.rcon", data: { serverId: id, matchId: match.id, action: "stop" }, opts: { jobId: `tv-rcon-${match.id}-stop`, delayMs: 95_000 } });
    // Fără sursă de demo-uri: niciun rând (rcon-ul doar înregistrează pe HLTV).
    expect(await w.db.gameMatchDemo.count()).toBe(0);

    expect(await w.bridge.tv.rcon(id, "record", match.id)).toEqual({ ok: true, code: null });
    expect(await w.bridge.tv.rcon(id, "stop", match.id)).toEqual({ ok: true, code: null });
    expect(hltv.seen).toEqual(["challenge rcon\n", `rcon 424242 "***" record gcs-m${match.id}\n`, "challenge rcon\n", 'rcon 424242 "***" stoprecording\n']);
    expect((await w.bridge.tv.view(w.root, id)).lastRcon).toMatchObject({ action: "stop", ok: true, code: null });

    await w.bridge.tv.save(w.root, id, tvInput({ address: `127.0.0.1:${hltv.port}`, record: true, rconPassword: "alta-parola" }));
    expect(await w.bridge.tv.rcon(id, "record", match.id)).toEqual({ ok: false, code: "bad_password" });
    // O adresă privată fără excepție e refuzată de gardă.
    await w.bridge.tv.save(w.root, id, tvInput({ address: "10.0.0.9:27020", record: true }));
    expect(await w.bridge.tv.rcon(id, "record", match.id)).toEqual({ ok: false, code: "blocked" });
  });

  it("CS2 nu folosește rcon-ul HLTV; fără înregistrare pornită nimic", async () => {
    const { id, token } = await w.bridgeServer({ game: "cs16", isMix: true });
    await w.bridge.tv.save(w.root, id, tvInput({ address: "127.0.0.1:27020" }));
    const mock = w.mock(token, "cs16");
    await mock.finishMix(await mock.startMix());
    expect(w.enqueued.filter((j) => j.name === "servers.tv.rcon")).toEqual([]);
    expect(await w.bridge.tv.rcon(id, "record", 1)).toEqual({ ok: false, code: "not_configured" });
  });
});

describe("„Urmărește live”: adresa și întârzierea", () => {
  it("doar serverele cu adresă; CS2: întârzierea raportată de plugin, altfel cea din ACP; transmisia în lista din Redis", async () => {
    const cs2 = await w.bridgeServer({ game: "cs2", isMix: true });
    const cs16 = await w.bridgeServer({ game: "cs16", isMix: true });
    const none = await w.bridgeServer({ game: "cs2", isMix: true });
    await w.bridge.tv.save(w.root, cs2.id, tvInput({ address: "cs2.exemplu.ro:27020", delay: 60 }));
    await w.bridge.tv.save(w.root, cs16.id, tvInput({ address: "217.156.22.86:27020", delay: 90 }));
    let watch = await w.bridge.tv.watch([cs2.id, cs16.id, none.id]);
    expect(Object.fromEntries(watch)).toEqual({ [cs2.id]: { address: "cs2.exemplu.ro:27020", delay: 60 }, [cs16.id]: { address: "217.156.22.86:27020", delay: 90 } });
    await w.mock(cs2.token).heartbeat({ tv: { enabled: true, delay: 105, port: 27020, recording: true } });
    await w.mock(cs16.token, "cs16").heartbeat({ tv: { hltv: 1, delay: 5 } });
    watch = await w.bridge.tv.watch([cs2.id, cs16.id]);
    expect(watch.get(cs2.id)).toEqual({ address: "cs2.exemplu.ro:27020", delay: 105 });
    // CS 1.6: întârzierea din ACP (HLTV-ul e separat de server).
    expect(watch.get(cs16.id)).toEqual({ address: "217.156.22.86:27020", delay: 90 });
    expect((await w.bridge.store.roster(cs2.id))?.tv).toEqual({ enabled: true, delay: 105, port: 27020, recording: true });
    expect((await w.bridge.store.roster(cs16.id))?.tv).toEqual({ hltv: 1, delay: 5 });
  });
});
