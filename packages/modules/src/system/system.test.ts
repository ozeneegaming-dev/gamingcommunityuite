import { readJobStats, recordJobRun } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { GcsSystemStatusService, STATUS_ALERT_TYPE, STATUS_ALERTS_SETTING, STATUS_CHECK_JOB } from "./status";

let w: GcsRemovalWorld;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
});

/** Serviciul de stare cu discul ales de test (restul dependențelor sunt cele reale). */
function statusWith(disk: { free: number; total: number } | null) {
  const s = w.s;
  return new GcsSystemStatusService({ db: s.db, kv: s.kv, jobs: s.jobs, settings: s.settings, acp: s.acp, notifications: s.notifications, edition: s.edition, disk: async () => disk });
}

const alerts = (userId: string) => w.s.db.notification.findMany({ where: { userId, type: STATUS_ALERT_TYPE } });

describe("Stare sistem", () => {
  test("instantaneul: baza și stocarea cheilor răspund; joburile înregistrate apar cu ultima rulare", async () => {
    await recordJobRun(w.s.kv, "system.heartbeat", { startedAt: Date.now() - 1000, durationMs: 12 });
    await recordJobRun(w.s.kv, "uploads.orphans", { startedAt: Date.now() - 500, durationMs: 40, error: new Error("disc plin") });
    const snap = await statusWith({ free: 50, total: 100 }).snapshot();
    expect(snap.db.ok).toBe(true);
    expect(snap.kv.ok).toBe(true);
    expect(snap.server.disk).toEqual({ free: 50, total: 100 });
    const names = snap.jobs.map((j) => j.name);
    expect(names).toContain(STATUS_CHECK_JOB);
    // Jobul picat e primul în listă.
    expect(snap.jobs[0]).toMatchObject({ name: "uploads.orphans", failing: true, stat: { lastError: "disc plin", runs: 1, failures: 1 } });
    expect(snap.jobs.find((j) => j.name === "system.heartbeat")).toMatchObject({ failing: false, stat: { durationMs: 12 } });
  });

  test("o rulare reușită după una picată: jobul nu mai e „picat”, contoarele rămân", async () => {
    await recordJobRun(w.s.kv, "x.job", { startedAt: 1000, durationMs: 5, error: "nu" });
    await recordJobRun(w.s.kv, "x.job", { startedAt: 2000, durationMs: 7 });
    expect((await readJobStats(w.s.kv))["x.job"]).toMatchObject({ runs: 2, failures: 1, lastError: "nu", lastOkAt: 2007, lastErrorAt: 1005 });
  });

  test("alerte: discul sub prag și un job picat ajung la administratori o singură dată (până la repetare)", async () => {
    const root = await w.user("RootStare", "root_admin");
    const member = await w.user("MembruStare");
    await recordJobRun(w.s.kv, "uploads.orphans", { startedAt: Date.now(), durationMs: 3, error: new Error("eroare") });
    const status = statusWith({ free: 5, total: 100 });

    expect(await status.issues()).toEqual([
      { key: "disk", kind: "disk", freePct: 5 },
      { key: "job:uploads.orphans", kind: "job", job: "uploads.orphans", error: "eroare" },
    ]);
    expect(await status.check()).toBe(2);
    expect((await alerts(root.userId!)).map((n) => n.targetId).sort()).toEqual(["disk", "job:uploads.orphans"]);
    expect(await alerts(member.userId!)).toHaveLength(0);
    // A doua verificare, în fereastra de repetare: nimic nou.
    expect(await status.check()).toBe(0);
  });

  test("setările alertelor: pragul discului, oprirea joburilor și comutatorul general", async () => {
    await recordJobRun(w.s.kv, "uploads.orphans", { startedAt: Date.now(), durationMs: 3, error: new Error("eroare") });
    const status = statusWith({ free: 15, total: 100 });
    await w.s.settings.set(STATUS_ALERTS_SETTING, { enabled: true, disk: true, diskMinFreePct: 20, jobs: false, repeatHours: 6 }, w.system());
    expect(await status.issues()).toEqual([{ key: "disk", kind: "disk", freePct: 15 }]);
    await w.s.settings.set(STATUS_ALERTS_SETTING, { enabled: false, disk: true, diskMinFreePct: 20, jobs: true, repeatHours: 6 }, w.system());
    expect(await status.issues()).toEqual([]);
    await expect(w.s.settings.set(STATUS_ALERTS_SETTING, { enabled: true, disk: true, diskMinFreePct: 90, jobs: true, repeatHours: 6 }, w.system())).rejects.toThrow();
  });

  test("„Rulează acum”: doar joburile repetabile, doar cu dreptul de editare; intră în jurnal", async () => {
    const root = await w.user("RootRun", "root_admin");
    const member = await w.user("MembruRun");
    await w.s.systemStatus.runNow(root, "uploads.orphans");
    expect(await w.s.db.auditLog.count({ where: { action: "system.job_run", targetId: "uploads.orphans" } })).toBe(1);
    await expect(w.s.systemStatus.runNow(root, "bot.welcome")).rejects.toMatchObject({ fields: { job: "unknown_job" } });
    await expect(w.s.systemStatus.runNow(member, "uploads.orphans")).rejects.toThrow();
  });
});

