import type { GcsActor } from "@gcs/core";
import type { ClanRole } from "@gcs/db";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";

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

let seq = 0;
/** Un clan activ cu membrii dați (în ordinea intrării). */
async function clan(members: [string, ClanRole][]) {
  seq++;
  const c = await w.s.db.clan.create({ data: { tag: `T${seq}`, tagNormalized: `T${seq}`, name: `Clan ${seq}`, nameNormalized: `clan ${seq}`, slug: `clan-${seq}`, status: "ACTIVE", membersCount: members.length } });
  let at = Date.now() - 100_000;
  for (const [userId, role] of members) await w.s.db.clanMember.create({ data: { clanId: c.id, userId, role, joinedAt: new Date((at += 1000)) } });
  return c;
}
const roles = async (clanId: number) => Object.fromEntries((await w.s.db.clanMember.findMany({ where: { clanId } })).map((m) => [m.userId, m.role]));

describe("clanurile la ștergerea unui cont", () => {
  test("liderul: conducerea trece la cel mai vechi ofițer (arătat dinainte); contorul scade", async () => {
    const leader = await w.user("Lider");
    const member = await w.user("Membru");
    const officer = await w.user("Ofiter");
    const c = await clan([
      [leader.userId!, "LEADER"],
      [member.userId!, "MEMBER"],
      [officer.userId!, "OFFICER"],
    ]);
    const preview = await w.s.memberRemoval.preview(root, leader.userId!);
    expect(preview.notes).toEqual(expect.arrayContaining([expect.objectContaining({ key: "clan_successor", params: { tag: c.tag, clan: c.name, name: "Ofiter" } })]));
    await w.s.memberRemoval.requestDelete(root, leader.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(await roles(c.id)).toEqual({ [officer.userId!]: "LEADER", [member.userId!]: "MEMBER" });
    expect(await w.s.db.clan.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ membersCount: 2, status: "ACTIVE" });
  });

  test("fără ofițeri, conducerea trece la cel mai vechi membru; un clan rămas gol se arhivează", async () => {
    const leader = await w.user("Lider");
    const first = await w.user("Primul");
    const second = await w.user("AlDoilea");
    const c1 = await clan([
      [leader.userId!, "LEADER"],
      [first.userId!, "MEMBER"],
      [second.userId!, "MEMBER"],
    ]);
    const c2 = await clan([[leader.userId!, "LEADER"]]);
    expect((await w.s.memberRemoval.preview(root, leader.userId!)).notes.map((n) => n.key).sort()).toEqual(["clan_archived", "clan_successor"]);
    await w.s.memberRemoval.requestDelete(root, leader.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    expect((await roles(c1.id))[first.userId!]).toBe("LEADER");
    expect(await w.s.db.clan.findUniqueOrThrow({ where: { id: c2.id } })).toMatchObject({ membersCount: 0, status: "ARCHIVED" });
  });
});

describe("clanurile la unirea conturilor", () => {
  test("ținta fără clan: apartenențele sursei trec la țintă, cu rolurile", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    const other = await w.user("Altul");
    const c = await clan([
      [source.userId!, "LEADER"],
      [other.userId!, "MEMBER"],
    ]);
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await roles(c.id)).toEqual({ [target.userId!]: "LEADER", [other.userId!]: "MEMBER" });
    expect((await w.s.db.clan.findUniqueOrThrow({ where: { id: c.id } })).membersCount).toBe(2);
  });

  test("ținta are clan: rămân clanurile ei; în clanul comun, conducerea sursei trece la țintă", async () => {
    const source = await w.user("Dublura");
    const target = await w.user("Principal");
    const officer = await w.user("Ofiter");
    const shared = await clan([
      [source.userId!, "LEADER"],
      [officer.userId!, "OFFICER"],
      [target.userId!, "MEMBER"],
    ]);
    const onlySource = await clan([
      [source.userId!, "MEMBER"],
      [officer.userId!, "LEADER"],
    ]);
    const notes = (await w.s.memberRemoval.mergePreview(root, source.userId!, target.userId!)).notes;
    expect(notes).toEqual(expect.arrayContaining([expect.objectContaining({ key: "clans_target_kept" }), expect.objectContaining({ key: "clan_successor", params: expect.objectContaining({ name: "Principal" }) })]));
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await roles(shared.id)).toEqual({ [target.userId!]: "LEADER", [officer.userId!]: "OFFICER" });
    expect(await roles(onlySource.id)).toEqual({ [officer.userId!]: "LEADER" });
    expect((await w.s.db.clan.findUniqueOrThrow({ where: { id: onlySource.id } })).membersCount).toBe(1);
  });
});
