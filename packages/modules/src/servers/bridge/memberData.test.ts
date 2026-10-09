import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../../test/removalWorld";

let w: GcsRemovalWorld;
let root: GcsActor;
let serverId: number;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
  serverId = (await w.s.db.gameServer.create({ data: { game: "cs16", host: "198.51.100.20", port: 27015, name: "Public", slug: "public" } })).id;
});

const steamId = (n: number) => `7656119800000000${n}`;

async function player(userId: string | null, n: number, linkSource: "STEAM" | "CODE" | null = userId ? "CODE" : null) {
  const p = await w.s.db.gamePlayer.create({ data: { kind: "STEAM", value: steamId(n), trust: "HIGH", userId, linkSource, linkedAt: userId ? new Date() : null, name: `p${n}` } });
  await w.s.db.gamePlayerStat.create({ data: { playerId: p.id, serverId, kills: 10 * n, deaths: n } });
  return p;
}

describe("serverele de joc la ștergerea unui cont", () => {
  test("identitățile se dezleagă (cu statisticile păstrate); intrările de admin și tichetele lui dispar; listele pluginurilor se reîmprospătează", async () => {
    const leaving = await w.user("Pleaca");
    const other = await w.user("Altul");
    const p = await player(leaving.userId!, 1);
    await w.s.db.gameAdmin.create({ data: { subject: "USER", userId: leaving.userId!, serverId, flags: "abc" } });
    await w.s.db.gameServerAdmin.create({ data: { serverId, userId: leaving.userId! } });
    await w.s.db.gameTicket.create({ data: { kind: "APPEAL", authorId: leaving.userId!, title: "Unban", contentJson: {}, contentHtml: "" } });
    const otherTicket = await w.s.db.gameTicket.create({ data: { kind: "ADMIN", authorId: other.userId!, targetUserId: leaving.userId, assigneeId: leaving.userId, title: "Reclamație", contentJson: {}, contentHtml: "" } });
    const sanction = await w.s.db.gameSanction.create({ data: { type: "BAN", scope: "GLOBAL", reason: "wh", source: "SITE", adminUserId: leaving.userId, adminName: "Pleaca" } });
    const version = await w.s.bridge.store.version();

    const preview = await w.s.memberRemoval.preview(root, leaving.userId!);
    expect(preview.items).toEqual(expect.arrayContaining([expect.objectContaining({ key: "servers.identities", count: 1 }), expect.objectContaining({ key: "servers.admins", count: 2 })]));
    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "KEEP_CONTENT", keepMessages: false });

    expect(await w.s.db.gamePlayer.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ userId: null, linkSource: null, linkedAt: null });
    expect(await w.s.db.gamePlayerStat.findUniqueOrThrow({ where: { playerId_serverId: { playerId: p.id, serverId } } })).toMatchObject({ kills: 10 });
    expect(await w.s.db.gameAdmin.count()).toBe(0);
    expect(await w.s.db.gameServerAdmin.count()).toBe(0);
    expect(await w.s.db.gameTicket.findMany({ select: { id: true, targetUserId: true, assigneeId: true } })).toEqual([{ id: otherTicket.id, targetUserId: null, assigneeId: null }]);
    expect(await w.s.db.gameSanction.findUniqueOrThrow({ where: { id: sanction.id } })).toMatchObject({ adminUserId: null, adminName: "Pleaca" });
    expect(Number(await w.s.bridge.store.version())).toBeGreaterThan(Number(version));
  });
});

describe("serverele de joc la unirea conturilor", () => {
  test("identitățile și intrările de admin trec la țintă (fără dubluri pe același server); contul Steam mutat leagă identitatea Steam", async () => {
    const source = await w.user("SteamDublura");
    const target = await w.user("Principal");
    await w.s.db.account.create({ data: { userId: source.userId!, providerId: "steam", accountId: steamId(7) } });
    const steam = await player(source.userId!, 7, "STEAM");
    const coded = await player(source.userId!, 2, "CODE");
    await w.s.db.gameAdmin.createMany({
      data: [
        { subject: "USER", userId: source.userId!, serverId, flags: "abc" }, // dublură pe același server
        { subject: "USER", userId: target.userId!, serverId, flags: "z" },
        { subject: "USER", userId: source.userId!, serverId: null, flags: "a" }, // pe toate serverele: trece
      ],
    });

    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);

    expect(await w.s.db.account.findFirstOrThrow({ where: { providerId: "steam" } })).toMatchObject({ userId: target.userId });
    expect(await w.s.db.gamePlayer.findUniqueOrThrow({ where: { id: steam.id } })).toMatchObject({ userId: target.userId, linkSource: "STEAM" });
    expect(await w.s.db.gamePlayer.findUniqueOrThrow({ where: { id: coded.id } })).toMatchObject({ userId: target.userId, linkSource: "CODE" });
    const admins = await w.s.db.gameAdmin.findMany({ orderBy: { id: "asc" }, select: { userId: true, serverId: true, flags: true } });
    expect(admins).toEqual([
      { userId: target.userId, serverId, flags: "z" },
      { userId: target.userId, serverId: null, flags: "a" },
    ]);
  });

  test("ținta avea deja Steam: identitatea Steam a sursei rămâne legată de țintă (legătură de staff)", async () => {
    const source = await w.user("SteamDublura");
    const target = await w.user("Principal");
    await w.s.db.account.createMany({ data: [{ userId: source.userId!, providerId: "steam", accountId: steamId(3) }, { userId: target.userId!, providerId: "steam", accountId: steamId(4) }] });
    const p = await player(source.userId!, 3, "STEAM");
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await w.s.db.account.findMany({ where: { providerId: "steam" }, select: { userId: true, accountId: true } })).toEqual([{ userId: target.userId, accountId: steamId(4) }]);
    expect(await w.s.db.gamePlayer.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ userId: target.userId, linkSource: "STAFF" });
  });
});
