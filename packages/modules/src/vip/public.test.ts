import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsVipPublic, VIP_CONTACT_SETTING } from "./public";

let w: GcsProfileWorld;
let page: GcsVipPublic;

beforeEach(async () => {
  w = await createProfileWorld();
  page = new GcsVipPublic({ db: w.db, registry: w.registry, permissions: w.permissions, settings: w.settings, vip: w.vip });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("pagina VIP", () => {
  test("planurile sunt grupurile VIP, în ordinea din ACP, cu beneficiile calculate față de un membru", async () => {
    const plans = await page.plans(w.guest);
    expect(plans.map((p) => p.key)).toEqual(["vip_bronze", "vip_silver", "vip_gold", "vip_legend"]);
    const gold = plans.find((p) => p.key === "vip_gold")!;
    expect(gold).toMatchObject({ name: "VIP Gold", color: "#F4B740", icon: "fa-solid fa-crown", action: { kind: "contact", href: "/staff" } });
    const benefits = Object.fromEntries(gold.benefits.map((b) => [b.key, b.value]));
    // Drepturi pe care un membru nu le are și limite mai bune (mai mult; la pauze, mai puțin).
    expect(benefits).toMatchObject({ "profile.styled_name": true, "profile.animated_cover": true, "pm.max_conversations": 250, "pm.flood_seconds": 10, "upload.max_mb": 50 });
    // Ce are și un membru nu e beneficiu.
    expect(benefits).not.toHaveProperty("core.translate");
    expect(benefits).not.toHaveProperty("core.members_list");
    expect(plans.find((p) => p.key === "vip_legend")!.benefits.find((b) => b.key === "pm.max_conversations")?.value).toBe(-1);
    expect(plans.find((p) => p.key === "vip_bronze")!.benefits.map((b) => b.key)).not.toContain("profile.animated_cover");
  });

  test("forumurile în plus apar doar dacă viewer-ul le poate vedea; cosmeticele exclusive sunt numărate", async () => {
    const tree = await w.createTree();
    const lounge = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "VIP Lounge" }, w.root);
    const matrix: Record<number, string[]> = { [w.groups.vip_gold!]: ["forums.view", "forums.read"], [w.groups.root_admin!]: ["forums.view", "forums.read"] };
    await w.groupService.setContainerInherit("forum", String(lounge.id), { inherits: false, parentId: null }, w.root);
    await w.groupService.setContainerPermissions("forum", String(lounge.id), matrix, w.root);
    await w.db.nameStyle.create({ data: { key: "ns_gold_only", name: "Aur", style: { color: "#F4B740" }, groupIds: [w.groups.vip_gold!] } });

    const forGuest = (await page.plans(w.guest)).find((p) => p.key === "vip_gold")!;
    expect(forGuest.forums).toEqual([]);
    const forRoot = (await page.plans(w.root)).find((p) => p.key === "vip_gold")!;
    expect(forRoot.forums).toEqual([{ id: lounge.id, name: "VIP Lounge", slug: lounge.slug }]);
    expect(forRoot.nameStyles).toBeGreaterThanOrEqual(1);
    expect((await page.plans(w.root)).find((p) => p.key === "vip_bronze")!.forums).toEqual([]);
  });

  test("butonul: linkul din ACP (sigur) sau checkout-ul, când există magazinul", async () => {
    await w.settings.set(VIP_CONTACT_SETTING, "/messages/new?to=staff", w.root);
    expect((await page.plans(w.member))[0]!.action).toEqual({ kind: "contact", href: "/messages/new?to=staff" });
    await expect(w.settings.set(VIP_CONTACT_SETTING, "javascript:alert(1)", w.root)).rejects.toThrow();

    const shop = new GcsVipPublic({ db: w.db, registry: w.registry, permissions: w.permissions, settings: w.settings, vip: w.vip, checkout: async (plan) => `/store/vip/${plan.key}` });
    expect((await shop.plans(w.member))[0]!.action).toEqual({ kind: "checkout", href: "/store/vip/vip_bronze" });
  });

  test("planul viewer-ului și expirarea; vizitatorii și membrii fără VIP nu au plan", async () => {
    expect(await page.mine(w.guest)).toBeNull();
    expect(await page.mine(w.member)).toBeNull();
    await w.vip.grant(w.root, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: 30 });
    const mine = await page.mine(w.member);
    expect(mine).toMatchObject({ key: "vip_gold", name: "VIP Gold" });
    const days = (Date.parse(mine!.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });
});
