import { GcsForbidden, GcsValidationError } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createDownloadWorld, doc, type GcsDownloadWorld } from "../../test/downloadWorld";

let w: GcsDownloadWorld;
beforeEach(async () => {
  w = await createDownloadWorld();
});
afterAll(async () => {
  await w.db.$disconnect();
  await w.kv.disconnect();
});

/** Trimite un fișier ZIP în categoria dată; întoarce id-ul fișierului și al versiunii. */
async function submit(actor = w.member, categoryId?: number, bytes = w.zip()) {
  const cat = categoryId ?? (await w.category());
  const assetId = await w.upload(actor, cat, "pack.zip", bytes);
  const r = await w.dl.service.submit(actor, { categoryId: cat, title: "Pachet de hărți", description: doc("Hărți pentru serverul de CS."), version: "1.0", assetIds: [assetId] });
  const file = await w.db.downloadFile.findUniqueOrThrow({ where: { id: r.fileId }, include: { versions: true } });
  return { ...r, category: cat, versionId: file.versions[0]!.id, assetId };
}

describe("trimiterea și verificarea", () => {
  test("un fișier curat ajunge în coada de aprobare; staff-ul îl aprobă și apare în categorie", async () => {
    const s = await submit();
    expect(s.status).toBe("pending");
    const asset = await w.db.downloadAsset.findUniqueOrThrow({ where: { id: s.assetId } });
    expect(asset).toMatchObject({ state: "READY", scanStatus: "CLEAN", kind: "zip" });
    expect(await w.dl.queries.file(w.guest, s.fileId)).toBeNull();
    const queue = await w.dl.admin.queue(w.root);
    expect(queue.rows.map((r) => r.versionId)).toContain(s.versionId);

    await w.dl.service.approve(w.root, s.versionId);
    const file = await w.db.downloadFile.findUniqueOrThrow({ where: { id: s.fileId } });
    expect(file).toMatchObject({ status: "APPROVED", versionId: s.versionId, version: "1.0", filesCount: 1 });
    const cat = await w.db.downloadCategory.findUniqueOrThrow({ where: { id: s.category } });
    expect(cat.filesCount).toBe(1);
    const view = await w.dl.queries.file(w.guest, s.fileId);
    expect(view?.access).toMatchObject({ canDownload: false, denial: "guest" });
  });

  test("fără aprobare în categorie, fișierul curat se publică direct", async () => {
    const cat = await w.category({ approval: false });
    const s = await submit(w.member, cat);
    expect(s.status).toBe("approved");
  });

  test("un fișier infectat e blocat și pus în carantină; autorul și staff-ul sunt anunțați", async () => {
    const s = await submit(w.member, undefined, w.zip("VIRUS inside"));
    expect(s.status).toBe("quarantined");
    const asset = await w.db.downloadAsset.findUniqueOrThrow({ where: { id: s.assetId } });
    expect(asset.scanStatus).toBe("INFECTED");
    expect(asset.storageKey).toMatch(/^downloads\/quarantine\//);
    expect(asset.scanResult).toBe("Test.Virus-1");
    await expect(w.dl.service.approve(w.root, s.versionId)).rejects.toThrow();
    const notes = await w.db.notification.findMany({ where: { type: { in: ["downloads.review", "downloads.infected"] } } });
    expect(notes.map((n) => n.type).sort()).toEqual(expect.arrayContaining(["downloads.infected", "downloads.review"]));
  });

  test("un executabil deghizat (conținut MZ cu extensie .zip) e respins la verificare", async () => {
    const cat = await w.category();
    const assetId = await w.upload(w.member, cat, "pack.zip", Buffer.from("MZ\x90\x00 not a zip", "latin1"));
    const asset = await w.db.downloadAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset).toMatchObject({ state: "FAILED", error: "type_mismatch" });
    await expect(w.dl.service.submit(w.member, { categoryId: cat, title: "Pachet", description: doc("x"), assetIds: [assetId] })).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("extensia nepermisă și mărimea peste limită se refuză încă de la începutul încărcării", async () => {
    const cat = await w.category({ extensions: ["bsp"], maxFileMb: 1 });
    await expect(w.dl.uploads.start(w.member, { categoryId: cat, name: "tool.exe", size: 10 })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.dl.uploads.start(w.member, { categoryId: cat, name: "harta.bsp", size: 2 * 1048576 })).rejects.toBeInstanceOf(GcsValidationError);
    expect((await w.dl.uploads.start(w.member, { categoryId: cat, name: "harta.bsp", size: 100 })).chunkSize).toBeGreaterThan(0);
  });

  test("fără antivirus (ediția Lite) fișierul nu e scanat și rămâne la aprobarea manuală", async () => {
    w = await createDownloadWorld({ edition: "lite" });
    const s = await submit();
    expect(s.status).toBe("pending");
    expect((await w.db.downloadAsset.findUniqueOrThrow({ where: { id: s.assetId } })).scanStatus).toBe("SKIPPED");
    expect(w.av.state.scans).toBe(0);
  });

  test("bucățile se reiau: o bucată repetată se confirmă, una din alt loc e refuzată", async () => {
    const cat = await w.category();
    const bytes = w.zip("abc");
    const started = await w.dl.uploads.start(w.member, { categoryId: cat, name: "pack.zip", size: bytes.length });
    await expect(w.dl.uploads.chunk(w.member, started.id, 0, bytes.subarray(0, 10))).rejects.toBeInstanceOf(GcsValidationError);
    expect(await w.dl.uploads.chunk(w.member, started.id, 0, bytes)).toEqual({ received: bytes.length, complete: true });
    expect(await w.dl.uploads.chunk(w.member, started.id, 0, bytes)).toEqual({ received: bytes.length, complete: true });
    const other = await w.user("Alt");
    await expect(w.dl.uploads.chunk(other, started.id, 0, bytes)).rejects.toThrow();
  });
});

describe("descărcarea", () => {
  async function published(opts: { vip?: boolean } = {}) {
    const cat = await w.category({ approval: false }, { vipOnly: opts.vip ?? false });
    return submit(w.member, cat);
  }

  test("un membru descarcă cu tokenul paginii; fără token (link direct) e refuzat; logul și contoarele cresc", async () => {
    const s = await published();
    const other = await w.user("Cititor");
    const view = await w.dl.queries.file(other, s.fileId);
    const href = view!.current!.assets[0]!.href!;
    const token = new URL(href, "https://x").searchParams.get("t")!;
    await expect(w.dl.service.open(other, s.assetId, null)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.dl.service.open(other, s.assetId, "123.abc")).rejects.toBeInstanceOf(GcsForbidden);
    const opened = await w.dl.service.open(other, s.assetId, token);
    expect(opened.kind).toBe("stream");
    const file = await w.db.downloadFile.findUniqueOrThrow({ where: { id: s.fileId } });
    expect(file.downloads).toBe(1);
    expect(await w.db.downloadLog.count({ where: { fileId: s.fileId, userId: other.userId } })).toBe(1);
  });

  test("vizitatorul vede fișierul dar nu îl descarcă", async () => {
    const s = await published();
    await expect(w.dl.service.open(w.guest, s.assetId, null)).rejects.toBeInstanceOf(GcsForbidden);
    expect((await w.dl.queries.file(w.guest, s.fileId))?.access.denial).toBe("guest");
  });

  test("categoria VIP: membrul obișnuit primește invitația, VIP-ul descarcă", async () => {
    const s = await published({ vip: true });
    const plain = await w.user("Simplu");
    expect((await w.dl.queries.file(plain, s.fileId))?.access.denial).toBe("vip");
    const vip = await w.user("Vip", "vip_gold");
    const view = await w.dl.queries.file(vip, s.fileId);
    expect(view?.access.canDownload).toBe(true);
    const token = new URL(view!.current!.assets[0]!.href!, "https://x").searchParams.get("t")!;
    expect((await w.dl.service.open(vip, s.assetId, token)).kind).toBe("stream");
  });

  test("dreptul de descărcare scos din matricea categoriei → refuzat", async () => {
    const s = await published();
    await w.db.containerPermission.deleteMany({ where: { containerType: "downloads", containerId: String(s.category), action: "downloads.download" } });
    await w.permissions.bumpVersion();
    const other = await w.user("FaraDrept");
    expect((await w.dl.queries.file(other, s.fileId))?.access.denial).toBe("no_permission");
  });
});

describe("versiuni, recenzii, comentarii", () => {
  test("o versiune nouă trece prin aprobare; după publicare devine curentă, iar cea veche rămâne în istoric", async () => {
    const cat = await w.category();
    const first = await submit(w.member, cat);
    await w.dl.service.approve(w.root, first.versionId);
    const assetId = await w.upload(w.member, cat, "pack-v2.zip", w.zip("v2"));
    const v = await w.dl.service.addVersion(w.member, first.fileId, { version: "2.0", changelog: doc("Hărți noi."), assetIds: [assetId] });
    expect(v.status).toBe("pending");
    await w.dl.service.approve(w.root, v.versionId);
    const view = await w.dl.queries.file(w.member, first.fileId);
    expect(view?.current?.label).toBe("2.0");
    expect(view?.history.map((h) => h.label)).toEqual(["1.0"]);
  });

  test("recenzie: nu la propriul fișier; nota medie se recalculează; comentariul cu mențiune notifică", async () => {
    const cat = await w.category({ approval: false });
    const s = await submit(w.member, cat);
    await expect(w.dl.service.review(w.member, s.fileId, { rating: 5, body: doc("Super") })).rejects.toBeInstanceOf(GcsForbidden);
    const a = await w.user("Ana");
    const b = await w.user("Bogdan");
    await w.dl.service.review(a, s.fileId, { rating: 4, body: doc("Bun") });
    await w.dl.service.review(b, s.fileId, { rating: 2, body: doc("Merge") });
    expect((await w.db.downloadFile.findUniqueOrThrow({ where: { id: s.fileId } })).ratingAvg).toBe(3);
    const mention = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: b.userId, label: "Bogdan" } }, { type: "text", text: " uite" }] }] };
    await w.dl.service.comment(a, s.fileId, mention);
    expect(await w.db.notification.count({ where: { type: "downloads.mention", userId: b.userId! } })).toBe(1);
  });
});

