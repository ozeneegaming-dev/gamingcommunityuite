import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { doc } from "../../test/world";

let w: GcsRemovalWorld;
let root: GcsActor;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
});

/** Un status (sau răspuns) direct în bază: peretele lui `profile`, scris de `author`. */
async function status(profile: string, author: string, parentId: number | null = null) {
  const row = await w.s.db.statusUpdate.create({ data: { profileUserId: profile, authorId: author, parentId, contentJson: doc("s"), contentHtml: "<p>s</p>", ip: "198.51.100.3" } });
  if (parentId !== null) await w.s.db.statusUpdate.update({ where: { id: parentId }, data: { repliesCount: { increment: 1 } } });
  return row;
}

describe("profilul la ștergerea unui cont", () => {
  test("„Păstrează conținutul”: statusurile de pe alte profiluri rămân fără autor și IP; peretele lui se șterge", async () => {
    const leaving = await w.user("Pleaca");
    const other = await w.user("Altul");
    const onOther = await status(other.userId!, leaving.userId!);
    const ownWall = await status(leaving.userId!, other.userId!);
    await status(leaving.userId!, leaving.userId!, ownWall.id);

    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "KEEP_CONTENT", keepMessages: false });

    const rows = await w.s.db.statusUpdate.findMany({ select: { id: true, authorId: true, ip: true } });
    expect(rows).toEqual([{ id: onOther.id, authorId: null, ip: null }]);
  });

  test("„Șterge și conținutul”: statusurile și răspunsurile lui se șterg; contorul părintelui scade", async () => {
    const leaving = await w.user("Pleaca");
    const other = await w.user("Altul");
    const parent = await status(other.userId!, other.userId!);
    await status(other.userId!, leaving.userId!, parent.id);
    await status(other.userId!, leaving.userId!);

    await w.s.memberRemoval.requestDelete(root, leaving.userId!, { mode: "DELETE_CONTENT", keepMessages: false });

    const rows = await w.s.db.statusUpdate.findMany({ select: { id: true, repliesCount: true } });
    expect(rows).toEqual([{ id: parent.id, repliesCount: 0 }]);
  });
});

describe("profilul la unirea conturilor", () => {
  test("peretele, statusurile, ignorările, insignele și realizările trec la țintă fără dubluri; punctele se adună", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    const other = await w.user("Altul");
    await status(source.userId!, other.userId!);
    await status(other.userId!, source.userId!);
    await w.s.db.userIgnore.createMany({
      data: [
        { userId: source.userId!, ignoredId: target.userId! }, // s-ar ignora pe ea: dispare
        { userId: source.userId!, ignoredId: other.userId! }, // trece la țintă
        { userId: other.userId!, ignoredId: source.userId! }, // altul ignoră acum ținta
      ],
    });
    const [b1, b2] = await w.s.db.badge.findMany({ orderBy: { id: "asc" }, take: 2 });
    await w.s.db.badge.update({ where: { id: b1!.id }, data: { points: 10 } });
    await w.s.db.userBadge.createMany({ data: [{ userId: source.userId!, badgeId: b1!.id }, { userId: target.userId!, badgeId: b1!.id }, { userId: source.userId!, badgeId: b2!.id }] });
    await w.s.db.achievementLog.createMany({
      data: [
        { userId: source.userId!, points: 5, uniqueKey: "rule:1" }, // dublură
        { userId: target.userId!, points: 5, uniqueKey: "rule:1" },
        { userId: source.userId!, points: 3, uniqueKey: "each:2:post:9" },
      ],
    });
    // Sursa: 10 (insigna b1) + 5 + 3 = 18; ținta: 10 + 5 = 15. După unire: 15 + 18 − 10 − 5 = 18.
    await w.s.db.user.update({ where: { id: source.userId! }, data: { points: 18 } });
    await w.s.db.user.update({ where: { id: target.userId! }, data: { points: 15 } });

    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);

    expect(await w.s.db.statusUpdate.count({ where: { profileUserId: target.userId! } })).toBe(1);
    expect(await w.s.db.statusUpdate.count({ where: { authorId: target.userId } })).toBe(1);
    const ignores = await w.s.db.userIgnore.findMany({ select: { userId: true, ignoredId: true } });
    expect(ignores).toEqual(expect.arrayContaining([{ userId: target.userId, ignoredId: other.userId }, { userId: other.userId, ignoredId: target.userId }]));
    expect(ignores).toHaveLength(2);
    expect((await w.s.db.userBadge.findMany({ where: { userId: target.userId! }, orderBy: { badgeId: "asc" } })).map((b) => b.badgeId)).toEqual([b1!.id, b2!.id]);
    expect(await w.s.db.achievementLog.count({ where: { userId: target.userId! } })).toBe(2);
    expect((await w.s.db.user.findUniqueOrThrow({ where: { id: target.userId! } })).points).toBe(18);
  });
});
