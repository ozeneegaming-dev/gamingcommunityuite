import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { GcsActorResolver } from "../auth/actor";
import { normalizeUsername } from "../auth/usernames";
import { assertCanManageUser } from "../groups/rootGuard";
import { seedDefaults } from "../install/seed";
import { BOT_DEFAULT_NAME, BOT_EMAIL, communityBotId, ensureCommunityBot, isBotUser } from "./account";

const db = testDb();
let groups: Record<string, number>;

beforeEach(async () => {
  await truncateAll(db);
  await seedDefaults(db, testRegistry());
  groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id]));
});

afterAll(async () => {
  await db.$disconnect();
});

const rootActor = () => ({ userId: "root", groupIds: [groups.root_admin!], primaryGroupId: groups.root_admin!, isBanned: false, ip: "127.0.0.1" });

describe("contul-bot (bot-stiri §1)", () => {
  test("seed-ul creează un singur cont-bot, în grupul protejat „Bot”, fără parolă; rulat din nou nu mai creează altul", async () => {
    const bots = await db.user.findMany({ where: { isBot: true }, include: { accounts: true, primaryGroup: true } });
    expect(bots).toHaveLength(1);
    expect(bots[0]).toMatchObject({ name: BOT_DEFAULT_NAME, email: BOT_EMAIL, emailVerified: false });
    expect(bots[0]!.accounts).toHaveLength(0);
    expect(bots[0]!.primaryGroup).toMatchObject({ key: "bot", isProtected: true });

    await seedDefaults(db, testRegistry());
    expect(await db.user.count({ where: { isBot: true } })).toBe(1);
    expect(await communityBotId(db)).toBe(bots[0]!.id);
    expect(await isBotUser(db, bots[0]!.id)).toBe(true);
  });

  test("numele implicit e luat de un membru → botul primește următorul nume liber", async () => {
    await db.user.deleteMany({ where: { isBot: true } });
    await db.user.create({ data: { name: BOT_DEFAULT_NAME, nameNormalized: normalizeUsername(BOT_DEFAULT_NAME), email: "om@mail.com", primaryGroupId: groups.member! } });
    const id = await ensureCommunityBot(db, groups.bot!);
    expect((await db.user.findUniqueOrThrow({ where: { id } })).name).toBe(`${BOT_DEFAULT_NAME} 2`);
  });

  test("o sesiune a botului (scrisă direct în bază) nu autentifică: vizitator, iar sesiunea e ștearsă", async () => {
    const id = (await communityBotId(db))!;
    await db.session.create({ data: { token: "tok-bot", userId: id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const resolver = new GcsActorResolver({ db });
    const actor = await resolver.getActor({ sessionToken: "tok-bot", ip: "203.0.113.9" });
    expect(actor.userId).toBeNull();
    expect(await db.session.count({ where: { userId: id } })).toBe(0);
    expect((await resolver.forUser(id, "203.0.113.9")).userId).toBeNull();
    // Nici `lastActiveAt` nu se atinge (botul nu apare online).
    expect((await db.user.findUniqueOrThrow({ where: { id } })).lastActiveAt).toBeNull();
  });

  test("botul e protejat: nici Root Admin nu îl poate gestiona (ștergere, unire, ban, grupuri)", async () => {
    const id = (await communityBotId(db))!;
    await expect(assertCanManageUser(db, rootActor(), id)).rejects.toMatchObject({ params: { reason: "bot_protected" } });
  });
});
