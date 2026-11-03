import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { UPLOAD_SETTINGS } from "./settings";

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

const NOW = new Date("2026-11-02T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** Un fișier încărcat (rândul și fișierul din store), cu vârsta și legătura date. */
async function file(name: string, opts: { age: number; contentType?: string; ownerId?: string | null }) {
  const key = `test/${name}-${Math.random().toString(36).slice(2)}.txt`;
  await w.s.files.put(key, Buffer.from(name), "text/plain");
  return w.s.db.attachment.create({
    data: { ownerId: opts.ownerId ?? null, storageKey: key, filename: `${name}.txt`, mime: "text/plain", size: name.length, createdAt: daysAgo(opts.age), ...(opts.contentType ? { contentType: opts.contentType, contentId: "1" } : {}) },
  });
}

const exists = async (id: string) => (await w.s.db.attachment.findUnique({ where: { id } })) !== null;

describe("curățarea fișierelor orfane", () => {
  test("oprită implicit (0 zile): nu se șterge nimic", async () => {
    const old = await file("vechi", { age: 400 });
    expect(await w.s.orphanFiles.run(NOW)).toMatchObject({ deleted: 0, skipped: "disabled" });
    expect(await exists(old.id)).toBe(true);
  });

  test("după N zile: doar fișierele nelegate și nereferite; fișierul dispare și din store", async () => {
    await w.s.settings.set(UPLOAD_SETTINGS.orphanDays, 30, w.system());
    const user = await w.user("Coperta");
    const orphan = await file("orfan", { age: 31 });
    const fresh = await file("recent", { age: 2 });
    const linked = await file("legat", { age: 90, contentType: "forums.post" });
    const cover = await file("cover", { age: 90 });
    await w.s.db.user.update({ where: { id: user.userId! }, data: { coverAttachmentId: cover.id } });
    const shared = await file("distribuire", { age: 90 });
    await w.s.settings.set("seo.share_image", `/files/${shared.id}`, w.system());

    expect(await w.s.orphanFiles.run(NOW)).toEqual({ deleted: 1, kept: 2, bytes: "orfan".length });
    expect(await exists(orphan.id)).toBe(false);
    expect(await w.s.files.get(orphan.storageKey)).toBeNull();
    for (const kept of [fresh, linked, cover, shared]) expect(await exists(kept.id), kept.filename).toBe(true);
  });

  test("pe loturi: mai multe fișiere decât un lot se șterg toate într-o rulare", async () => {
    await w.s.settings.set(UPLOAD_SETTINGS.orphanDays, 7, w.system());
    await w.s.db.attachment.createMany({
      data: Array.from({ length: 450 }, (_, i) => ({ storageKey: `test/lot-${i}.txt`, filename: "lot.txt", mime: "text/plain", size: 1, createdAt: daysAgo(10) })),
    });
    expect((await w.s.orphanFiles.run(NOW)).deleted).toBe(450);
    expect(await w.s.db.attachment.count()).toBe(0);
  });

  test("cât timp un import din altă platformă e în lucru, nu se șterge nimic", async () => {
    await w.s.settings.set(UPLOAD_SETTINGS.orphanDays, 1, w.system());
    const old = await file("import", { age: 5 });
    await w.s.db.importJob.create({ data: { status: "RUNNING" } });
    expect(await w.s.orphanFiles.run(NOW)).toMatchObject({ deleted: 0, skipped: "import_running" });
    expect(await exists(old.id)).toBe(true);
  });
});