describe("Cache", () => {
  test("zonele numără cheile; golirea unei zone le scoate doar pe ale ei și intră în jurnal", async () => {
    const root = await w.user("RootCache", "root_admin");
    await w.s.cache.set("zonaA:1", { x: 1 }, { ttlSec: 60, tags: ["tagA"] });
    await w.s.cache.set("zonaA:2", { x: 2 }, { ttlSec: 60, tags: ["tagA"] });
    await w.s.cache.set("zonaB", { y: 1 }, { ttlSec: 60, tags: ["tagB"] });
    const before = await w.s.cacheAdmin.overview("redis");
    expect(before.areas.find((a) => a.area === "zonaA")).toEqual({ area: "zonaA", keys: 2 });
    expect(before.areas.find((a) => a.area === "zonaB")).toEqual({ area: "zonaB", keys: 1 });
    expect(before.tags).toEqual(expect.arrayContaining(["tagA", "tagB"]));

    expect(await w.s.cacheAdmin.clearArea(root, "zonaA")).toBe(2);
    expect(await w.s.cache.get("zonaA:1")).toBeNull();
    expect(await w.s.cache.get("zonaB")).toEqual({ y: 1 });

    await w.s.cacheAdmin.clearTag(root, "tagB");
    expect(await w.s.cache.get("zonaB")).toBeNull();

    await w.s.cache.set("zonaC", 1, { ttlSec: 60, tags: [] });
    expect(await w.s.cacheAdmin.clearAll(root)).toBeGreaterThanOrEqual(1);
    expect((await w.s.cacheAdmin.overview("redis")).keys).toBe(0);
    const log = await w.s.cacheAdmin.recentClears();
    expect(log.map((r) => r.target)).toEqual(["*", "tag:tagB", "zonaA"]);
    expect(log[2]).toMatchObject({ removed: 2, actor: { name: "RootCache" } });
  });

  test("un membru fără drept nu golește; o zonă cu caractere ciudate e refuzată", async () => {
    const root = await w.user("RootCache2", "root_admin");
    const member = await w.user("MembruCache");
    await expect(w.s.cacheAdmin.clearAll(member)).rejects.toThrow();
    await expect(w.s.cacheAdmin.clearArea(root, "a*b")).rejects.toMatchObject({ fields: { area: "invalid_area" } });
  });
});

