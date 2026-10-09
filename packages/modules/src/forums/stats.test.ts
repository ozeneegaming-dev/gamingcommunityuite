import { GcsAppService, GcsStatsService, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { whoWasOnline, groupLegend } from "./stats";

let w: GcsProfileWorld;
let admin: GcsActor;
let apps: GcsAppService;
let stats: GcsStatsService;

beforeEach(async () => {
  w = await createProfileWorld();
  admin = await w.actorFor(await w.createUser("Admin", "root_admin"));
  apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings: w.settings });
  stats = new GcsStatsService({ db: w.db, cache: w.cache, registry: w.registry, apps });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

const HOUR = 3_600_000;

describe("plăcile panoului", () => {
  test("forumurile dau topicuri, postări și membri; placa VIP numără doar abonamentele active", async () => {
    const a = await w.actorFor(await w.createUser("Ana", "member"));
    const b = await w.actorFor(await w.createUser("Bogdan", "member"));
    await w.vip.grant(admin, { userId: a.userId!, groupId: w.groups.vip_gold!, days: 30 });
    const expired = await w.vip.grant(admin, { userId: b.userId!, groupId: w.groups.vip_silver!, days: 30 });
    await w.db.vipSubscription.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - HOUR) } });
    // Al doilea abonament activ al aceluiași user nu-l numără de două ori.
    await w.vip.grant(admin, { userId: w.member.userId!, groupId: w.groups.vip_gold!, days: null });

    const tiles = await stats.tiles();
    expect(tiles.map((t) => t.key)).toEqual(expect.arrayContaining(["forums.topics", "forums.posts", "forums.members", "vip.members"]));
    expect(tiles.find((t) => t.key === "vip.members")?.value).toBe(2);
    expect(tiles.find((t) => t.key === "forums.members")?.value).toBe(await w.db.user.count());
  });

  test("plăcile unei aplicații dezactivate lipsesc", async () => {
    await apps.setEnabled(admin, "vip", false);
    expect((await stats.tiles()).some((t) => t.module === "vip")).toBe(false);
    await apps.setEnabled(admin, "vip", true);
    expect((await stats.tiles()).some((t) => t.module === "vip")).toBe(true);
  });
});

describe("„Cine a fost online” și legenda", () => {
  test("doar ultimele 24 h, cei mai recenți primii; cei ascunși sunt doar numărați", async () => {
    const now = Date.now();
    await w.db.user.updateMany({ data: { lastActiveAt: null } });
    const users = await Promise.all(["Unu", "Doi", "Trei", "Ascuns"].map((n) => w.createUser(n, "member")));
    const [unu, doi, trei, ascuns] = users.map((u) => u.id) as [string, string, string, string];
    await w.db.user.update({ where: { id: unu }, data: { lastActiveAt: new Date(now - 23 * HOUR) } });
    await w.db.user.update({ where: { id: doi }, data: { lastActiveAt: new Date(now - HOUR) } });
    await w.db.user.update({ where: { id: trei }, data: { lastActiveAt: new Date(now - 25 * HOUR) } });
    await w.db.user.update({ where: { id: ascuns }, data: { lastActiveAt: new Date(now - HOUR), privacy: { showOnline: false } } });

    const view = await whoWasOnline(w.db, now);
    expect(view.members.map((m) => m.name)).toEqual(["Doi", "Unu"]);
    expect(view).toMatchObject({ hidden: 1, total: 3 });
  });

  test("legenda are doar grupurile marcate, în ordinea din ACP", async () => {
    await w.db.group.update({ where: { id: w.groups.member! }, data: { inLegend: false } });
    const legend = await groupLegend(w.db);
    expect(legend.some((g) => g.key === "member")).toBe(false);
    expect(legend.some((g) => g.key === "root_admin")).toBe(true);
  });
});