describe("categoriile din ACP", () => {
  test("o subcategorie moștenește permisiunile; copierea duplică setările", async () => {
    const parent = await w.category({ approval: false });
    const child = await w.category({}, { parentId: parent });
    const inherit = await w.db.containerInherit.findFirst({ where: { containerType: "downloads", containerId: String(child) } });
    expect(inherit).toMatchObject({ parentId: String(parent), inherits: true });
    const copy = await w.dl.admin.copyCategory(w.root, parent, "Copie");
    const row = await w.db.downloadCategory.findUniqueOrThrow({ where: { id: copy } });
    expect((row.options as { approval: boolean }).approval).toBe(false);
    expect(await w.db.containerPermission.count({ where: { containerType: "downloads", containerId: String(copy) } })).toBeGreaterThan(0);
  });

  test("o categorie cu fișiere nu se șterge fără să aleagă unde merg fișierele", async () => {
    const a = await w.category({ approval: false });
    const b = await w.category();
    const s = await submit(w.member, a);
    await expect(w.dl.admin.deleteCategory(w.root, a, {})).rejects.toThrow();
    await w.dl.admin.deleteCategory(w.root, a, { moveTo: b });
    expect((await w.db.downloadFile.findUniqueOrThrow({ where: { id: s.fileId } })).categoryId).toBe(b);
  });
});

