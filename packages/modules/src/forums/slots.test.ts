import { GcsForbidden, GcsNotFound, GcsValidationError, type GcsForumExtension, type GcsModule } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createForumWorld, doc, type GcsForumWorld } from "../../test/world";
import { GcsForumSlotService, type GcsSlotNodeRef } from "./slots";
import { FORUM_SLOTS_DEMO_EXTENSION, forumSlotsDemoModule } from "./slotsDemo";

/** O aplicație opțională cu o extensie de forum, ca să verificăm că o aplicație oprită nu contribuie nimic. */
let listCalls = 0;
const appExtension: GcsForumExtension = {
  key: "testapp",
  list: async (_ctx, nodes) => {
    listCalls++;
    return Object.fromEntries(nodes.map((n) => [n.id, { title: [{ kind: "chip" as const, label: "App" }] }]));
  },
};
/** O extensie care moștenește fundalul părintelui și pune insigne pe subforumuri (ca „Aspect forumuri”). */
const inheritExtension: GcsForumExtension = {
  key: "inherit",
  tabs: [
    {
      key: "look",
      labelKey: "x",
      icon: "fa-solid fa-palette",
      fields: [
        { key: "bg", type: "image", labelKey: "x", maxKb: 512, maxSide: 1600, style: { var: "--gcs-forum-row-image" } },
        { key: "badge", type: "text", labelKey: "x", maxLength: 8 },
      ],
    },
  ],
  list: async (_ctx, nodes) =>
    Object.fromEntries(
      nodes.map((n) => [
        n.id,
        {
          ...(n.data.bg === "" && n.parent && typeof n.parent.data.bg === "string" && n.parent.data.bg !== "" ? { style: { vars: { "--gcs-forum-row-image": `url("/files/${n.parent.data.bg}")` } } } : {}),
          subs: Object.fromEntries((n.children ?? []).filter((c) => c.data.badge).map((c) => [c.id, [{ kind: "chip" as const, label: String(c.data.badge), tone: "ok" as const }]])),
        },
      ]),
    ),
};
const inheritModule: GcsModule = { key: "inherit", permissions: [], settings: [], acpMenu: [], eventListeners: [], forumExtensions: [inheritExtension] };
const appModule: GcsModule = { key: "testapp", permissions: [], settings: [], acpMenu: [], eventListeners: [], app: { optional: true, labelKey: "x", icon: "fa-solid fa-x" }, forumExtensions: [appExtension] };

let w: GcsForumWorld;
let slots: GcsForumSlotService;
let disabled: Set<string>;

beforeEach(async () => {
  w = await createForumWorld([forumSlotsDemoModule, appModule, inheritModule]);
  disabled = new Set();
  listCalls = 0;
  slots = new GcsForumSlotService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, apps: { enabledFilter: async () => (key: string) => !disabled.has(key) }, acp: w.acp });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const ref = (f: { id: number; type: GcsSlotNodeRef["type"]; parentId: number | null; name: string; slug: string }): GcsSlotNodeRef => ({ id: f.id, type: f.type, parentId: f.parentId, name: f.name, slug: f.slug });
const OPTS = { plugins: true };

