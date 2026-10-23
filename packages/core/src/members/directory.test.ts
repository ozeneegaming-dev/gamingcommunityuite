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
  w.kv.disconnect();
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

describe("GcsMemberDirectory — Membri v2: filtre rapide, căutare avansată, sortare", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const names = async (q: Parameters<GcsMemberDirectory["list"]>[0]) => (await dir.list(q, now)).items.map((m) => m.name);

  test("filtrele rapide: online, noi, nevalidați, banați, spammeri, staff", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const online = await w.createUser("Online", "member");
    await w.db.user.update({ where: { id: online.id }, data: { lastActiveAt: ago(60_000), createdAt: ago(30 * 86_400_000), emailVerified: true } });
    const fresh = await w.createUser("Nou", "member");
    await w.db.user.update({ where: { id: fresh.id }, data: { createdAt: ago(86_400_000), emailVerified: false } });
    const banned = await w.createUser("Banat", "member");
    await w.db.user.update({ where: { id: banned.id }, data: { createdAt: ago(40 * 86_400_000), emailVerified: true } });
    await w.bans.ban({ type: "ACCOUNT", value: banned.id, userId: banned.id, reason: "x" }, root);
    const spammer = await w.createUser("Spam", "member");
    await w.db.user.update({ where: { id: spammer.id }, data: { isSpammer: true, createdAt: ago(40 * 86_400_000), emailVerified: true } });
    // Grupul `admin` are `acp.access` în registry-ul de test.
    await w.createUser("Mod", "member", ["admin"]);
    await w.db.user.updateMany({ where: { name: { in: ["Root", "Mod"] } }, data: { createdAt: ago(90 * 86_400_000), emailVerified: true } });

    expect(await names({ quick: "online", page: 1 })).toEqual(["Online"]);
    expect(await names({ quick: "new", page: 1 })).toEqual(["Nou"]);
    expect(await names({ quick: "unvalidated", page: 1 })).toEqual(["Nou"]);
    expect(await names({ quick: "banned", page: 1 })).toEqual(["Banat"]);
    expect(await names({ quick: "spammers", page: 1 })).toEqual(["Spam"]);
    // Staff = grupurile cu acces la moderare / ACP, ca principal sau secundar.
    expect(await names({ quick: "staff", page: 1 })).toEqual(["Mod", "Root"]);
    const list = await dir.list({ quick: "banned", page: 1 }, now);
    expect(list.items[0]).toMatchObject({ banned: true, secondaryCount: 0 });
  });

  test("căutarea avansată: grup principal / secundar, metoda de login, 2FA, țara, datele, postările, IP-ul", async () => {
    const a = await w.createUser("Ana", "member", ["vip_gold"]);
    const b = await w.createUser("Bogdan", "vip_gold");
    const c = await w.createUser("Cezar", "member");
    await w.db.user.update({ where: { id: a.id }, data: { twoFactorEnabled: true, postsCount: 50, createdAt: new Date("2025-01-10"), lastIp: "203.0.113.7" } });
    await w.db.user.update({ where: { id: b.id }, data: { postsCount: 5, createdAt: new Date("2026-05-01"), lastActiveAt: new Date("2026-10-01") } });
    await w.db.user.update({ where: { id: c.id }, data: { postsCount: 500, createdAt: new Date("2026-09-01"), registrationIp: "10.1.2.3" } });
    await w.db.account.createMany({ data: [{ userId: a.id, accountId: "s1", providerId: "steam" }, { userId: b.id, accountId: b.id, providerId: "credential" }] });
    await w.db.userDevice.create({ data: { userId: c.id, key: "k", browser: "Firefox", os: "Linux", method: "password", location: "DE" } });

    const gold = w.groups.vip_gold!;
    expect(await names({ groupId: gold, page: 1 })).toEqual(["Ana", "Bogdan"]);
    expect(await names({ groupId: gold, groupScope: "primary", page: 1 })).toEqual(["Bogdan"]);
    expect(await names({ groupId: gold, groupScope: "secondary", page: 1 })).toEqual(["Ana"]);
    expect(await names({ loginMethod: "steam", page: 1 })).toEqual(["Ana"]);
    expect(await names({ twoFactor: true, page: 1 })).toEqual(["Ana"]);
    expect(await names({ twoFactor: false, page: 1 })).toEqual(["Bogdan", "Cezar"]);
    expect(await names({ country: "de", page: 1 })).toEqual(["Cezar"]);
    expect(await names({ joinedFrom: new Date("2026-01-01"), joinedTo: new Date("2026-06-01"), page: 1 })).toEqual(["Bogdan"]);
    expect(await names({ activeFrom: new Date("2026-09-15"), page: 1 })).toEqual(["Bogdan"]);
    expect(await names({ postsMin: 10, postsMax: 100, page: 1 })).toEqual(["Ana"]);
    expect(await names({ ip: "203.0.113", page: 1 })).toEqual(["Ana"]);
    expect(await names({ ip: "10.1.2", page: 1 })).toEqual(["Cezar"]);
    // Criteriile se combină.
    expect(await names({ groupId: gold, postsMin: 10, page: 1 })).toEqual(["Ana"]);
    expect((await dir.list({ ip: "203.0.113", page: 1 }, now)).items[0]).toMatchObject({ ip: "203.0.113.7", secondaryCount: 1 });
  });

  test("sortarea pe coloane (nume, grup, înscriere, ultima vizită, postări, IP) în ambele direcții", async () => {
    const a = await w.createUser("Ana", "vip_gold");
    const b = await w.createUser("Bogdan", "member");
    const c = await w.createUser("Cezar", "admin");
    await w.db.user.update({ where: { id: a.id }, data: { postsCount: 3, createdAt: new Date("2026-01-01"), lastActiveAt: new Date("2026-10-10"), lastIp: "10.0.0.3" } });
    await w.db.user.update({ where: { id: b.id }, data: { postsCount: 9, createdAt: new Date("2026-03-01"), lastActiveAt: null, lastIp: "10.0.0.1" } });
    await w.db.user.update({ where: { id: c.id }, data: { postsCount: 1, createdAt: new Date("2026-02-01"), lastActiveAt: new Date("2026-10-12") } });

    expect(await names({ sort: "name", page: 1 })).toEqual(["Ana", "Bogdan", "Cezar"]);
    expect(await names({ sort: "name", dir: "desc", page: 1 })).toEqual(["Cezar", "Bogdan", "Ana"]);
    expect(await names({ sort: "posts", page: 1 })).toEqual(["Bogdan", "Ana", "Cezar"]);
    expect(await names({ sort: "joined", page: 1 })).toEqual(["Bogdan", "Cezar", "Ana"]);
    expect(await names({ sort: "joined", dir: "asc", page: 1 })).toEqual(["Ana", "Cezar", "Bogdan"]);
    // Fără vizită: la coadă.
    expect(await names({ sort: "lastActive", page: 1 })).toEqual(["Cezar", "Ana", "Bogdan"]);
    expect(await names({ sort: "ip", page: 1 })).toEqual(["Bogdan", "Ana", "Cezar"]);
    // Grupul principal, după poziția din ACP (Admin înaintea VIP, apoi Membru).
    const positions = await w.db.group.findMany({ where: { key: { in: ["admin", "vip_gold", "member"] } }, orderBy: { position: "asc" }, select: { key: true } });
    const byGroup = await names({ sort: "group", page: 1 });
    expect(byGroup).toEqual(positions.map((g) => ({ admin: "Cezar", vip_gold: "Ana", member: "Bogdan" })[g.key]!));
  });

  test("ids(): toți membrii filtrați, pentru acțiunile în masă; detaliul arată sursa și expirarea secundarelor", async () => {
    const a = await w.createUser("Ana", "member");
    await w.createUser("Bogdan", "member");
    const until = new Date("2026-11-15T00:00:00Z");
    await w.db.userGroup.create({ data: { userId: a.id, groupId: w.groups.vip_gold!, source: "store", expiresAt: until } });
    expect((await dir.ids({ groupId: w.groups.vip_gold! })).length).toBe(1);
    expect(await dir.ids({})).toHaveLength(2);
    const detail = await dir.detail(a.id);
    expect(detail?.secondaryGroups).toEqual([expect.objectContaining({ key: "vip_gold", source: "store", expiresAt: until })]);
    expect(detail).toMatchObject({ loginMethods: [], twoFactorLocked: false, isSpammer: false });
  });
});
