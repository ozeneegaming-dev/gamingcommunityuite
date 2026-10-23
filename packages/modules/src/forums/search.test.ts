import { GcsRateLimited, GcsValidationError, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";

let w: GcsForumWorld;
let tree: Awaited<ReturnType<GcsForumWorld["createTree"]>>;
let krypt: GcsActor;

beforeEach(async () => {
  w = await createForumWorld();
  tree = await w.createTree({ subforum: true });
  krypt = await w.actorFor(await w.createUser("Krypt", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const topicIds = async (actor: GcsActor, q: string, extra: Record<string, unknown> = {}) =>
  (await w.search.search(actor, { q, type: "topics", page: 1, ...extra })).results.map((r) => r.topicId);

describe("GcsForumSearch", () => {
  test("fără diacritice și cu flexiuni: „masina” găsește „Mașina lui Ștefan”, „mașini” găsește „mașina”", async () => {
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Mașina lui Ștefan", content: doc("Detalii") });
    await w.topics.create(w.root, { forumId: tree.forum.id, title: "Altceva complet", content: doc("nimic") });
    expect(await topicIds(w.member, "masina")).toEqual([t.topicId]);
    expect(await topicIds(w.member, "mașini")).toEqual([t.topicId]);
  });

  test("căutarea în postări întoarce fragmente cu <mark> și nimic altceva din HTML", async () => {
    const t = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Configuri", content: doc("start") });
    const r = await w.posts.reply(krypt, {
      topicId: t.topicId,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Folosesc crosshair-ul static " },
              { type: "text", text: "<script>alert(1)</script>", marks: [{ type: "bold" }] },
              { type: "text", text: " cu outline", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
            ],
          },
        ],
      },
    });
    const res = await w.search.search(w.member, { q: "crosshair static", type: "posts", page: 1 });
    expect(res.results.map((x) => x.postId)).toEqual([r.postId]);
    const snippet = res.results[0]!.snippet;
    expect(snippet).toContain("<mark>");
    expect(snippet.replace(/<\/?mark>/g, "")).not.toMatch(/<[a-z/]/i);
    expect(res.results[0]).toMatchObject({ topicTitle: "Configuri", author: { name: "Krypt" } });
  });

  test("Review Focus #2: postările ascunse, topicurile în așteptare și forumurile necitibile nu apar", async () => {
    const visible = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Ghid vizibil", content: doc("text") });
    const hidden = await w.topics.create(w.root, { forumId: tree.forum.id, title: "Ghid ascuns", content: doc("text") });
    await w.posts.hide(w.root, hidden.postId);
    const newbie = await w.actorFor(await w.createUser("Nou", "new_member"));
    await w.topics.create(newbie, { forumId: tree.forum.id, title: "Ghid în așteptare", content: doc("text") });
    const sub = await w.topics.create(w.root, { forumId: tree.subforum!.id, title: "Ghid din subforum", content: doc("text") });

    expect((await topicIds(w.member, "ghid")).sort()).toEqual([visible.topicId, sub.topicId].sort());
    await w.groupService.setContainerInherit("forum", String(tree.subforum!.id), { inherits: false, parentId: null }, w.root);
    await w.groupService.setContainerPermissions("forum", String(tree.subforum!.id), {}, w.root);
    expect(await topicIds(w.member, "ghid")).toEqual([visible.topicId]);
  });

  test("filtre: forum (cu subforumuri), autor, dată", async () => {
    const other = await w.forums.create({ parentId: tree.category.id, type: "FORUM", name: "Altul" }, w.root);
    const a = await w.topics.create(w.root, { forumId: tree.subforum!.id, title: "Server nou", content: doc("x") });
    const b = await w.topics.create(krypt, { forumId: other.id, title: "Server vechi", content: doc("x") });

    expect(await topicIds(w.member, "server", { forumId: tree.forum.id })).toEqual([a.topicId]);
    expect(await topicIds(w.member, "server", { authorName: "krypt" })).toEqual([b.topicId]);
    expect(await topicIds(w.member, "server", { since: new Date(Date.now() + 60_000).toISOString() })).toEqual([]);
  });

  test("paginarea și numărul total", async () => {
    await w.settings.set("forums.topics_per_page", 5, w.root);
    for (let i = 0; i < 7; i++) await w.topics.create(w.root, { forumId: tree.forum.id, title: `Turneu ${i}`, content: doc("x") });
    const p2 = await w.search.search(w.member, { q: "turneu", type: "topics", page: 2 });
    expect(p2.results).toHaveLength(2);
    expect(p2.pagination).toEqual({ page: 2, pages: 2, perPage: 5, total: 7 });
  });

  test("interogare prea scurtă → GcsValidationError; prea multe căutări → GcsRateLimited", async () => {
    await expect(w.search.search(w.member, { q: " a ", type: "topics", page: 1 })).rejects.toBeInstanceOf(GcsValidationError);
    for (let i = 0; i < 20; i++) await w.search.search(krypt, { q: "orice", type: "topics", page: 1 });
    await expect(w.search.search(krypt, { q: "orice", type: "topics", page: 1 })).rejects.toBeInstanceOf(GcsRateLimited);
  });
});
