import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsMemberDirectory } from "./directory";

let w: GcsTestWorld;
let dir: GcsMemberDirectory;

beforeEach(async () => {
  w = await createWorld();
  dir = new GcsMemberDirectory({ db: w.db });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("GcsMemberDirectory", () => {
  test("listă cu căutare fără diacritice, filtru pe grup și paginare de 25", async () => {
    for (let i = 0; i < 30; i++) await w.createUser(`player${String(i).padStart(2, "0")}`, "member");
    await w.createUser("Ștefan", "vip_gold");

    const page1 = await dir.list({ page: 1 });
    expect(page1.total).toBe(31);
    expect(page1.items).toHaveLength(25);
    expect(page1.pages).toBe(2);
    expect((await dir.list({ page: 2 })).items).toHaveLength(6);

    const search = await dir.list({ q: "ste", page: 1 });
    expect(search.items.map((m) => m.name)).toEqual(["Ștefan"]);

    const vip = await dir.list({ groupId: w.groups.vip_gold!, page: 1 });
    expect(vip.items.map((m) => m.name)).toEqual(["Ștefan"]);
    expect(vip.items[0]).toMatchObject({ primaryGroup: { key: "vip_gold" } });
  });

  test("filtrul pe grup include și grupurile secundare", async () => {
    await w.createUser("Ana", "member", ["vip_silver"]);
    const result = await dir.list({ groupId: w.groups.vip_silver!, page: 1 });
    expect(result.items.map((m) => m.name)).toEqual(["Ana"]);
  });

  test("detaliu: grupuri, bannuri, avertismente, IP-uri și conturile cu același IP", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const target = await w.createUser("Tinta", "member", ["vip_gold"]);
    const twin = await w.createUser("Geaman", "member");
    await w.createUser("Altcineva", "member");
    const future = new Date(Date.now() + 3_600_000);
    await w.db.session.createMany({
      data: [
        { token: "a", userId: target.id, expiresAt: future, ipAddress: "198.51.100.5" },
        { token: "b", userId: twin.id, expiresAt: future, ipAddress: "198.51.100.5" },
      ],
    });
    await w.warnings.warn({ userId: target.id, points: 1, reason: "limbaj" }, root);
    await w.bans.ban({ type: "IP", value: "10.9.9.9", reason: "x" }, root);

    const detail = await dir.detail(target.id);
    expect(detail).toMatchObject({ name: "Tinta", primaryGroup: { key: "member" } });
    expect(detail?.secondaryGroups.map((g) => g.key)).toEqual(["vip_gold"]);
    expect(detail?.warnings).toHaveLength(1);
    expect(detail?.ips).toEqual(["198.51.100.5"]);
    expect(detail?.sharedIpAccounts.map((a) => a.name)).toEqual(["Geaman"]);
  });

  test("detaliu pentru un id inexistent → null", async () => {
    await expect(dir.detail("nu-exista")).resolves.toBeNull();
  });
});
