import { GcsGroupDisplayService, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, type GcsForumWorld } from "../../test/world";
import { GcsGroupDirectory } from "../profile/groupDirectory";
import { defaultLegendCategory, GROUPS_PRO_APP, LEGEND_CATEGORY_KEY, validLegendCategories } from "./index";
import { GcsGroupsProService } from "./service";

let w: GcsForumWorld;
let display: GcsGroupDisplayService;
let pro: GcsGroupsProService;
let root: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  display = new GcsGroupDisplayService({ db: w.db, cache: w.cache, bus: w.bus });
  const groups = new GcsGroupDirectory({ db: w.db, cache: w.cache, display });
  pro = new GcsGroupsProService({ db: w.db, cache: w.cache, bus: w.bus, settings: w.settings, groups });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
});

afterAll(async () => {
  await w?.db.$disconnect();
  w?.redis.disconnect();
});

describe("Grupuri Pro: categoriile legendei", () => {
  test("categoria implicită după tipul grupului; vizitatorii și banații nu apar", () => {
    expect(defaultLegendCategory({ key: "root_admin", isVip: false })).toBe("staff");
    expect(defaultLegendCategory({ key: "moderator", isVip: false })).toBe("moderators");
    expect(defaultLegendCategory({ key: "vip_gold", isVip: true })).toBe("vip");
    expect(defaultLegendCategory({ key: "member", isVip: false })).toBe("members");
    expect(defaultLegendCategory({ key: "guest", isVip: false })).toBe("");
    expect(defaultLegendCategory({ key: "banned", isVip: false })).toBe("");
    expect(validLegendCategories([{ key: "staff", label: "" }, { key: "servers", label: "Servere" }])).toBe(true);
    expect(validLegendCategories([{ key: "staff", label: "" }, { key: "staff", label: "x" }])).toBe(false);
    expect(validLegendCategories([])).toBe(false);
    expect(validLegendCategories([{ key: "Bad Key", label: "" }])).toBe(false);
  });

  test("seed-ul: aplicația pornește oprită, grupurile primesc categoria implicită doar dacă nu au una", async () => {
    expect((await w.db.app.findUnique({ where: { key: GROUPS_PRO_APP } }))?.enabled).toBe(false);
    const rows = await w.db.groupSetting.findMany({ where: { key: LEGEND_CATEGORY_KEY }, select: { groupId: true, value: true } });
    const byGroup = new Map(rows.map((r) => [r.groupId, r.value]));
    expect(byGroup.get(w.groups.root_admin!)).toBe("staff");
    expect(byGroup.get(w.groups.moderator!)).toBe("moderators");
    expect(byGroup.get(w.groups.vip_gold!)).toBe("vip");
    expect(byGroup.get(w.groups.guest!)).toBe("");
    // O categorie aleasă din ACP rămâne și după un seed nou (actualizare).
    await pro.setPlace(w.groups.vip_gold!, { category: "staff", parentId: null }, root);
    const { seedDefaults } = await import("@gcs/core");
    await seedDefaults(w.db, w.registry);
    expect((await w.db.groupSetting.findUnique({ where: { groupId_key: { groupId: w.groups.vip_gold!, key: LEGEND_CATEGORY_KEY } } }))?.value).toBe("staff");
  });

  test("legenda: categoriile în ordine, grupurile după prioritate, grupurile legate în dropdown-ul părintelui", async () => {
    await w.db.group.updateMany({ data: { inLegend: true } });
    const fresh = await w.groupService.create({ name: "Administrator servere", inLegend: true }, root);
    await pro.setPlace(fresh.id, { category: "staff", parentId: w.groups.admin! }, root);
    await w.createUser("Ana", "admin");
    await w.createUser("Bogdan", "member", ["admin"]);
    const cezar = await w.createUser("Cezar", "member");
    await w.db.userGroup.create({ data: { userId: cezar.id, groupId: fresh.id } });

    const legend = await pro.legend();
    expect(legend.map((c) => c.key)).toEqual(["staff", "moderators", "vip", "members"]);
    const staff = legend[0]!;
    expect(staff.groups.map((g) => g.key)).toEqual(["root_admin", "admin"]);
    const admin = staff.groups[1]!;
    expect(admin.count).toMatchObject({ members: 2, secondary: 1 });
    expect(admin.children.map((g) => g.name)).toEqual(["Administrator servere"]);
    expect(admin.childMembers).toBe(1);
    // Totalul categoriei: membrii grupurilor de pe rânduri (fără cei din dropdown-uri).
    expect(staff.members).toBe(staff.groups.reduce((s, g) => s + g.count.members, 0));
    // Vizitatorii nu apar.
    expect(legend.flatMap((c) => c.groups.map((g) => g.key))).not.toContain("guest");
    // Un grup creat mai târziu, fără setare: categoria implicită (Membri).
    const later = await w.groupService.create({ name: "Testeri", inLegend: true }, root);
    await w.db.groupSetting.deleteMany({ where: { groupId: later.id } });
    await w.cache.invalidateTags(["name-styles"]);
    expect((await pro.legend()).find((c) => c.key === "members")?.groups.map((g) => g.name)).toContain("Testeri");
  });

  test("locul în legendă: categorie necunoscută, propriul părinte sau un părinte care e el însuși sub altul → eroare", async () => {
    const a = await w.groupService.create({ name: "A" }, root);
    const b = await w.groupService.create({ name: "B" }, root);
    await expect(pro.setPlace(a.id, { category: "nope", parentId: null }, root)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(pro.setPlace(a.id, { category: "members", parentId: a.id }, root)).rejects.toBeInstanceOf(GcsValidationError);
    await pro.setPlace(a.id, { category: "members", parentId: w.groups.member! }, root);
    await expect(pro.setPlace(b.id, { category: "members", parentId: a.id }, root)).rejects.toBeInstanceOf(GcsValidationError);
    // Ascuns din legendă.
    await pro.setPlace(b.id, { category: "", parentId: null }, root);
    expect((await pro.places()).get(b.id)).toEqual({ category: "", parentId: null });
  });

  test("pagina grupurilor: filtrul principal / secundar, căutarea și „doar principal”", async () => {
    await w.createUser("Dana", "vip_gold");
    await w.createUser("Emil", "member", ["vip_gold"]);
    let page = await pro.page({});
    let vip = page.categories.find((c) => c.key === "vip")!.groups.find((g) => g.key === "vip_gold")!;
    expect(vip).toMatchObject({ members: 2, secondary: 1, matched: 2 });
    expect(vip.list.map((m) => [m.name, m.secondary])).toEqual(expect.arrayContaining([["Dana", false], ["Emil", true]]));

    page = await pro.page({ scope: "secondary" });
    vip = page.categories.find((c) => c.key === "vip")!.groups.find((g) => g.key === "vip_gold")!;
    expect(vip.list.map((m) => m.name)).toEqual(["Emil"]);
    expect(vip.members).toBe(1);

    // Căutarea după un membru: doar grupurile lui, doar el în listă.
    page = await pro.page({ q: "emi" });
    const keys = page.categories.flatMap((c) => c.groups.map((g) => g.key));
    expect(keys).toEqual(expect.arrayContaining(["vip_gold", "member"]));
    expect(keys).not.toContain("root_admin");
    // Căutarea după numele grupului: toți membrii lui.
    page = await pro.page({ q: "gold" });
    expect(page.categories.flatMap((c) => c.groups.map((g) => g.key))).toEqual(["vip_gold"]);
    expect(page.categories[0]!.groups[0]!.matched).toBe(2);

    await display.setSettings(w.groups.vip_gold!, { primaryOnly: true }, root);
    page = await pro.page({ category: "vip" });
    vip = page.categories[0]!.groups.find((g) => g.key === "vip_gold")!;
    expect(vip.list.map((m) => m.name)).toEqual(["Dana"]);
    expect(vip).toMatchObject({ members: 1, secondary: 0 });
  });
});
