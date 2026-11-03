import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { DEFAULT_TAGS, TAGS_SETTING } from "./tagsAdmin";

let w: GcsRemovalWorld;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
});

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
/** Un topic nou (fără pauza dintre postări, ca `w.topic`), cu etichete. */
async function topicWith(actor: Awaited<ReturnType<GcsRemovalWorld["user"]>>, forumId: number, title: string, tags: string[]) {
  await w.s.kv.del(`gcs:rl:forum-post:${actor.userId}`);
  return w.s.topics.create(actor, { forumId, title, content: doc(title), tags });
}

describe("etichetele din ACP", () => {
  test("lista cu topicuri, redenumirea, unirea (fără dubluri) și ștergerea nefolositelor", async () => {
    const root = await w.user("RootTags", "root_admin");
    const forum = await w.forum();
    const a = await topicWith(root, forum, "Config CS2 bun", ["cs2", "config"]);
    const b = await topicWith(root, forum, "Alt config CS2", ["counter-strike", "config"]);
    await w.s.tagsAdmin.create(root, "Nefolosită");

    let list = await w.s.tagsAdmin.list(root, { page: 1 });
    expect(list.items.map((t) => [t.slug, t.topics])).toEqual([
      ["config", 2],
      ["counter-strike", 1],
      ["cs2", 1],
      ["nefolosita", 0],
    ]);
    expect(list.unused).toBe(1);

    const cs2 = list.items.find((t) => t.slug === "cs2")!;
    const cs = list.items.find((t) => t.slug === "counter-strike")!;
    await w.s.tagsAdmin.rename(root, cs2.id, "CS 2");
    await expect(w.s.tagsAdmin.rename(root, cs2.id, "config")).rejects.toMatchObject({ params: { reason: "tag_exists" } });
    expect(await w.s.tagsAdmin.merge(root, cs.id, cs2.id)).toBe(1);
    list = await w.s.tagsAdmin.list(root, { page: 1, sort: "name" });
    expect(list.items.map((t) => [t.slug, t.topics])).toEqual([
      ["config", 2],
      ["cs-2", 2],
      ["nefolosita", 0],
    ]);
    expect((await w.s.db.topicTag.findMany({ where: { topicId: { in: [a.topicId, b.topicId] } } })).length).toBe(4);
    expect(await w.s.tagsAdmin.pruneUnused(root)).toBe(1);
    await expect(w.s.tagsAdmin.list(await w.user("FaraDrept"), { page: 1 })).rejects.toThrow();
  });

  test("setările: oprite pe tot site-ul și lista închisă la scrierea unui topic", async () => {
    const root = await w.user("RootTagCfg", "root_admin");
    const forum = await w.forum();
    await w.s.tagsAdmin.create(root, "anunt");
    await w.s.settings.set(TAGS_SETTING, { ...DEFAULT_TAGS, mode: "closed" }, w.system());
    await expect(topicWith(root, forum, "Topic cu eticheta nouă", ["noua"])).rejects.toMatchObject({ fields: { tags: "tag_not_allowed" } });
    await expect(topicWith(root, forum, "Topic cu eticheta din listă", ["anunt"])).resolves.toMatchObject({ topicId: expect.any(Number) });
    await w.s.settings.set(TAGS_SETTING, { enabled: false, mode: "open" }, w.system());
    await expect(topicWith(root, forum, "Topic cu etichete oprite", ["anunt"])).rejects.toMatchObject({ fields: { tags: "disabled" } });
  });
});
