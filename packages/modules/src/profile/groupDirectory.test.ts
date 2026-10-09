import { GcsGroupDisplayService, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, type GcsForumWorld } from "../../test/world";
import { byDisplayPriority, GcsGroupDirectory } from "./groupDirectory";

let w: GcsForumWorld;
let display: GcsGroupDisplayService;
let dir: GcsGroupDirectory;
let root: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  display = new GcsGroupDisplayService({ db: w.db, cache: w.cache, bus: w.bus });
  dir = new GcsGroupDirectory({ db: w.db, cache: w.cache, display });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
});

afterAll(async () => {
  await w?.db.$disconnect();
  w?.redis.disconnect();
});

describe("directorul grupurilor (pastile, legendă, pagina membrilor)", () => {
  test("numărătorile: principal + secundar, câți ca secundar, câți online; un grup nou are zero", async () => {
    const now = Date.now();
    const a = await w.createUser("Ana", "vip_gold");
    const b = await w.createUser("Bogdan", "member", ["vip_gold"]);
    await w.createUser("Cezar", "member", ["vip_gold"]);
    await w.db.user.update({ where: { id: a.id }, data: { lastActiveAt: new Date(now - 60_000), privacy: {} } });
    // Activ, dar cu statusul ascuns: nu e numărat online.
    await w.db.user.update({ where: { id: b.id }, data: { lastActiveAt: new Date(now - 60_000), privacy: { showOnline: false } } });
    const fresh = await w.groupService.create({ name: "Grup nou" }, root);

    const counts = await dir.counts(now);
    expect(counts.get(w.groups.vip_gold!)).toEqual({ members: 3, secondary: 2, online: 1, onlineSecondary: 0 });
    // Grupul creat acum în ACP: fără rând în numărători (pastila arată „0 membri · 0 online acum”).
    expect(counts.get(fresh.id)).toBeUndefined();
    expect((await dir.group(fresh.id))?.public).toBe(true);
  });

  test("„doar grupul principal”: numărătorile ignoră membrii cu grupul ca secundar", async () => {
    await w.createUser("Dana", "vip_gold");
    await w.createUser("Emil", "member", ["vip_gold"]);
    await display.setSettings(w.groups.vip_gold!, { primaryOnly: true }, root);
    const counts = await dir.counts();
    expect(counts.get(w.groups.vip_gold!)).toEqual({ members: 1, secondary: 0, online: 0, onlineSecondary: 0 });
    expect((await dir.group(w.groups.vip_gold!))?.primaryOnly).toBe(true);
  });

  test("grupurile unui membru: cel afișat și cele secundare vizibile, după prioritate", async () => {
    const u = await w.createUser("Mihai", "moderator", ["vip_gold", "member"]);
    let mg = (await dir.memberGroups([u.id])).get(u.id)!;
    expect(mg.shown.key).toBe("moderator");
    // VIP (50) înaintea membrilor (10).
    expect(mg.secondary.map((g) => g.key)).toEqual(["vip_gold", "member"]);

    // „Afișează ca grup secundar” oprit: grupul dispare din pastile.
    await display.setSettings(w.groups.member!, { showSecondary: false }, root);
    mg = (await dir.memberGroups([u.id])).get(u.id)!;
    expect(mg.secondary.map((g) => g.key)).toEqual(["vip_gold"]);

    // Membrul alege VIP-ul ca grup afișat: moderatorul (grupul principal) trece printre cele secundare.
    await display.setSettings(w.groups.vip_gold!, { selectable: true }, root);
    await w.groupService.update(w.groups.vip_gold!, { color: "#F4B740" }, root);
    await display.choose(await w.actorFor(u), w.groups.vip_gold!);
    mg = (await dir.memberGroups([u.id])).get(u.id)!;
    expect(mg.shown.key).toBe("vip_gold");
    expect(mg.secondary.map((g) => g.key)).toEqual(["moderator"]);
  });

  test("grupurile ascunse: fără pagină de membri (vizitatorii mereu; celelalte după setare)", async () => {
    const guest = (await dir.groups()).find((g) => g.key === "guest");
    expect(guest?.public).toBe(false);
    await display.setSettings(w.groups.vip_gold!, { public: false, description: "Susținătorii comunității" }, root);
    const vip = await dir.group(w.groups.vip_gold!);
    expect(vip?.public).toBe(false);
    expect(vip?.description).toBe("Susținătorii comunității");
    // Ordinea legendei: prioritatea, apoi poziția din ACP.
    const ordered = [...(await dir.groups())].sort(byDisplayPriority).map((g) => g.key);
    expect(ordered.indexOf("root_admin")).toBeLessThan(ordered.indexOf("moderator"));
    expect(ordered.indexOf("moderator")).toBeLessThan(ordered.indexOf("vip_gold"));
  });
});
