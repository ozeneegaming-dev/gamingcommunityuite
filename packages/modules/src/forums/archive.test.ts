import { GcsForbidden } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";
import { archiveWhere, GcsArchiveService, normalizeArchiveConditions, normalizeExclusions, type GcsArchiveRuleInput } from "./archive";

let w: GcsForumWorld;
let archive: GcsArchiveService;
const DAY = 86_400_000;

beforeEach(async () => {
  w = await createForumWorld();
  archive = new GcsArchiveService({ db: w.db, bus: w.bus, acp: w.acp, settings: w.settings, posting: w.posting });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

/** Un topic cu ultima postare acum `days` zile (și câmpurile date). */
async function oldTopic(forumId: number, title: string, days: number, data: Record<string, unknown> = {}) {
  await w.clearFlood(w.member);
  const t = await w.topics.create(w.member, { forumId, title, content: doc(title) });
  await w.db.topic.update({ where: { id: t.topicId }, data: { lastPostAt: new Date(Date.now() - days * DAY), ...data } });
  return t.topicId;
}

const rule = (over: Partial<GcsArchiveRuleInput> = {}): GcsArchiveRuleInput => ({
  name: "Vechi",
  enabled: true,
  conditions: normalizeArchiveConditions({ lastPostDays: 90 }),
  exclusions: normalizeExclusions({}),
  ...over,
});

describe("arhivarea automată (Forum v2)", () => {
  test("condițiile: valorile lipsă sau greșite devin cele implicite; filtrul Prisma cu excepțiile „dar nu când”", () => {
    expect(normalizeArchiveConditions({ lastPostDays: -3, pinned: "maybe", forumIds: [1, 1, "x", 2] })).toMatchObject({ lastPostDays: 365, pinned: "any", forumIds: [1, 2] });
    const now = new Date("2026-10-17T00:00:00Z");
    const where = archiveWhere(normalizeArchiveConditions({ lastPostDays: 30, locked: "yes", repliesBelow: 5 }), normalizeExclusions({ pinned: true, ratingAtLeast: 4 }), now);
    expect(where).toEqual({
      AND: [{ archivedAt: null }, { lastPostAt: { lt: new Date(now.getTime() - 30 * DAY) } }, { locked: true }, { repliesCount: { lt: 5 } }],
      NOT: [{ pinned: true }, { ratingAvg: { gte: 4 } }],
    });
  });

  test("o regulă arhivează topicurile vechi, în afară de excepții; un topic arhivat e doar de citit și se restaurează", async () => {
    const { forum } = await w.createTree();
    const old = await oldTopic(forum.id, "Vechi de tot", 200);
    const pinned = await oldTopic(forum.id, "Vechi dar fixat", 200, { pinned: true });
    const fresh = await oldTopic(forum.id, "Proaspăt", 3);
    const id = await archive.save(w.root, rule({ exclusions: normalizeExclusions({ pinned: true }) }));
    expect(await archive.preview(w.root, rule({ exclusions: normalizeExclusions({ pinned: true }) }))).toBe(1);

    // Cu comutatorul general oprit, jobul nu face nimic; „Rulează acum” (force) da.
    expect(await archive.run()).toEqual({});
    expect(await archive.run(new Date(), { force: true })).toEqual({ [id]: 1 });
    const rows = await w.db.topic.findMany({ where: { id: { in: [old, pinned, fresh] } }, select: { id: true, archivedAt: true } });
    expect(rows.filter((r) => r.archivedAt).map((r) => r.id)).toEqual([old]);
    expect((await w.db.archiveRule.findUniqueOrThrow({ where: { id } })).lastCount).toBe(1);

    // Doar de citit: fără răspunsuri, cu banda „arhivat” în listă și pe pagină.
    await w.clearFlood(w.member);
    await expect(w.posts.reply(w.member, { topicId: old, content: doc("încă ceva") })).rejects.toMatchObject({ params: { reason: "archived" } });
    const page = await w.queries.topic(w.member, old, { page: 1 });
    expect(page.canReply).toBe(false);
    expect(page.topic.archivedAt).not.toBeNull();
    expect((await w.queries.forum(w.member, forum.id, { page: 1 })).topics.find((t) => t.id === old)?.archived).toBe(true);

    await expect(archive.setArchived(w.member, [old], false)).rejects.toBeInstanceOf(GcsForbidden);
    await archive.setArchived(w.root, [old], false);
    expect((await w.queries.topic(w.member, old, { page: 1 })).canReply).toBe(true);
  });

  test("filtrele: forumuri, starter, sondaj, vizualizări și nota; regula oprită nu rulează", async () => {
    const { category, forum } = await w.createTree();
    const other = await w.forums.create({ parentId: category.id, type: "FORUM", name: "Arhivă" }, w.root);
    const a = await oldTopic(forum.id, "Puține vizualizări", 100, { viewsCount: 2 });
    const b = await oldTopic(forum.id, "Multe vizualizări", 100, { viewsCount: 900 });
    const c = await oldTopic(other.id, "Alt forum", 100);
    await archive.save(w.root, rule({ conditions: normalizeArchiveConditions({ lastPostDays: 30, forumIds: [forum.id], viewsBelow: 100, starterIds: [w.member.userId] }) }));
    await archive.save(w.root, rule({ name: "Oprită", enabled: false, conditions: normalizeArchiveConditions({ lastPostDays: 1 }) }));
    await archive.run(new Date(), { force: true });
    const archived = (await w.db.topic.findMany({ where: { id: { in: [a, b, c] }, archivedAt: { not: null } }, select: { id: true } })).map((t) => t.id);
    expect(archived).toEqual([a]);
  });

  test("regulile cer dreptul ACP pe forumuri; închiderea automată după N zile (opțiunea forumului)", async () => {
    await expect(archive.save(w.member, rule())).rejects.toBeInstanceOf(GcsForbidden);
    await expect(archive.list(w.member)).rejects.toBeInstanceOf(GcsForbidden);
    const { forum } = await w.createTree();
    const stale = await oldTopic(forum.id, "Fără răspuns de mult", 40);
    const active = await oldTopic(forum.id, "Activ", 2);
    await w.forums.saveOptions(w.root, forum.id, { autoCloseDays: 30 });
    expect(await archive.autoClose()).toBe(1);
    const rows = await w.db.topic.findMany({ where: { id: { in: [stale, active] } }, select: { id: true, locked: true }, orderBy: { id: "asc" } });
    expect(rows).toEqual([
      { id: stale, locked: true },
      { id: active, locked: false },
    ]);
  });
});