describe("sloturile forumului cu extensia demo (Forum v2)", () => {
  test("tabul demo apare în formular; salvat, rândul primește eticheta, rândul de sub descriere, valoarea și stilul", async () => {
    const { category, forum } = await w.createTree();
    const tabs = await slots.editTabs(forum, OPTS);
    expect(tabs.map((t) => `${t.extension}:${t.tab.key}`)).toContain(`${FORUM_SLOTS_DEMO_EXTENSION}:demo`);
    expect(tabs.find((t) => t.extension === FORUM_SLOTS_DEMO_EXTENSION)!.values).toMatchObject({ enabled: false, badge: "", caps: false });

    await slots.saveTab(w.root, { forumId: forum.id, extension: FORUM_SLOTS_DEMO_EXTENSION, tab: "demo", values: { enabled: "on", badge: "Oficial", note: "Serverul comunității", accent: "#ff6a3d", caps: "on" } }, OPTS);
    await slots.saveTab(w.root, { forumId: category.id, extension: FORUM_SLOTS_DEMO_EXTENSION, tab: "demo", values: { enabled: "on", badge: "Cat" } }, OPTS);
    const topic = await w.topics.create(w.member, { forumId: forum.id, title: "Salut lume", content: doc("Primul") });
    expect(topic.pending).toBe(false);

    const bundles = await slots.list(w.member, "ro", "index", [ref(category), ref(forum)], OPTS);
    const row = bundles.get(forum.id)!;
    expect(row.title).toEqual(expect.arrayContaining([{ kind: "chip", label: "Oficial", icon: "fa-solid fa-flask", tone: "accent", id: "badge" }, { kind: "chip", label: "App" }]));
    expect(row.meta).toEqual([
      { kind: "text", text: "Serverul comunității", icon: "fa-solid fa-circle-info", id: "note" },
      { kind: "stat", label: { key: "forum.slotsDemo.visibleTopics" }, value: 1, icon: "fa-regular fa-comments", id: "slotsdemo-count" },
    ]);
    expect(row.style.classes).toEqual(expect.arrayContaining(["gcs-forumRow--titleCaps", "gcsx-slotsdemo"]));
    expect(row.style.vars).toMatchObject({ "--gcs-forum-color": "#FF6A3D", "--gcsx-slotsdemo-id": String(forum.id) });
    // Banda categoriei: pastila demo calculată pentru categorii.
    expect(bundles.get(category.id)!.header).toEqual([{ kind: "chip", label: { key: "forum.slotsDemo.headerChip" }, icon: "fa-solid fa-flask", tone: "info", id: "slotsdemo-header" }]);
    // Fiecare extensie e apelată o singură dată pentru toată lista.
    expect(listCalls).toBe(1);
  });

  test("pagina forumului și bara topicului; nimic pe un forum unde demo-ul nu e pornit", async () => {
    const { forum, category } = await w.createTree();
    expect((await slots.forumPage(w.member, "ro", ref(forum), OPTS)).items).toEqual([]);
    await slots.saveTab(w.root, { forumId: forum.id, extension: FORUM_SLOTS_DEMO_EXTENSION, tab: "demo", values: { enabled: "on", badge: "Oficial" } }, OPTS);
    const page = await slots.forumPage(w.member, "ro", ref(forum), OPTS);
    expect(page.items).toEqual([
      {
        kind: "card",
        id: "slotsdemo-card",
        icon: "fa-solid fa-flask",
        title: { key: "forum.slotsDemo.cardTitle" },
        body: { key: "forum.slotsDemo.cardBody", params: { name: forum.name } },
        tone: "accent",
        items: [{ kind: "chip", label: "Oficial", tone: "accent" }],
        actions: [{ label: { key: "forum.slotsDemo.cardAction" }, href: `/forum/${forum.id}-${forum.slug}`, icon: "fa-solid fa-arrow-right" }],
      },
    ]);
    const bar = await slots.topicBar(w.member, "ro", ref(forum), { id: 9, title: "x", authorId: null }, OPTS);
    expect(bar.items.map((i) => i.id)).toEqual(["slotsdemo-bar-chip", "slotsdemo-bar-text"]);
    expect((await slots.list(w.member, "ro", "index", [ref(category)], OPTS)).get(category.id)?.header ?? []).toEqual([]);
  });

  test("validarea: câmpurile și regula extensiei („Arată demo-ul” cere o etichetă); drepturile ACP; tabul necunoscut", async () => {
    const { forum } = await w.createTree();
    const save = (values: Record<string, unknown>, actor = w.root, tab = "demo") => slots.saveTab(actor, { forumId: forum.id, extension: FORUM_SLOTS_DEMO_EXTENSION, tab, values }, OPTS);
    await expect(save({ enabled: "on", badge: "" })).rejects.toMatchObject({ fields: { badge: "required" } });
    await expect(save({ badge: "x".repeat(30) })).rejects.toMatchObject({ fields: { badge: "too_long" } });
    await expect(save({ accent: "red" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(save({ badge: "ok" }, w.member)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(save({ badge: "ok" }, w.root, "nope")).rejects.toBeInstanceOf(GcsNotFound);
    // Salvarea unui tab păstrează celelalte valori ale extensiei și intră în jurnal.
    await save({ badge: "Unu", note: "Doi" });
    expect(await save({ badge: "Trei", note: "Doi" })).toMatchObject({ badge: "Trei", note: "Doi" });
    expect(await w.db.auditLog.count({ where: { action: "forum.extension.update", targetId: String(forum.id) } })).toBe(2);
  });

  test("o aplicație oprită nu contribuie; fără pluginuri (modul sigur) rămân doar modulele", async () => {
    const { forum } = await w.createTree();
    disabled.add("testapp");
    const bundles = await slots.list(w.member, "ro", "index", [ref(forum)], OPTS);
    expect(bundles.get(forum.id)?.title ?? []).toEqual([]);
    expect(listCalls).toBe(0);
    expect((await slots.active({ plugins: false })).map((e) => e.def.key)).toEqual(expect.arrayContaining([FORUM_SLOTS_DEMO_EXTENSION]));
  });

  test("Aspect forumuri: nodul primește datele părintelui și ale subforumurilor; insignele merg doar la copiii rândului", async () => {
    const { category, forum, subforum } = await w.createTree({ subforum: true });
    await slots.saveTab(w.root, { forumId: forum.id, extension: "inherit", tab: "look", values: { bg: "bgForum1", badge: "" } }, OPTS);
    await slots.saveTab(w.root, { forumId: subforum!.id, extension: "inherit", tab: "look", values: { bg: "", badge: "ON" } }, OPTS);
    await expect(slots.saveTab(w.root, { forumId: forum.id, extension: "inherit", tab: "look", values: { bg: "../x" } }, OPTS)).rejects.toBeInstanceOf(GcsValidationError);

    // Indexul: rândul forumului are imaginea lui și insigna subforumului din lista lui (nu și a altor forumuri).
    const index = await slots.list(w.member, "ro", "index", [ref(category), { ...ref(forum), children: [{ id: subforum!.id, type: "FORUM", name: subforum!.name, slug: subforum!.slug }, { id: 999_999, type: "FORUM", name: "x", slug: "x" }] }], OPTS);
    expect(index.get(forum.id)!.style.vars["--gcs-forum-row-image"]).toBe('url("/files/bgForum1")');
    expect(index.get(forum.id)!.subs).toEqual({ [subforum!.id]: [{ kind: "chip", label: "ON", tone: "ok" }] });

    // Pagina forumului: subforumul (fără imagine proprie) moștenește fundalul părintelui, care nu e în listă.
    const page = await slots.list(w.member, "ro", "forum", [{ ...ref(subforum!), parentType: "FORUM" }], OPTS);
    expect(page.get(subforum!.id)!.style.vars["--gcs-forum-row-image"]).toBe('url("/files/bgForum1")');
  });

  test("o extensie care aruncă o eroare lasă slotul gol (pagina nu se strică)", async () => {
    const { forum } = await w.createTree();
    const broken: GcsModule = { key: "broken", permissions: [], settings: [], acpMenu: [], eventListeners: [], forumExtensions: [{ key: "broken", list: async () => { throw new Error("boom"); }, style: () => { throw new Error("boom"); } }] };
    w.registry.register(broken);
    try {
      const bundles = await slots.list(w.member, "ro", "index", [ref(forum)], OPTS);
      expect(bundles.get(forum.id)!.title).toEqual([{ kind: "chip", label: "App" }]);
    } finally {
      w.registry.unregister("broken");
    }
  });
});
