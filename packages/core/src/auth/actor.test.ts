import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { seedDefaults } from "../install/seed";
import { guestPresenceId, type GcsPresenceViewer } from "../presence/presence";
import { GcsActorResolver } from "./actor";
import { prepareNewUser } from "./registration";

const db = testDb();
const resolver = new GcsActorResolver({ db });
let groups: Record<string, number>;

beforeEach(async () => {
  await truncateAll(db);
  await seedDefaults(db, testRegistry());
  groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id]));
});

afterAll(async () => {
  await db.$disconnect();
});

async function userWithSession(name: string, expiresAt = new Date(Date.now() + 3_600_000)) {
  const user = await db.user.create({
    data: await prepareNewUser(db, { name, email: `${name.toLowerCase()}@mail.com` }, { emailConfirm: true }),
  });
  const session = await db.session.create({ data: { token: `tok-${name}`, userId: user.id, expiresAt } });
  return { user, token: session.token };
}

describe("GcsActorResolver.getActor", () => {
  test("fără sesiune → vizitator în grupul guest", async () => {
    await expect(resolver.getActor({ ip: "203.0.113.5" })).resolves.toEqual({
      userId: null,
      groupIds: [groups.guest],
      primaryGroupId: groups.guest,
      isBanned: false,
      ip: "203.0.113.5",
    });
  });

  test("userul nou → new_member, cu grupurile secundare incluse", async () => {
    const { user, token } = await userWithSession("Nou");
    await db.userGroup.create({ data: { userId: user.id, groupId: groups.vip_gold! } });
    const actor = await resolver.getActor({ sessionToken: token, ip: "203.0.113.5" });
    expect(actor).toMatchObject({ userId: user.id, primaryGroupId: groups.new_member, isBanned: false });
    expect(actor.groupIds.sort()).toEqual([groups.new_member, groups.vip_gold].sort());
  });

  test("actualizează lastActiveAt cel mult o dată la 5 minute", async () => {
    const { user, token } = await userWithSession("Activ");
    const t0 = new Date(Date.now() - 10 * 60_000);
    await db.user.update({ where: { id: user.id }, data: { lastActiveAt: t0 } });

    await resolver.getActor({ sessionToken: token, ip: "1.1.1.1" }, new Date(t0.getTime() + 60_000));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).lastActiveAt).toEqual(t0);

    const later = new Date(t0.getTime() + 6 * 60_000);
    await resolver.getActor({ sessionToken: token, ip: "1.1.1.1" }, later);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).lastActiveAt).toEqual(later);
  });

  test("un token necunoscut sau o sesiune expirată → vizitator", async () => {
    const { token } = await userWithSession("Expirat", new Date(Date.now() - 1000));
    await expect(resolver.getActor({ sessionToken: token, ip: "1.1.1.1" })).resolves.toMatchObject({ userId: null });
    await expect(resolver.getActor({ sessionToken: "inexistent", ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: null,
    });
  });

  test("ban de cont activ → vizitator banat, iar sesiunile userului sunt șterse", async () => {
    const { user, token } = await userWithSession("Banat");
    await db.ban.create({ data: { type: "ACCOUNT", value: user.id, userId: user.id, reason: "spam" } });
    await expect(resolver.getActor({ sessionToken: token, ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: null,
      groupIds: [groups.guest],
      isBanned: true,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  test("ban pe IP → și vizitatorii de pe acel IP sunt banați", async () => {
    await db.ban.create({ data: { type: "IP", value: "198.51.100.23", reason: "abuz" } });
    await expect(resolver.getActor({ ip: "198.51.100.23" })).resolves.toMatchObject({ isBanned: true });
    await expect(resolver.getActor({ ip: "198.51.100.24" })).resolves.toMatchObject({ isBanned: false });
  });

  test("un ban expirat sau ridicat nu mai blochează", async () => {
    const { user, token } = await userWithSession("Iertat");
    await db.ban.create({
      data: { type: "ACCOUNT", value: user.id, userId: user.id, reason: "x", expiresAt: new Date(Date.now() - 1000) },
    });
    await db.ban.create({ data: { type: "ACCOUNT", value: user.id, userId: user.id, reason: "y", liftedAt: new Date() } });
    await expect(resolver.getActor({ sessionToken: token, ip: "1.1.1.1" })).resolves.toMatchObject({
      userId: user.id,
      isBanned: false,
    });
  });

  test("notează prezența (membru sau vizitator pe IP), cel mult o dată pe minut, dar nu pentru banați", async () => {
    const touched: GcsPresenceViewer[] = [];
    const withPresence = new GcsActorResolver({ db, presence: { touch: async (v) => void touched.push(v) } });
    const { user, token } = await userWithSession("Prezent");
    const t0 = new Date();
    await withPresence.getActor({ sessionToken: token, ip: "203.0.113.5" }, t0);
    await withPresence.getActor({ sessionToken: token, ip: "203.0.113.5" }, new Date(t0.getTime() + 30_000));
    await withPresence.getActor({ ip: "203.0.113.9" }, t0);
    await withPresence.getActor({ sessionToken: token, ip: "203.0.113.5" }, new Date(t0.getTime() + 61_000));
    expect(touched).toEqual([{ userId: user.id }, { guestId: guestPresenceId("203.0.113.9") }, { userId: user.id }]);

    await db.ban.create({ data: { type: "IP", value: "203.0.113.66", reason: "x" } });
    await withPresence.getActor({ ip: "203.0.113.66" }, t0);
    expect(touched).toHaveLength(3);
  });

  test("o eroare la notarea prezenței nu oprește request-ul", async () => {
    const failing = new GcsActorResolver({ db, presence: { touch: async () => Promise.reject(new Error("redis down")) } });
    await expect(failing.getActor({ ip: "203.0.113.5" })).resolves.toMatchObject({ userId: null });
  });

  test("forUser: actorul după id, fără sesiune; banat sau inexistent → vizitator", async () => {
    const { user } = await userWithSession("Sock");
    await expect(resolver.forUser(user.id, "203.0.113.5")).resolves.toMatchObject({ userId: user.id, groupIds: [groups.new_member], isBanned: false });
    await expect(resolver.forUser("nu-exista", "203.0.113.5")).resolves.toMatchObject({ userId: null, isBanned: false });
    await db.ban.create({ data: { type: "ACCOUNT", value: user.id, userId: user.id, reason: "x" } });
    await expect(resolver.forUser(user.id, "203.0.113.5")).resolves.toMatchObject({ userId: null, isBanned: true });
  });
});