describe("Fișiere", () => {
  async function file(name: string, mime: string, opts: { size?: number; contentType?: string; contentId?: string; ownerId?: string | null } = {}) {
    const key = `test/${name}-${Math.random().toString(36).slice(2)}`;
    await w.s.files.put(key, Buffer.from(name), mime);
    return w.s.db.attachment.create({
      data: { ownerId: opts.ownerId ?? null, storageKey: key, filename: name, mime, size: opts.size ?? name.length, ...(opts.contentType ? { contentType: opts.contentType, contentId: opts.contentId ?? "1" } : {}) },
    });
  }

  test("lista: filtre după tip, zonă, nume și proprietar; totalurile pe tip și cele nelegate", async () => {
    const owner = await w.user("Incarcator");
    await file("Poza-Mare.png", "image/png", { size: 5000, contentType: "forums.post", ownerId: owner.userId });
    await file("demo.zip", "application/zip", { size: 9000 });
    await file("film.mp4", "video/mp4", { size: 100 });
    await file("ciudat.bin", "application/octet-stream", { size: 10, contentType: "chat.file" });

    const all = await w.s.fileAdmin.list({ page: 1 });
    expect(all.total).toBe(4);
    expect((await w.s.fileAdmin.list({ page: 1, kind: "image" })).items.map((f) => f.filename)).toEqual(["Poza-Mare.png"]);
    expect((await w.s.fileAdmin.list({ page: 1, kind: "other" })).items.map((f) => f.filename)).toEqual(["ciudat.bin"]);
    expect((await w.s.fileAdmin.list({ page: 1, area: "none" })).items.map((f) => f.filename).sort()).toEqual(["demo.zip", "film.mp4"]);
    expect((await w.s.fileAdmin.list({ page: 1, q: "poza" })).items.map((f) => f.filename)).toEqual(["Poza-Mare.png"]);
    expect((await w.s.fileAdmin.list({ page: 1, ownerId: owner.userId! })).items[0]).toMatchObject({ filename: "Poza-Mare.png", owner: { name: "Incarcator" } });
    expect((await w.s.fileAdmin.list({ page: 1, sort: "big" })).items[0]!.filename).toBe("demo.zip");

    const o = await w.s.fileAdmin.overview();
    expect(o).toMatchObject({ count: 4, bytes: 14110, unattached: { count: 2, bytes: 9100 } });
    expect(o.kinds.map((k) => k.kind)).toEqual(["image", "video", "archive", "other"]);
    expect(o.areas).toEqual(expect.arrayContaining([{ area: "forums.post", count: 1 }, { area: "chat.file", count: 1 }]));
  });

  test("unde e folosit: legătura, coperta unui membru și o setare", async () => {
    const user = await w.user("CuCoperta");
    const post = await file("post.png", "image/png", { contentType: "forums.post", contentId: "77" });
    const cover = await file("cover.png", "image/png");
    await w.s.db.user.update({ where: { id: user.userId! }, data: { coverAttachmentId: cover.id } });
    const shared = await file("share.png", "image/png");
    await w.s.settings.set("seo.share_image", `/files/${shared.id}`, w.system());
    const loose = await file("liber.png", "image/png");

    const uses = await w.s.fileAdmin.usageMany([post.id, cover.id, shared.id, loose.id]);
    expect(uses.get(post.id)).toEqual([{ kind: "forums.post", id: "77" }]);
    expect(uses.get(cover.id)).toEqual([{ kind: "user.cover", id: user.userId!, label: "CuCoperta" }]);
    expect(uses.get(shared.id)).toEqual([{ kind: "setting", id: "seo.share_image" }]);
    expect(uses.get(loose.id)).toEqual([]);
  });

  test("ștergerea: rândul și fișierul din stocare dispar, și cele legate; jurnal; fără drept → refuz", async () => {
    const root = await w.user("RootFiles", "root_admin");
    const member = await w.user("MembruFiles");
    const a = await file("a.png", "image/png", { contentType: "forums.post" });
    const b = await file("b.txt", "text/plain");
    await expect(w.s.fileAdmin.remove(member, [a.id])).rejects.toThrow();
    expect(await w.s.fileAdmin.remove(root, [a.id, b.id, "lipsa"])).toBe(2);
    expect(await w.s.db.attachment.count()).toBe(0);
    expect(await w.s.files.get(a.storageKey)).toBeNull();
    const audit = await w.s.db.auditLog.findFirstOrThrow({ where: { action: "system.files_delete" } });
    expect(audit.targetId).toBe("2");
  });
});
