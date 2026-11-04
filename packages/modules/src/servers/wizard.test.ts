import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createServerWorld, type GcsServerWorld } from "../../test/serverWorld";
import { GcsForumSlotService } from "../forums/slots";
import { GcsServerWizard } from "./wizard";

let w: GcsServerWorld;
let wizard: GcsServerWizard;
let slots: GcsForumSlotService;

beforeEach(async () => {
  w = await createServerWorld();
  slots = new GcsForumSlotService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, apps: w.apps, acp: w.acp });
  wizard = new GcsServerWizard({ db: w.db, acp: w.acp, forums: w.forums, forumSlots: slots, servers: w.servers });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function fieldErrors(p: Promise<unknown>): Promise<Record<string, string>> {
  try {
    await p;
  } catch (error) {
    return (error as { fields?: Record<string, string> }).fields ?? { error: String(error) };
  }
  return {};
}

describe("asistentul „Creează categorie de servere”", () => {
  test("creează categoria, câte un forum legat pe server, subforumurile și tabul „Server”; un server existent doar se leagă", async () => {
    const old = await w.addServer({ name: "Retake" });
    const res = await wizard.create(w.root, {
      name: "Servere CS2",
      description: "Serverele noastre",
      subforums: ["Reclamații", "Cereri admin", "Reclamații"],
      live: { top: false },
      servers: [{ name: "Public 128 tick", game: "cs2", host: "cs2.gcs-servere.ro", port: 27015 }, { existingId: old.id }],
    });
    const cat = await w.db.forum.findUniqueOrThrow({ where: { id: res.categoryId } });
    expect(cat).toMatchObject({ type: "CATEGORY", name: "Servere CS2", parentId: null });
    expect(res.forums).toHaveLength(2);
    for (const f of res.forums) {
      expect((await w.db.gameServer.findUniqueOrThrow({ where: { id: f.serverId } })).forumId).toBe(f.forumId);
      const subs = await w.db.forum.findMany({ where: { parentId: f.forumId }, orderBy: { position: "asc" } });
      expect(subs.map((s) => s.name)).toEqual(["Reclamații", "Cereri admin"]);
      const ext = await w.db.forumExtensionData.findUniqueOrThrow({ where: { forumId_key: { forumId: f.forumId, key: "servers" } } });
      expect(ext.data).toMatchObject({ style: "full", card: true, top: false, connect: true });
    }
    expect((await w.db.forum.findUniqueOrThrow({ where: { id: res.forums[1]!.forumId } })).name).toBe("Retake");
  });

  test("totul se verifică înainte de orice creare: adresă privată, duplicat, nume lipsă → nicio categorie nouă", async () => {
    await w.addServer({ host: "dup.gcs-servere.ro", port: 27015 });
    const before = await w.db.forum.count();
    const errors = await fieldErrors(
      wizard.create(w.root, {
        name: "X",
        description: "",
        subforums: [],
        live: {},
        servers: [
          { name: "", game: "cs2", host: "10.0.0.5", port: 27015 },
          { name: "Dup", game: "cs2", host: "dup.gcs-servere.ro", port: 27015 },
          { name: "D", game: "discord", host: "nu-e-id", port: 443 },
        ],
      }),
    );
    expect(errors).toMatchObject({ "servers.0.name": "required", "servers.0.host": "blocked_address", "servers.1.host": "duplicate_server", "servers.2.host": "invalid_guild" });
    expect(await w.db.forum.count()).toBe(before);
  });

  test("doar cu drepturile pe Forumuri și pe Servere", async () => {
    await expect(wizard.check(w.member, { name: "X", description: "", subforums: [], live: {}, servers: [{ name: "A", game: "cs2", host: "a.gcs-servere.ro", port: 27015 }] })).rejects.toThrow();
  });
});
