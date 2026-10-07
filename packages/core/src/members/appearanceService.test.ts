import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld } from "../../test/world";
import { GcsRedisRateLimiter } from "../auth/rateLimit";
import { GcsLocalFileStore } from "../content/files/localStore";
import { GcsValidationError } from "../errors";
import { GcsPluginMediaService, PLUGIN_MEDIA_PENDING_MS } from "../plugins/media";
import { testRedis } from "../../test/redis";
import { GcsMemberAppearanceService } from "./appearanceService";

const KEY = "acme.looks";
const OTHER = "acme.other";
const dir = mkdtempSync(path.join(os.tmpdir(), "gcs-plugin-media-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let w: Awaited<ReturnType<typeof createWorld>>;
let service: GcsMemberAppearanceService;
let active: string[];

async function plugin(key: string) {
  await w.db.plugin.create({ data: { key, name: key, version: "1.0.0", enabled: true, capabilities: ["appearance", "media"], manifest: {}, migrations: [] } });
}

beforeEach(async () => {
  w = await createWorld();
  service = new GcsMemberAppearanceService({ db: w.db, cache: w.cache, redis: testRedis(), bus: w.bus });
  active = [KEY, OTHER];
  service.setActiveProvider(() => active);
  await plugin(KEY);
  await plugin(OTHER);
});

const red = { name: { fill: { colors: ["#FF0000"] } } };

describe("aspectul membrilor publicat de pluginuri", () => {
  test("set validează și publică; CSS-ul și versiunea se schimbă", async () => {
    const u = await w.createUser("Ana", "vip_gold");
    const before = await service.version();
    await service.set(KEY, u.id, { ...red, frame: { image: `/plugins/${KEY}/assets/f.png` } });
    expect(await service.version()).toBeGreaterThan(before);
    expect(await service.forUser(u.id)).toEqual({ name: { fill: { colors: ["#FF0000"] } }, frame: { image: `/plugins/${KEY}/assets/f.png` } });
    const css = await service.css();
    expect(css).toContain(`[data-user-id="${u.id}"]`);
    expect(css).toContain("color:#FF0000");
  });

  test("o formă invalidă e refuzată cu câmpurile; un user inexistent → not_found", async () => {
    const u = await w.createUser("Bob", "member");
    await expect(service.set(KEY, u.id, { name: { fill: { colors: ["red"] } } })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.set(KEY, u.id, { frame: { image: `/plugins/${OTHER}/assets/f.png` } })).rejects.toMatchObject({ fields: { "frame.image": "invalid_media" } });
    await expect(service.set(KEY, "nobody123", red)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.set(KEY, "x\"]{}", red)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("ordinea pluginurilor decide fiecare câmp; doar pluginurile active contează", async () => {
    const u = await w.createUser("Cora", "member");
    await service.set(KEY, u.id, red);
    await service.set(OTHER, u.id, { name: { fill: { colors: ["#00FF00"] } }, banner: { fill: { colors: ["#0000FF"] }, label: "VIP" } });
    expect((await service.forUser(u.id))?.name?.fill.colors).toEqual(["#FF0000"]);
    expect((await service.forUser(u.id))?.banner?.label).toBe("VIP");
    active = [OTHER];
    expect((await service.forUser(u.id))?.name?.fill.colors).toEqual(["#00FF00"]);
    active = [];
    expect(await service.forUser(u.id)).toBeNull();
    expect(await service.css()).toBe("");
  });

  test("get întoarce doar rândurile proprii; null șterge; clear golește pluginul", async () => {
    const a = await w.createUser("Dan", "member");
    const b = await w.createUser("Eva", "member");
    await service.set(KEY, a.id, red);
    await service.set(OTHER, b.id, red);
    expect(Object.keys(await service.get(KEY, [a.id, b.id]))).toEqual([a.id]);
    await service.set(KEY, a.id, null);
    expect(await service.get(KEY, [a.id])).toEqual({});
    await service.set(OTHER, a.id, red);
    expect(await service.clear(OTHER)).toBe(2);
    expect(await service.forUsers([a.id, b.id])).toEqual(new Map());
  });
});

describe("fișierele media ale pluginurilor (stocare)", () => {
  const decl = { image: { maxMb: 2, maxSide: 512, animated: false }, quotaMb: 1 };
  const media = () => new GcsPluginMediaService({ db: w.db, store: new GcsLocalFileStore(dir), rateLimiter: new GcsRedisRateLimiter(testRedis()) });
  const png = (size = 64) => sharp({ create: { width: size, height: size, channels: 4, background: { r: 10, g: 200, b: 90, alpha: 1 } } }).png().toBuffer();

  test("încărcarea: în așteptare, păstrată de plugin, servită doar sub cheia lui", async () => {
    const svc = media();
    const u = await w.createUser("Fane", "admin");
    const info = await svc.upload(KEY, decl, { bytes: await png() }, { userId: u.id });
    expect(info).toMatchObject({ kind: "image", mime: "image/webp", status: "pending", width: 64 });
    expect(info.url).toBe(`/plugins/${KEY}/media/${info.id}.webp`);
    expect(await svc.keep(OTHER, [info.id])).toBe(0);
    expect(await svc.keep(KEY, [info.id])).toBe(1);
    expect((await svc.get(KEY, [info.id]))[0]?.status).toBe("kept");
    expect(await svc.open(OTHER, `${info.id}.webp`)).toBeNull();
    expect(await svc.open(KEY, `${info.id}.png`)).toBeNull();
    const opened = await svc.open(KEY, `${info.id}.webp`, (size) => ({ start: 0, end: Math.min(9, size - 1) }));
    expect(opened).toMatchObject({ mime: "image/webp", range: { start: 0, end: 9 } });
    await opened?.body.cancel();
  });

  test("cota pluginului și curățarea fișierelor nepăstrate", async () => {
    const svc = media();
    const first = await svc.upload(KEY, decl, { bytes: await png(512) }, { userId: null });
    const noise = await sharp(Buffer.from(Array.from({ length: 512 * 512 * 3 }, (_, i) => (i * 7919) % 251)), { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
    const results: string[] = [];
    for (let i = 0; i < 12; i++) {
      try {
        await svc.upload(KEY, decl, { bytes: noise }, { userId: null });
        results.push("ok");
      } catch (e) {
        results.push(e instanceof GcsValidationError ? (e.fields.file ?? "") : String(e));
      }
    }
    expect(results).toContain("quota_exceeded");
    // Fișierele nepăstrate, mai vechi de 6 ore, dispar.
    expect(await svc.purgePending(KEY, Date.now() + PLUGIN_MEDIA_PENDING_MS + 1000)).toBeGreaterThan(0);
    expect(await svc.get(KEY, [first.id])).toEqual([]);
    expect(await svc.usage(KEY)).toEqual({ files: 0, bytes: 0 });
  });
});
