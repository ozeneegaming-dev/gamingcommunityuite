import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createServerWorld, onlineStatus, type GcsServerWorld } from "../../test/serverWorld";
import { SERVER_BANNER, type GcsServerInput } from "./service";

let w: GcsServerWorld;

beforeEach(async () => {
  w = await createServerWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const base: GcsServerInput = {
  game: "cs2",
  host: "play.gcs-servere.ro",
  port: 27015,
  queryPort: null,
  name: "Competitive #1",
  description: "",
  forumId: null,
  groups: [],
  adminIds: [],
  enabled: true,
};

/** Câmpurile cu eroare dintr-o validare eșuată. */
async function fieldErrors(p: Promise<unknown>): Promise<Record<string, string>> {
  try {
    await p;
  } catch (error) {
    return (error as { fields?: Record<string, string> }).fields ?? { error: String(error) };
  }
  return {};
}

const png = (color: string) => sharp({ create: { width: 40, height: 20, channels: 3, background: color } }).png().toBuffer();

describe("serverele din ACP", () => {
  test("validarea: jocul, host-ul (nume public sau IP permis), porturile, numele, descrierea, forumul, grupurile, adminii", async () => {
    const tree = await w.createTree();
    const link = await w.forums.create({ parentId: tree.category.id, type: "LINK", name: "Site", linkUrl: "https://example.com" }, w.root);
    expect(
      await fieldErrors(
        w.servers.save(w.root, null, {
          ...base,
          game: "quake",
          host: "localhost",
          port: 0,
          queryPort: 70000,
          name: "  ",
          description: "x".repeat(2001),
          forumId: link.id,
          groups: [999_999],
          adminIds: ["nu-exista"],
        }),
      ),
    ).toEqual({ game: "invalid", host: "invalid_host", port: "invalid_range", queryPort: "invalid_range", name: "required", description: "too_long", forumId: "invalid", groups: "invalid", adminIds: "invalid" });
    // Un IP privat scris direct e refuzat la salvare; 127.0.0.1 trece doar prin excepția operatorului.
    expect(await fieldErrors(w.servers.save(w.root, null, { ...base, host: "10.0.0.5" }))).toEqual({ host: "blocked_address" });
    expect(await fieldErrors(w.servers.save(w.root, null, { ...base, host: "169.254.169.254" }))).toEqual({ host: "blocked_address" });
    expect(await fieldErrors(w.servers.save(w.root, null, { ...base, host: "127.0.0.1" }))).toEqual({});
    const many = Array.from({ length: 21 }, (_, i) => `u${i}`);
    expect(await fieldErrors(w.servers.save(w.root, null, { ...base, port: 27016, adminIds: many }))).toEqual({ adminIds: "too_many" });
  });

  test("adăugarea: slug, poziția la coadă, adminii în ordine, jurnalul; un membru fără drept ACP e refuzat", async () => {
    const tree = await w.createTree();
    const a = await w.servers.save(w.root, null, { ...base, name: "Șoseaua Competitivă #1", description: "Rând 1\r\nRând 2\u0007", forumId: tree.forum.id, adminIds: [w.member.userId!, w.root.userId!] });
    const b = await w.servers.save(w.root, null, { ...base, port: 27016, name: "Al doilea" });
    const edit = await w.servers.get(a.id);
    expect(edit).toMatchObject({ slug: "soseaua-competitiva-1", description: "Rând 1\nRând 2", forumId: tree.forum.id, admins: [{ id: w.member.userId }, { id: w.root.userId }] });
    const rows = await w.db.gameServer.findMany({ orderBy: { position: "asc" }, select: { id: true, position: true } });
    expect(rows).toEqual([
      { id: a.id, position: 0 },
      { id: b.id, position: 1 },
    ]);
    expect(await w.db.auditLog.count({ where: { action: "servers.create" } })).toBe(2);
    await expect(w.servers.save(w.member, null, { ...base, port: 27017 })).rejects.toThrow();
    await expect(w.servers.remove(w.member, a.id)).rejects.toThrow();
  });

  test("același joc, host și port de două ori: `host: duplicate_server`", async () => {
    await w.servers.save(w.root, null, base);
    expect(await fieldErrors(w.servers.save(w.root, null, { ...base, name: "Dublură" }))).toEqual({ host: "duplicate_server" });
  });

  test("schimbarea adresei șterge statusul vechi și programează serverul la runda următoare", async () => {
    const { id } = await w.servers.save(w.root, null, base);
    await w.store.save(id, onlineStatus(), { nextAt: Date.now() + 60_000, failures: 0 });
    await w.servers.save(w.root, id, { ...base, name: "Nume nou" });
    expect(await w.store.get(id)).not.toBeNull();
    await w.servers.save(w.root, id, { ...base, port: 27020 });
    expect(await w.store.get(id)).toBeNull();
    expect((await w.store.schedule()).next.has(id)).toBe(false);
  });

  test("ordinea: doar o permutare a tuturor serverelor; ștergerea ia și istoricul", async () => {
    const a = await w.addServer();
    const b = await w.addServer();
    const c = await w.addServer();
    await w.servers.reorder(w.root, [c.id, a.id, b.id]);
    expect((await w.servers.list()).map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(await fieldErrors(w.servers.reorder(w.root, [a.id, b.id]))).toEqual({ order: "invalid" });
    expect(await fieldErrors(w.servers.reorder(w.root, [a.id, a.id, b.id]))).toEqual({ order: "invalid" });

    await w.db.serverSnapshot.create({ data: { serverId: b.id, online: true, players: 3 } });
    await w.servers.remove(w.root, b.id);
    expect(await w.db.serverSnapshot.count({ where: { serverId: b.id } })).toBe(0);
    expect((await w.servers.list()).map((s) => s.id)).toEqual([c.id, a.id]);
  });

  test("bannerul: o imagine încărcată de admin se leagă de server, cea veche se șterge; vizibilitatea serverului contează", async () => {
    const first = await w.attachments.upload(w.root, { name: "banner.png", bytes: await png("#D62839") }, { permission: "acp.access" });
    const { id } = await w.servers.save(w.root, null, { ...base, bannerId: first.id });
    expect(await w.db.attachment.findUnique({ where: { id: first.id } })).toMatchObject({ contentType: SERVER_BANNER, contentId: String(id) });
    await expect(w.attachments.open(w.guest, first.id)).resolves.toBeTruthy();

    const second = await w.attachments.upload(w.root, { name: "banner2.png", bytes: await png("#3DDC97") }, { permission: "acp.access" });
    await w.servers.save(w.root, id, { ...base, bannerId: second.id });
    expect(await w.db.attachment.findUnique({ where: { id: first.id } })).toBeNull();
    expect((await w.db.gameServer.findUniqueOrThrow({ where: { id } })).bannerId).toBe(second.id);

    // Serverul doar pentru staff: vizitatorul nu mai vede nici bannerul.
    await w.servers.save(w.root, id, { ...base, groups: [w.groups.root_admin!] });
    await expect(w.attachments.open(w.guest, second.id)).rejects.toThrow();
    await expect(w.attachments.open(w.root, second.id)).resolves.toBeTruthy();

    // Atașamentul altcuiva sau un fișier care nu e imagine nu pot deveni banner; `null` scoate bannerul.
    const foreign = await w.attachments.upload(w.member, { name: "x.png", bytes: await png("#000000") }, { permission: "pm.send" }).catch(() => null);
    if (foreign) expect(await fieldErrors(w.servers.save(w.root, id, { ...base, bannerId: foreign.id }))).toEqual({ banner: "invalid_image" });
    await w.servers.save(w.root, id, { ...base, bannerId: null });
    expect(await w.db.attachment.findUnique({ where: { id: second.id } })).toBeNull();
    expect((await w.db.gameServer.findUniqueOrThrow({ where: { id } })).bannerId).toBeNull();
  });

  test("„Testează”: aceleași validări, interogarea falsă, max 10 pe minut", async () => {
    w.answers.set("play.gcs-servere.ro:27015", onlineStatus({ name: "Răspuns", players: 7 }));
    expect(await w.servers.test(w.root, { game: "cs2", host: "Play.GCS-Servere.ro", port: 27015, queryPort: null })).toMatchObject({ online: true, name: "Răspuns", players: 7 });
    expect(await fieldErrors(w.servers.test(w.root, { game: "cs2", host: "192.168.1.1", port: 27015, queryPort: null }))).toEqual({ host: "blocked_address" });
    for (let i = 0; i < 9; i++) await w.servers.test(w.root, { game: "cs2", host: "play.gcs-servere.ro", port: 27015, queryPort: null });
    await expect(w.servers.test(w.root, { game: "cs2", host: "play.gcs-servere.ro", port: 27015, queryPort: null })).rejects.toThrow();
    await expect(w.servers.test(w.member, { game: "cs2", host: "play.gcs-servere.ro", port: 27015, queryPort: null })).rejects.toThrow();
  });
});
