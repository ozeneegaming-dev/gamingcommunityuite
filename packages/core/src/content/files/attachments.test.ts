import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../../test/world";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../../errors";
import type { GcsModule } from "../../modules/registry";
import { GcsRedisRateLimiter } from "../../auth/rateLimit";
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
    rateLimiter: new GcsRedisRateLimiter(world.redis),
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
  world.redis.disconnect();
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