describe("atașamentele din restul site-ului", () => {
  test("cu setarea pornită, un atașament infectat e găsit; oprită sau fără antivirus, nu se scanează", async () => {
    expect(await w.dl.uploads.scanAttachment({ name: "a.zip", bytes: Buffer.from("VIRUS") })).toBe("Test.Virus-1");
    expect(await w.dl.uploads.scanAttachment({ name: "b.png", bytes: Buffer.from("curat") })).toBeNull();
    await w.settings.set("downloads.av_forum_attachments", false, w.root);
    const before = w.av.state.scans;
    expect(await w.dl.uploads.scanAttachment({ name: "a.zip", bytes: Buffer.from("VIRUS") })).toBeNull();
    expect(w.av.state.scans).toBe(before);
  });
});

describe("ștergerea de către vizitatori", () => {
  test("un vizitator nu poate șterge trimiterea nepublicată a unui cont șters (autor gol)", async () => {
    const s = await submit();
    await w.db.downloadFile.update({ where: { id: s.fileId }, data: { authorId: null } });
    await expect(w.dl.service.remove(w.guest, s.fileId)).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.db.downloadFile.count({ where: { id: s.fileId } })).toBe(1);
  });
});

describe("recenzia doar cu stele", () => {
  test("textul e opțional: o notă fără text se salvează", async () => {
    const cat = await w.category({ approval: false });
    const s = await submit(w.member, cat);
    const a = await w.user("Stele");
    await w.dl.service.review(a, s.fileId, { rating: 5, body: "" });
    expect((await w.db.downloadFile.findUniqueOrThrow({ where: { id: s.fileId } })).reviewsCount).toBe(1);
  });
});
