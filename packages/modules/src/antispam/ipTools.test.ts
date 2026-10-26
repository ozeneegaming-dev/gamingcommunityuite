import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";
import { GcsIpToolsService, IP_RETENTION_SETTING, IP_TOOLS_ACP_SECTION } from "./ipTools";

let w: GcsForumWorld;
let ip: GcsIpToolsService;

beforeEach(async () => {
  w = await createForumWorld();
  ip = new GcsIpToolsService({ db: w.db, acp: w.acp, bans: w.bans, bus: w.bus, settings: w.settings });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const device = (userId: string, address: string, lastSeenAt = new Date()) =>
  w.db.userDevice.create({ data: { userId, key: `${userId}-${address}`, browser: "Chrome", os: "Linux", method: "email", ip: address, lastSeenAt } });

describe("căutarea după IP și după membru", () => {
  test("conturile (cu sursele), postările, numărătorile, banul pe IP; prefixul cu *; IP invalid → validare", async () => {
    const forumId = (await w.createTree()).forum.id;
    const a = await w.createUser("Alfa", "member");
    const b = await w.createUser("Beta", "member");
    await w.db.user.update({ where: { id: a.id }, data: { registrationIp: "203.0.113.5" } });
    await w.db.user.update({ where: { id: b.id }, data: { lastIp: "203.0.113.5", lastActiveAt: new Date() } });
    await device(b.id, "203.0.113.5");
    const t = await w.topics.create(await w.actorFor(a), { forumId, title: "Salut de pe IP", content: doc("text") });
    await w.db.post.update({ where: { id: t.postId }, data: { ip: "203.0.113.5" } });
    await w.bans.ban({ type: "IP", value: "203.0.113.5", reason: "proxy" }, w.root);

    const res = await ip.lookupIp(w.root, " 203.0.113.5 ");
    expect(res.query).toBe("203.0.113.5");
    expect(res.accounts.map((x) => [x.name, [...x.sources].sort()])).toEqual(
      expect.arrayContaining([
        ["Alfa", ["post", "registration"]],
        ["Beta", ["device", "last"]],
      ]),
    );
    expect(res.counts).toEqual({ posts: 1, pms: 0, statuses: 0, sessions: 0 });
    expect(res.posts).toMatchObject([{ id: t.postId, title: "Salut de pe IP", authorName: "Alfa" }]);
    expect(res.ban).toMatchObject({ reason: "proxy" });
    expect((await ip.lookupIp(w.root, "203.0.113.*")).accounts).toHaveLength(2);
    await expect(ip.lookupIp(w.root, "nu-e-ip")).rejects.toMatchObject({ fields: { ip: "invalid_ip" } });
    await expect(ip.lookupIp(w.member, "203.0.113.5")).rejects.toThrow();

    const mine = await ip.memberIps(w.root, b.id);
    expect(mine).toMatchObject([{ ip: "203.0.113.5", others: 1 }]);
    expect([...mine[0]!.sources].sort()).toEqual(["device", "last"]);
  });

  test("IP-urile comune: conturile de pe același IP, cele cu ban primele", async () => {
    const [a, b, c, d] = await Promise.all(["Unu", "Doi", "Trei", "Patru"].map((n) => w.createUser(n, "member")));
    await device(a!.id, "198.51.100.10");
    await device(b!.id, "198.51.100.10");
    await device(c!.id, "198.51.100.20");
    await device(d!.id, "198.51.100.20");
    await device(d!.id, "198.51.100.99", new Date(Date.now() - 60 * 86_400_000));
    await w.bans.ban({ type: "ACCOUNT", value: c!.id, userId: c!.id, reason: "spam" }, w.root);
    const shared = await ip.sharedIps(w.root);
    expect(shared.map((s) => s.ip)).toEqual(["198.51.100.20", "198.51.100.10"]);
    expect(shared[0]!.users.find((u) => u.name === "Trei")).toMatchObject({ banned: true });
  });
});

describe("alerta de multi-cont și păstrarea IP-urilor", () => {
  test("un cont nou cu IP-ul altui cont emite alerta (cu banatele)", async () => {
    const seen: unknown[] = [];
    w.bus.on("antispam.multi_account", async (e) => void seen.push(e.payload));
    const old = await w.createUser("Vechi", "member");
    await w.db.user.update({ where: { id: old.id }, data: { registrationIp: "192.0.2.44" } });
    await w.bans.ban({ type: "ACCOUNT", value: old.id, userId: old.id, reason: "spam" }, w.root);
    const fresh = await w.createUser("Nou", "member");
    await w.db.user.update({ where: { id: fresh.id }, data: { registrationIp: "192.0.2.44" } });
    await expect(ip.checkNewAccount(fresh.id)).resolves.toEqual([old.id]);
    expect(seen).toEqual([{ userId: fresh.id, ip: "192.0.2.44", others: [old.id], banned: [old.id] }]);
    const alone = await w.createUser("Singur", "member");
    await w.db.user.update({ where: { id: alone.id }, data: { registrationIp: "192.0.2.45" } });
    await expect(ip.checkNewAccount(alone.id)).resolves.toEqual([]);
  });

  test("staff-ul alertelor: Root Admin și rolurile cu drept pe Unelte IP", async () => {
    const mod = await w.createUser("Moderator", "moderator");
    expect(await w.acp.usersWith(IP_TOOLS_ACP_SECTION)).toEqual([w.root.userId]);
    const role = await w.acp.createRole("Unelte IP", w.root);
    await w.acp.setRolePermissions(role.id, { [IP_TOOLS_ACP_SECTION]: { view: true, edit: false, delete: false } }, w.root);
    await w.acp.assignRole(role.id, { groupId: mod.primaryGroupId }, w.root);
    expect((await w.acp.usersWith(IP_TOOLS_ACP_SECTION)).sort()).toEqual([w.root.userId, mod.id].sort());
    expect(await w.acp.usersWith(IP_TOOLS_ACP_SECTION, "edit")).toEqual([w.root.userId]);
  });

  test("IP-urile mai vechi decât setarea se golesc; 0 = se păstrează", async () => {
    const forumId = (await w.createTree()).forum.id;
    const t = await w.topics.create(w.member, { forumId, title: "Vechi și nou", content: doc("text") });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await w.db.post.update({ where: { id: t.postId }, data: { ip: "203.0.113.1", createdAt: old } });
    const user = await w.createUser("Arhivat", "member");
    await w.db.user.update({ where: { id: user.id }, data: { registrationIp: "203.0.113.2", createdAt: old, lastIp: "203.0.113.3", lastActiveAt: new Date() } });
    await device(user.id, "203.0.113.4", old);
    await expect(ip.stripOldIps()).resolves.toBe(0);
    await w.settings.set(IP_RETENTION_SETTING, 30, w.root);
    await expect(ip.stripOldIps()).resolves.toBeGreaterThanOrEqual(3);
    expect((await w.db.post.findUniqueOrThrow({ where: { id: t.postId } })).ip).toBeNull();
    expect(await w.db.user.findUniqueOrThrow({ where: { id: user.id }, select: { registrationIp: true, lastIp: true } })).toEqual({ registrationIp: null, lastIp: "203.0.113.3" });
    expect((await w.db.userDevice.findFirstOrThrow({ where: { userId: user.id } })).ip).toBeNull();
  });
});
