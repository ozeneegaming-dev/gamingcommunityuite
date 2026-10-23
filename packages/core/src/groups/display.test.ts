import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { defaultDisplaySettings, GcsGroupDisplayService, hasNameStyle, resolveNameGroup, type GcsDisplayGroupInfo } from "./display";

const info = (list: [number, string, number, boolean, boolean?][]) =>
  new Map<number, GcsDisplayGroupInfo>(
    list.map(([id, key, priority, hasStyle, selectable], position) => [
      id,
      { id, key, name: key, position, hasStyle, settings: { ...defaultDisplaySettings({ key, isVip: false }), priority, selectable: selectable === true } },
    ]),
  );

describe("grupul afișat (rezolvarea, fără bază de date)", () => {
  const groups = info([
    [1, "moderator", 70, true],
    [2, "vip_gold", 50, true, true],
    [3, "member", 10, false],
    [4, "clan_x", 10, true, true],
  ]);

  test("prioritatea cea mai mare dintre grupurile cu stil câștigă (principal Moderator + secundar VIP → Moderator)", () => {
    expect(resolveNameGroup({ primaryId: 1, groupIds: [2] }, groups)).toBe(1);
    // Principal Membru (fără stil) + secundar VIP → VIP.
    expect(resolveNameGroup({ primaryId: 3, groupIds: [2] }, groups)).toBe(2);
    // Niciun grup cu stil → grupul principal.
    expect(resolveNameGroup({ primaryId: 3, groupIds: [] }, groups)).toBe(3);
  });

  test("la egalitate de prioritate câștigă grupul principal", () => {
    const tie = info([
      [5, "a", 20, true],
      [6, "b", 20, true],
    ]);
    expect(resolveNameGroup({ primaryId: 6, groupIds: [5] }, tie)).toBe(6);
    expect(resolveNameGroup({ primaryId: 5, groupIds: [6] }, tie)).toBe(5);
  });

  test("alegerea membrului: doar dintre grupurile lui care permit alegerea", () => {
    expect(resolveNameGroup({ primaryId: 1, groupIds: [2], choiceId: 2 }, groups)).toBe(2);
    // Moderator nu permite alegerea; un grup pe care nu-l are nu contează.
    expect(resolveNameGroup({ primaryId: 3, groupIds: [1, 2], choiceId: 1 }, groups)).toBe(1);
    expect(resolveNameGroup({ primaryId: 3, groupIds: [2], choiceId: 4 }, groups)).toBe(2);
  });

  test("valorile implicite: staff sus, VIP după, ceilalți jos", () => {
    expect(defaultDisplaySettings({ key: "root_admin", isVip: false }).priority).toBe(100);
    expect(defaultDisplaySettings({ key: "moderator", isVip: false }).priority).toBe(70);
    expect(defaultDisplaySettings({ key: "vip_gold", isVip: true }).priority).toBe(50);
    expect(defaultDisplaySettings({ key: "member", isVip: false }).priority).toBe(10);
    expect(defaultDisplaySettings({ key: "member", isVip: false }).showSecondary).toBe(true);
    expect(hasNameStyle({ color: null, nameStyle: null })).toBe(false);
    expect(hasNameStyle({ color: "#FF0000", nameStyle: null })).toBe(true);
    expect(hasNameStyle({ color: null, nameStyle: { gradient: ["#F4B740", "#E8961C"] } })).toBe(true);
  });
});

describe("grupul afișat (pe membri)", () => {
  let w: GcsTestWorld;
  let display: GcsGroupDisplayService;
  let root: GcsActor;

  beforeEach(async () => {
    w = await createWorld();
    display = new GcsGroupDisplayService({ db: w.db, cache: w.cache, bus: w.bus });
    display.listen();
    root = await w.actorFor(await w.createUser("Root", "root_admin"));
  });

  afterAll(async () => {
    await w?.db.$disconnect();
    w?.kv.disconnect();
  });

  test("un grup secundar cu prioritate mai mare devine grupul afișat; scoaterea lui îl readuce pe cel principal", async () => {
    const u = await w.createUser("Dana", "member");
    await w.groupService.update(w.groups.vip_gold!, { nameStyle: { gradient: ["#F4B740", "#E8961C"], animated: true } }, root);
    await w.groupService.addSecondary(u.id, w.groups.vip_gold!, root);
    await expect.poll(async () => (await w.db.user.findUniqueOrThrow({ where: { id: u.id } })).nameGroupId).toBe(w.groups.vip_gold);
    await w.groupService.removeSecondary(u.id, w.groups.vip_gold!, root);
    await expect.poll(async () => (await w.db.user.findUniqueOrThrow({ where: { id: u.id } })).nameGroupId).toBeNull();
  });

  test("alegerea membrului și setările grupului (prioritate, alegere, descriere)", async () => {
    const u = await w.createUser("Mihai", "moderator", ["vip_gold"]);
    await w.groupService.update(w.groups.vip_gold!, { color: "#F4B740" }, root);
    await display.refreshUsers([u.id]);
    // Moderatorul (70) bate VIP-ul (50).
    expect((await w.db.user.findUniqueOrThrow({ where: { id: u.id } })).nameGroupId).toBeNull();
    const actor = await w.actorFor(u);
    await expect(display.choose(actor, w.groups.vip_gold!)).rejects.toBeInstanceOf(GcsValidationError);
    await display.setSettings(w.groups.vip_gold!, { selectable: true, description: "  Membrii   care susțin comunitatea " }, root);
    await display.choose(actor, w.groups.vip_gold!);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: u.id } })).nameGroupId).toBe(w.groups.vip_gold);
    expect((await display.info()).get(w.groups.vip_gold!)?.settings.description).toBe("Membrii care susțin comunitatea");
    // Înapoi la automat; apoi VIP-ul primește o prioritate mai mare decât moderatorul.
    await display.choose(actor, null);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: u.id } })).nameGroupId).toBeNull();
    await display.setSettings(w.groups.vip_gold!, { priority: 95 }, root);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: u.id } })).nameGroupId).toBe(w.groups.vip_gold);
    await expect(display.setSettings(w.groups.vip_gold!, { priority: -1 }, root)).rejects.toBeInstanceOf(GcsValidationError);
  });
});
