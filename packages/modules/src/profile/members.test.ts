import { GcsForbidden } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsMemberList, MEMBERS_PER_PAGE } from "./members";

let w: GcsProfileWorld;
let list: GcsMemberList;

beforeEach(async () => {
  w = await createProfileWorld();
  list = new GcsMemberList({ db: w.db, permissions: w.permissions, ranks: w.ranks });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("lista de membri", () => {
  test("căutarea fără diacritice, filtrul pe grup și sortările", async () => {
    const ion = await w.createUser("Ionuț", "member");
    const iulia = await w.createUser("Iulia", "vip_gold");
    await w.db.user.update({ where: { id: ion.id }, data: { postsCount: 50, reputation: 2 } });
    await w.db.user.update({ where: { id: iulia.id }, data: { postsCount: 10, reputation: 9 } });

    expect((await list.list(w.member, { q: "ionut", page: 1 })).members.map((m) => m.name)).toEqual(["Ionuț"]);
    expect((await list.list(w.member, { q: "IONUȚ", page: 1 })).members.map((m) => m.name)).toEqual(["Ionuț"]);
    expect((await list.list(w.member, { groupId: w.groups.vip_gold!, page: 1 })).members.map((m) => m.name)).toEqual(["Iulia"]);
    // Filtrul pe grup include și membrii care au grupul ca grup secundar.
    await w.createUser("Secundar", "member", ["vip_gold"]);
    expect((await list.list(w.member, { groupId: w.groups.vip_gold!, sort: "name", page: 1 })).members.map((m) => m.name)).toEqual(["Iulia", "Secundar"]);

    const names = async (sort: "posts" | "reputation" | "name" | "joined") =>
      (await list.list(w.member, { q: "i", sort, page: 1 })).members.map((m) => m.name).filter((n) => ["Ionuț", "Iulia"].includes(n));
    expect(await names("posts")).toEqual(["Ionuț", "Iulia"]);
    expect(await names("reputation")).toEqual(["Iulia", "Ionuț"]);
    expect(await names("name")).toEqual(["Ionuț", "Iulia"]);
    expect(await names("joined")).toEqual(["Iulia", "Ionuț"]);
  });

  test("„Doar cei online”: cei activi recent, inclusiv cei fără setare de confidențialitate; cei ascunși nu apar", async () => {
    const now = Date.now();
    const fresh = await w.createUser("Activ", "member");
    const hidden = await w.createUser("Ascuns", "member");
    const away = await w.createUser("Plecat", "member");
    await w.db.user.update({ where: { id: fresh.id }, data: { lastActiveAt: new Date(now - 60_000), privacy: {} } });
    await w.db.user.update({ where: { id: hidden.id }, data: { lastActiveAt: new Date(now - 60_000), privacy: { showOnline: false } } });
    await w.db.user.update({ where: { id: away.id }, data: { lastActiveAt: new Date(now - 60 * 60_000), privacy: {} } });
    const { members, pagination } = await list.list(w.member, { online: true, page: 1 }, now);
    const names = members.map((m) => m.name);
    expect(names).toContain("Activ");
    expect(names).not.toContain("Ascuns");
    expect(names).not.toContain("Plecat");
    expect(members.find((m) => m.name === "Activ")!.online).toBe(true);
    expect(pagination.total).toBe(members.length);
  });

  test("24 pe pagină; a doua pagină are restul", async () => {
    const before = await w.db.user.count();
    for (let i = 0; i < 30; i++) await w.createUser(`Membru${String(i).padStart(2, "0")}`, "member");
    const first = await list.list(w.member, { page: 1 });
    expect(first.members).toHaveLength(MEMBERS_PER_PAGE);
    expect(first.pagination).toMatchObject({ page: 1, total: before + 30, perPage: 24 });
    const last = await list.list(w.member, { page: first.pagination.pages });
    expect(last.members.length).toBe((before + 30) % 24 || 24);
  });

  test("staff-ul e grupat pe grupurile cu acces la moderare sau ACP, în ordinea din ACP", async () => {
    await w.createUser("Admina", "admin");
    await w.createUser("Moderel", "moderator");
    const staff = await list.staff(w.member);
    const keys = staff.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(["admin", "moderator"]));
    expect(keys).not.toContain("member");
    expect(staff.find((g) => g.key === "moderator")!.members.map((m) => m.name)).toContain("Moderel");
    const positions = await w.db.group.findMany({ where: { key: { in: keys } }, select: { key: true, position: true } });
    const pos = new Map(positions.map((p) => [p.key, p.position]));
    expect([...keys].sort((a, b) => pos.get(a)! - pos.get(b)!)).toEqual(keys);
  });

  test("fără `core.members_list` (ex. un banat) → GcsForbidden", async () => {
    const banned = await w.actorFor(await w.createUser("Banat", "banned"));
    await expect(list.list(banned, { page: 1 })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(list.staff(banned)).rejects.toBeInstanceOf(GcsForbidden);
  });
});
