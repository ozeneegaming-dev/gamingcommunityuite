import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../../test/world";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../../errors";
import type { GcsModule } from "../../modules/registry";
import { GcsRateLimiter } from "../../auth/rateLimit";
import type { GcsActor } from "../../permissions/types";
import { GcsAttachmentService } from "./attachments";
import { GcsLocalFileStore } from "./localStore";

/** Un modul de test cu un container „test” pe care membrii pot încărca și descărca. */
const filesModule: GcsModule = {
  key: "files-test",
  settings: [],
  acpMenu: [],
  eventListeners: [],
  permissions: [
    { key: "test.upload", scope: "container", containerType: "test", labelKey: "p", default: {} },
    { key: "test.download", scope: "container", containerType: "test", labelKey: "p", default: {} },
  ],
};

const CONTAINER = { type: "test", id: "1" };
const CTX = { container: CONTAINER, permission: "test.upload" };

let world: GcsTestWorld;
let dir: string;
let service: GcsAttachmentService;
let member: GcsActor;
let other: GcsActor;
let guest: GcsActor;

async function png(width = 32, height = 16, exif = false): Promise<Buffer> {
  let img = sharp({ create: { width, height, channels: 3, background: "#D62839" } }).png();
  if (exif) img = img.withExif({ IFD0: { Copyright: "secret-gps-data", Artist: "Krypt" } });
  return img.toBuffer();
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

beforeEach(async () => {
  world = await createWorld([filesModule]);
  dir = await mkdtemp(path.join(os.tmpdir(), "gcs-files-"));
  service = new GcsAttachmentService({
    db: world.db,
    store: new GcsLocalFileStore(dir),
    permissions: world.permissions,
    rateLimiter: new GcsRateLimiter(world.kv),
  });
  for (const action of ["test.upload", "test.download"]) {
    await world.db.containerPermission.create({
      data: { containerType: "test", containerId: "1", groupId: world.groups.member!, action },
    });
  }
  member = await world.actorFor(await world.createUser("Mara", "member"));
  other = await world.actorFor(await world.createUser("Dexter", "member"));
  guest = { userId: null, groupIds: [world.groups.guest!], primaryGroupId: world.groups.guest!, isBanned: false, ip: "203.0.113.9" };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await world.db.$disconnect();
  world.kv.disconnect();
});

describe("GcsAttachmentService.upload", () => {
  test("o imagine e recodată: dimensiunile rămân, metadatele EXIF dispar", async () => {
    const input = await png(32, 16, true);
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const att = await service.upload(member, { name: "poza.png", bytes: input }, CTX);
    expect(att).toMatchObject({ isImage: true, width: 32, height: 16, mime: "image/png", url: `/files/${att.id}` });

    const stored = await service.open(member, att.id);
    const meta = await sharp(await readAll(stored.body)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(32);
  });

  test("imaginile foarte mari sunt micșorate la maxim 4096 px", async () => {
    const att = await service.upload(member, { name: "mare.png", bytes: await png(5000, 100) }, CTX);
    expect(att.width).toBe(4096);
  });

  test("un fișier HTML cu extensia .png e refuzat (tipul real din magic bytes)", async () => {
    const bytes = Buffer.from("<html><script>alert(1)</script></html>");
    await expect(service.upload(member, { name: "poza.png", bytes }, CTX)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("o imagine cu antet valid, dar date stricate → GcsValidationError (nu eroare de server)", async () => {
    const valid = await png(32, 16);
    const corrupt = Buffer.concat([valid.subarray(0, 40), Buffer.alloc(40, 7)]);
    await expect(service.upload(member, { name: "stricat.png", bytes: corrupt }, CTX)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("configurile text (.cfg) sunt acceptate ca text/plain; binarele fără tip cunoscut nu", async () => {
    const cfg = await service.upload(member, { name: "autoexec.cfg", bytes: Buffer.from("cl_crosshairsize 2.5\n") }, CTX);
    expect(cfg).toMatchObject({ isImage: false, mime: "text/plain" });
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    await expect(service.upload(member, { name: "x.cfg", bytes: bin }, CTX)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("peste upload.max_mb → GcsValidationError", async () => {
    await world.db.groupSetting.updateMany({ where: { groupId: world.groups.member!, key: "upload.max_mb" }, data: { value: 0.00001 } });
    await world.permissions.bumpVersion();
    await expect(service.upload(member, { name: "poza.png", bytes: await png() }, CTX)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("fără permisiunea de upload pe container sau ca vizitator → GcsForbidden", async () => {
    const bytes = await png();
    await expect(service.upload(member, { name: "a.png", bytes }, { ...CTX, container: { type: "test", id: "2" } })).rejects.toBeInstanceOf(
      GcsForbidden,
    );
    await expect(service.upload(guest, { name: "a.png", bytes }, CTX)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("al 31-lea upload într-o oră → GcsRateLimited", async () => {
    const bytes = Buffer.from("x\n");
    for (let i = 0; i < 30; i++) await service.upload(member, { name: "a.txt", bytes }, CTX);
    await expect(service.upload(member, { name: "a.txt", bytes }, CTX)).rejects.toBeInstanceOf(GcsRateLimited);
  });
});

describe("GcsAttachmentService.attach / open", () => {
  test("attach leagă doar atașamentele proprii; ale altcuiva → GcsForbidden", async () => {
    const mine = await service.upload(member, { name: "a.png", bytes: await png() }, CTX);
    const theirs = await service.upload(other, { name: "b.png", bytes: await png() }, CTX);

    await world.db.$transaction((tx) => service.attach(tx, [mine.id], { contentType: "test.item", contentId: "7", ownerId: member.userId! }));
    expect(await world.db.attachment.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({
      contentType: "test.item",
      contentId: "7",
    });

    await expect(
      world.db.$transaction((tx) => service.attach(tx, [theirs.id], { contentType: "test.item", contentId: "7", ownerId: member.userId! })),
    ).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("un atașament nelegat îl poate deschide doar proprietarul", async () => {
    const att = await service.upload(member, { name: "a.png", bytes: await png() }, CTX);
    await expect(service.open(member, att.id)).resolves.toMatchObject({ mime: "image/png", inline: true });
    await expect(service.open(other, att.id)).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("un atașament legat respectă verificarea modulului; fără verificare înregistrată → ascuns", async () => {
    const att = await service.upload(member, { name: "a.png", bytes: await png() }, CTX);
    await world.db.$transaction((tx) => service.attach(tx, [att.id], { contentType: "test.item", contentId: "7", ownerId: member.userId! }));
    await expect(service.open(other, att.id)).rejects.toBeInstanceOf(GcsNotFound);

    service.registerAccess("test.item", async (actor, contentId) => contentId === "7" && actor.userId === other.userId);
    await expect(service.open(other, att.id)).resolves.toMatchObject({ filename: "a.png" });
    await expect(service.open(guest, att.id)).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("fișierele non-imagine se descarcă (nu inline)", async () => {
    const att = await service.upload(member, { name: "autoexec.cfg", bytes: Buffer.from("bind x\n") }, CTX);
    await expect(service.open(member, att.id)).resolves.toMatchObject({ inline: false, mime: "text/plain" });
  });

  test("un id inexistent → GcsNotFound", async () => {
    await expect(service.open(member, "nu-exista")).rejects.toBeInstanceOf(GcsNotFound);
  });
});

describe("GcsAttachmentService.uploadProfileImage", () => {
  async function gif(): Promise<Buffer> {
    const frame = (color: string) => sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
    return sharp([await frame("#FF0000"), await frame("#00FF00")], { join: { animated: true } }).gif().toBuffer();
  }

  test("avatarul e decupat la 512×512 WebP, e public și îl înlocuiește pe cel vechi", async () => {
    const first = await service.uploadProfileImage(member, { name: "a.png", bytes: await png(800, 400) }, { kind: "avatar", maxMb: 2, animated: false });
    expect(first).toMatchObject({ mime: "image/webp", width: 512, height: 512 });
    service.registerAccess("user.avatar", async () => true);
    await expect(service.open(guest, first.id)).resolves.toMatchObject({ inline: true });

    const second = await service.uploadProfileImage(member, { name: "b.png", bytes: await png() }, { kind: "avatar", maxMb: 2, animated: false });
    expect(await world.db.attachment.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await world.db.attachment.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ contentType: "user.avatar", contentId: member.userId });
  });

  test("un GIF animat rămâne animat doar cu `animated: true`; altfel primul cadru", async () => {
    const bytes = await gif();
    const still = await service.uploadProfileImage(member, { name: "c.gif", bytes }, { kind: "cover", maxMb: 2, animated: false });
    const moving = await service.uploadProfileImage(other, { name: "c.gif", bytes }, { kind: "cover", maxMb: 2, animated: true });
    const pages = async (id: string, actor: GcsActor) => (await sharp(await readAll((await service.open(actor, id)).body)).metadata()).pages ?? 1;
    service.registerAccess("user.cover", async () => true);
    expect(await pages(still.id, member)).toBe(1);
    expect(await pages(moving.id, other)).toBe(2);
  });

  test("peste limită → too_large; un fișier care nu e imagine → unsupported_type; vizitator → GcsForbidden", async () => {
    await expect(service.uploadProfileImage(member, { name: "a.png", bytes: await png() }, { kind: "cover", maxMb: 0.00001, animated: false })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.uploadProfileImage(member, { name: "a.txt", bytes: Buffer.from("x\n") }, { kind: "avatar", maxMb: 2, animated: false })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.uploadProfileImage(guest, { name: "a.png", bytes: await png() }, { kind: "avatar", maxMb: 2, animated: false })).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("GcsAttachmentService.uploadSiteImage", () => {
  test("logo-ul devine WebP (max 800×240), favicon-ul PNG 64×64; ambele publice prin tema lor", async () => {
    const logo = await service.uploadSiteImage(member, { name: "logo.png", bytes: await png(1600, 400) }, { kind: "logo", themeKey: "default" });
    expect(logo).toMatchObject({ mime: "image/webp", width: 800, height: 200 });
    const icon = await service.uploadSiteImage(member, { name: "icon.png", bytes: await png(100, 50) }, { kind: "favicon", themeKey: "default" });
    expect(icon).toMatchObject({ mime: "image/png", width: 64, height: 64 });
    expect(await world.db.attachment.findUniqueOrThrow({ where: { id: icon.id } })).toMatchObject({ contentType: "theme.favicon", contentId: "default" });
    service.registerAccess("theme.logo", async () => true);
    await expect(service.open(guest, logo.id)).resolves.toMatchObject({ inline: true });
  });

  test("imaginea antetului (Nova) devine WebP de cel mult 2560×800; poate avea până la 5 MB", async () => {
    const header = await service.uploadSiteImage(member, { name: "hero.png", bytes: await png(3200, 800) }, { kind: "header", themeKey: "nova" });
    expect(header).toMatchObject({ mime: "image/webp", width: 2560, height: 640 });
    expect(await world.db.attachment.findUniqueOrThrow({ where: { id: header.id } })).toMatchObject({ contentType: "theme.header", contentId: "nova" });
    await expect(service.uploadSiteImage(member, { name: "a.png", bytes: Buffer.alloc(6 * 1024 * 1024) }, { kind: "header", themeKey: "nova" })).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("un fișier care nu e imagine sau peste 2 MB e refuzat; vizitatorul → GcsForbidden", async () => {
    await expect(service.uploadSiteImage(member, { name: "a.svg", bytes: Buffer.from("<svg onload=alert(1)/>") }, { kind: "logo", themeKey: "default" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.uploadSiteImage(member, { name: "a.png", bytes: Buffer.alloc(3 * 1024 * 1024) }, { kind: "logo", themeKey: "default" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.uploadSiteImage(guest, { name: "a.png", bytes: await png() }, { kind: "favicon", themeKey: "default" })).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("GcsAttachmentService.importFile (importul din altă platformă)", () => {
  test("aceeași verificare ca un upload: imaginea e recodată (fără EXIF), tipul real decide, fără limitele de grup", async () => {
    const att = await service.importFile(member.userId, { name: "../../vechi.png", bytes: await png(40, 20, true) }, { maxBytes: 10 * 1024 * 1024 });
    expect(att).toMatchObject({ isImage: true, width: 40, height: 20, mime: "image/png", filename: "vechi.png" });
    const row = await world.db.attachment.findUniqueOrThrow({ where: { id: att.id } });
    expect(row).toMatchObject({ ownerId: member.userId, contentType: null });
    expect((await sharp(await readAll((await service.open(member, att.id)).body)).metadata()).exif).toBeUndefined();
  });

  test("un fișier periculos sau peste limită e refuzat", async () => {
    await expect(service.importFile(null, { name: "x.html", bytes: Buffer.from("<script>alert(1)</script>") }, { maxBytes: 1000 })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.importFile(null, { name: "x.png", bytes: await png() }, { maxBytes: 10 })).rejects.toBeInstanceOf(GcsValidationError);
  });
});

describe("GcsAttachmentService.storeDecorImage (Aspect forumuri)", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" onload="alert(1)"><script>alert(2)</script><rect width="20" height="20" fill="#FF6A3D"/></svg>';

  test("PNG și SVG devin WebP de cel mult `maxSide`; publice, legate de țintă", async () => {
    const icon = await service.storeDecorImage(member.userId, { name: "cs2.png", bytes: await png(600, 300) }, { maxBytes: 512 * 1024, maxSide: 256, animated: false, target: "forum:12:icon" });
    expect(icon).toMatchObject({ mime: "image/webp", width: 256, height: 128, filename: "cs2.webp" });
    expect(await world.db.attachment.findUniqueOrThrow({ where: { id: icon.id } })).toMatchObject({ contentType: "decor.image", contentId: "forum:12:icon" });
    const vector = await service.storeDecorImage(member.userId, { name: "logo.svg", bytes: Buffer.from(svg) }, { maxBytes: 512 * 1024, maxSide: 128, animated: false, target: "forum:12:icon" });
    expect(vector).toMatchObject({ mime: "image/webp", width: 128, height: 128 });
    service.registerAccess("decor.image", async () => true);
    await expect(service.open(guest, vector.id)).resolves.toMatchObject({ inline: true, mime: "image/webp" });
  });

  test("peste limită, alt tip de fișier, SVG stricat sau țintă invalidă → refuz", async () => {
    const opts = { maxBytes: 512 * 1024, maxSide: 256, animated: false, target: "forum:1:bg" };
    await expect(service.storeDecorImage(null, { name: "a.png", bytes: await png() }, { ...opts, maxBytes: 10 })).rejects.toMatchObject({ fields: { file: "too_large" } });
    await expect(service.storeDecorImage(null, { name: "a.html", bytes: Buffer.from("<html><script>x</script></html>") }, opts)).rejects.toMatchObject({ fields: { file: "unsupported_type" } });
    await expect(service.storeDecorImage(null, { name: "a.svg", bytes: Buffer.from("<svg><rect/>") }, opts)).rejects.toMatchObject({ fields: { file: "invalid_svg" } });
    await expect(service.storeDecorImage(null, { name: "a.png", bytes: await png() }, { ...opts, target: "../x" })).rejects.toBeInstanceOf(GcsValidationError);
  });
});
