import { GcsForbidden, GcsValidationError } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createPagesWorld, pageDoc, presetT, type GcsPagesWorld } from "../../test/pagesWorld";
import { GcsActivityStream } from "../community/activity";

let w: GcsPagesWorld;

beforeEach(async () => {
  w = await createPagesWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("arborele de pagini", () => {
  test("foldere și pagini: calea din slug-uri, grupurile, publicarea, meniul și redenumirea folderului", async () => {
    const folder = await w.admin.saveNode(w.root, null, { kind: "folder", parentId: null, title: "Ghiduri servere" });
    const page = await w.admin.saveNode(w.root, null, { kind: "page", parentId: folder.id, title: "Cum intru pe server", inMenu: true });
    expect(page.path).toBe("ghiduri-servere/cum-intru-pe-server");
    expect(await w.db.navItem.count({ where: { href: "/pages/ghiduri-servere/cum-intru-pe-server", appKey: "pages" } })).toBe(1);

    expect(await w.queries.resolve(w.guest, ["ghiduri-servere", "cum-intru-pe-server"])).toMatchObject({ node: { id: page.id }, rest: [] });
    // Un slug ocupat, un părinte care e pagină, un ciclu.
    await expect(w.admin.saveNode(w.root, null, { kind: "page", parentId: folder.id, title: "Cum intru pe server" })).rejects.toMatchObject({ fields: { slug: "taken" } });
    await expect(w.admin.saveNode(w.root, null, { kind: "page", parentId: page.id, title: "Sub pagină" })).rejects.toMatchObject({ fields: { parentId: "invalid_parent" } });
    await expect(w.admin.saveNode(w.root, folder.id, { kind: "folder", parentId: folder.id, title: "Ghiduri servere" })).rejects.toMatchObject({ fields: { parentId: "cycle" } });

    // Redenumirea folderului rescrie calea paginii și linkul din meniu.
    await w.admin.saveNode(w.root, folder.id, { kind: "folder", parentId: null, title: "Ghiduri", slug: "ghiduri" });
    expect(await w.db.pagesNode.findUnique({ where: { id: page.id }, select: { path: true } })).toEqual({ path: "ghiduri/cum-intru-pe-server" });
    expect(await w.db.navItem.count({ where: { href: "/pages/ghiduri/cum-intru-pe-server" } })).toBe(1);

    // Grupurile folderului se aplică paginilor de sub el; o pagină nepublicată o văd doar editorii.
    const staff = (await w.db.group.findUniqueOrThrow({ where: { key: "admin" } })).id;
    await w.admin.saveNode(w.root, folder.id, { kind: "folder", parentId: null, title: "Ghiduri", slug: "ghiduri", viewGroupIds: [staff] });
    expect(await w.queries.resolve(w.member, ["ghiduri", "cum-intru-pe-server"])).toBeNull();
    await w.admin.saveNode(w.root, folder.id, { kind: "folder", parentId: null, title: "Ghiduri", slug: "ghiduri" });
    await w.admin.saveNode(w.root, page.id, { kind: "page", parentId: folder.id, title: "Cum intru pe server", published: false, inMenu: true });
    expect(await w.queries.resolve(w.member, ["ghiduri", "cum-intru-pe-server"])).toBeNull();
    expect(await w.queries.resolve(w.root, ["ghiduri", "cum-intru-pe-server"])).not.toBeNull();
    // Nepublicată → scoasă din meniu.
    expect(await w.db.navItem.count({ where: { appKey: "pages" } })).toBe(0);
    await expect(w.admin.deleteNode(w.root, folder.id)).rejects.toMatchObject({ params: { reason: "not_empty" } });
    await expect(w.admin.saveNode(w.member, null, { kind: "page", parentId: null, title: "Hack" })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("constructorul: conținutul randat, HTML-ul curățat, widget-ul validat; versiunile se pot restaura", async () => {
    const page = await w.admin.saveNode(w.root, null, { kind: "page", parentId: null, title: "Acasă" });
    const layout = (text: string) => ({
      sections: [
        { id: "s1", columns: "2-1", blocks: [[{ id: "c1", type: "content", doc: pageDoc(text) }, { id: "h1", type: "html", html: "<p onclick=x>sigur</p><script>1</script>" }], [{ id: "w1", type: "widget", widget: "clans.top", config: { limit: 3 } }]] },
      ],
    });
    const saved = await w.admin.saveLayout(w.root, page.id, layout("Bun venit"));
    const [c1, h1] = saved.sections[0]!.blocks[0]!;
    expect(c1).toMatchObject({ type: "content", html: "<p>Bun venit</p>" });
    expect(h1).toMatchObject({ type: "html", html: "<p>sigur</p>" });
    await expect(w.admin.saveLayout(w.root, page.id, { sections: [{ id: "s", columns: "1", blocks: [[{ id: "x", type: "widget", widget: "nu.exista" }]] }] })).rejects.toMatchObject({ fields: { "block.x": "invalid_widget" } });

    await w.admin.saveLayout(w.root, page.id, layout("A doua versiune"));
    const revisions = await w.admin.revisions(w.root, page.id);
    expect(revisions).toHaveLength(1);
    await w.admin.restoreRevision(w.root, revisions[0]!.id);
    const view = await w.queries.pageView(w.root, (await w.access.tree()).find((n) => n.id === page.id)!);
    expect(view!.layout.sections[0]!.blocks[0]![0]).toMatchObject({ html: "<p>Bun venit</p>" });
  });

  test("pagina de pornire: a grupului principal, apoi cea aleasă pentru toți, apoi cuprinsul", async () => {
    expect(await w.queries.resolve(w.guest, [])).toBe("directory");
    const all = await w.admin.saveNode(w.root, null, { kind: "page", parentId: null, title: "Pentru toți" });
    await w.settings.set("pages.home_page", all.id, w.root);
    const guestGroup = (await w.db.group.findUniqueOrThrow({ where: { key: "guest" } })).id;
    const guests = await w.admin.saveNode(w.root, null, { kind: "page", parentId: null, title: "Pentru vizitatori", homeGroupIds: [guestGroup] });
    expect(await w.queries.resolve(w.guest, [])).toMatchObject({ node: { id: guests.id } });
    expect(await w.queries.resolve(w.member, [])).toMatchObject({ node: { id: all.id } });
  });
});

describe("bazele de date", () => {
  test("din șablon: baza, câmpurile, categoriile și pagina ei, într-un pas", async () => {
    const { databaseId, path } = await w.guides();
    expect(path).toBe("ghiduri");
    const d = await w.admin.database(w.root, databaseId);
    expect(d).toMatchObject({ name: "Ghiduri", recordLabel: "Ghid", submissions: true, approval: true, template: "guides" });
    expect(d!.fields.map((f) => f.key)).toEqual(["game", "difficulty", "minutes", "video"]);
    expect(d!.categories).toHaveLength(3);
    expect(await w.queries.resolve(w.guest, ["ghiduri"])).toMatchObject({ node: { contentType: "database", databaseId } });
  });

  test("trimiterea unui membru așteaptă aprobarea; staff-ul e anunțat; după aprobare apare în listă, căutare și flux", async () => {
    const { databaseId } = await w.guides();
    const d = (await w.access.database(databaseId))!;
    const author = await w.user("Autorul");
    const mod = await w.user("Moderatorul", "super_moderator");
    const { id, status } = await w.records.create(author, databaseId, { title: "Crosshair perfect în CS2", content: pageDoc("Pașii pentru un crosshair curat."), fields: { game: "opt0", difficulty: "opt1", minutes: "5" } });
    expect(status).toBe("PENDING");
    expect((await w.queries.list(w.guest, d)).records).toEqual([]);
    expect((await w.notifications.list(mod.userId!)).map((n) => n.type)).toContain("pages.submission");
    // Autorul își vede trimiterea; un alt membru nu.
    expect(await w.queries.record(author, d, `${id}-x`)).not.toBeNull();
    expect(await w.queries.record(w.member, d, `${id}-x`)).toBeNull();

    await expect(w.records.review(w.member, id, "approve")).rejects.toBeInstanceOf(GcsForbidden);
    await w.records.review(mod, id, "approve");
    expect((await w.notifications.list(author.userId!)).map((n) => n.type)).toContain("pages.review");
    const listed = (await w.queries.list(w.guest, (await w.access.database(databaseId))!)).records;
    expect(listed.map((r) => r.title)).toEqual(["Crosshair perfect în CS2"]);
    expect(listed[0]!.fields.map((f) => f.key)).toEqual(["game", "difficulty", "minutes"]);
    expect((await w.queries.search(w.guest, { q: "crosshair curat", page: 1, perPage: 10 })).total).toBe(1);
    expect((await w.queries.search(w.guest, { q: "crosshair inexistent", page: 1, perPage: 10 })).total).toBe(0);
    expect((await w.queries.stream(w.guest, { until: null, limit: 5 })).map((e) => e.title)).toEqual(["Crosshair perfect în CS2"]);
    // Filtrul pe câmp.
    expect((await w.queries.list(w.guest, d, { filters: { game: "opt1" } })).records).toEqual([]);
    expect((await w.queries.list(w.guest, d, { filters: { game: "opt0" } })).records).toHaveLength(1);
  });

  test("un câmp obligatoriu lipsă și o categorie străină sunt refuzate", async () => {
    const { databaseId } = await w.admin.createFromPreset(w.root, "configs", presetT);
    const other = await w.guides();
    const cat = await w.db.pagesCategory.findFirstOrThrow({ where: { databaseId: other.databaseId } });
    const author = await w.user("Configul");
    await expect(w.records.create(author, databaseId, { title: "Config bun", categoryId: cat.id })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(w.records.create(author, databaseId, { title: "Config bun" })).rejects.toMatchObject({ fields: { "field.game": "required" } });
  });

  test("comentariile cu mențiuni anunță autorul; aprobarea comentariilor; nota cu stele (nu propria înregistrare)", async () => {
    const { databaseId } = await w.guides();
    const author = await w.user("Scriitorul", "moderator");
    const reader = await w.user("Cititorul");
    const { id } = await w.records.create(author, databaseId, { title: "Ghid de început", content: pageDoc("Text") });
    await w.records.comment(reader, id, pageDoc("Mulțumesc!"));
    expect((await w.notifications.list(author.userId!)).map((n) => n.type)).toContain("pages.comment");
    expect((await w.db.pagesRecord.findUniqueOrThrow({ where: { id } })).commentsCount).toBe(1);

    await w.admin.saveDatabase(w.root, databaseId, { name: "Ghiduri", commentApproval: true });
    const { pending } = await w.records.comment(reader, id, pageDoc("Încă unul"));
    expect(pending).toBe(true);
    expect((await w.queries.comments(w.guest, id)).comments).toHaveLength(1);
    expect((await w.queries.comments(reader, id)).comments).toHaveLength(2);

    await expect(w.ratings.rate(author, "pages.record", String(id), 5)).rejects.toMatchObject({ params: { reason: "own_content" } });
    await w.ratings.rate(reader, "pages.record", String(id), 4);
    expect(await w.db.pagesRecord.findUniqueOrThrow({ where: { id }, select: { ratingAvg: true, ratingCount: true } })).toEqual({ ratingAvg: 4, ratingCount: 1 });
  });

  test("categoria privată: membrul își vede doar propriile înregistrări; editarea păstrează revizii", async () => {
    const { databaseId } = await w.guides();
    const cat = await w.db.pagesCategory.findFirstOrThrow({ where: { databaseId } });
    await w.admin.saveCategory(w.root, databaseId, cat.id, { name: cat.name, private: true });
    await w.admin.saveDatabase(w.root, databaseId, { name: "Ghiduri", approval: false });
    const a = await w.user("Ana");
    const b = await w.user("Bogdan");
    const { id } = await w.records.create(a, databaseId, { title: "Cererea Anei", categoryId: cat.id });
    const d = (await w.access.database(databaseId))!;
    expect((await w.queries.list(a, d)).records.map((r) => r.id)).toEqual([id]);
    expect((await w.queries.list(b, d)).records).toEqual([]);
    expect(await w.queries.canViewRecord(b, id)).toBe(false);

    await w.records.update(a, id, { title: "Cererea Anei (corectată)", categoryId: cat.id });
    const revisions = await w.queries.revisions(w.root, id);
    expect(revisions.map((r) => r.title)).toEqual(["Cererea Anei"]);
    await w.records.restoreRevision(w.root, revisions[0]!.id);
    expect((await w.db.pagesRecord.findUniqueOrThrow({ where: { id } })).title).toBe("Cererea Anei");
  });

  test("fluxul de activitate amestecă înregistrările (tipul `app`) cu forumul și le parcurge pe cursor fără dubluri", async () => {
    const { databaseId } = await w.guides();
    await w.admin.saveDatabase(w.root, databaseId, { name: "Ghiduri", approval: false });
    for (let i = 1; i <= 3; i++) await w.records.create(w.root, databaseId, { title: `Ghidul ${i}`, content: pageDoc(`Text ${i}`) });
    const social = { ignoredIds: async () => [] as string[] };
    const stream = new GcsActivityStream({ db: w.db, cache: w.cache, permissions: w.permissions, social, sources: w.sources });
    const first = await stream.page(w.guest, { limit: 2 });
    const second = await stream.page(w.guest, { limit: 2, before: first.next });
    const titles = [...first.items, ...second.items].flatMap((i) => (i.kind === "app" ? [i.title] : []));
    expect(titles).toEqual(["Ghidul 3", "Ghidul 2", "Ghidul 1"]);
    // „Topicuri” nu arată elementele aplicațiilor.
    expect((await stream.page(w.guest, { filter: "topics" })).items.some((i) => i.kind === "app")).toBe(false);
  });

  test("exportul și importul unei baze: câmpurile, categoriile și înregistrările ajung într-o bază nouă", async () => {
    const { databaseId } = await w.guides();
    await w.admin.saveDatabase(w.root, databaseId, { name: "Ghiduri", approval: false });
    await w.records.create(w.root, databaseId, { title: "Primul ghid", content: pageDoc("Conținut") });
    const pkg = await w.admin.exportDatabase(w.root, databaseId, true);
    const imported = await w.admin.importDatabase(w.root, JSON.parse(JSON.stringify(pkg)));
    expect(imported).toMatchObject({ path: "ghiduri-2", records: 1 });
    expect(await w.db.pagesCategory.count({ where: { databaseId: imported.databaseId } })).toBe(3);
    await expect(w.admin.importDatabase(w.root, { format: "altceva" })).rejects.toMatchObject({ fields: { file: "invalid_package" } });
  });
});
