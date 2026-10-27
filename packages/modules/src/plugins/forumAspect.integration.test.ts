import { buildForumAspect } from "@gcs/plugin-sdk/forum-aspect";
import { pluginRegistryKey, type GcsActor } from "@gcs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closePluginServices, createPluginServices, resetPluginWorld, TEST_SIGN } from "../../test/pluginWorld";
import type { GcsServices } from "../services";

/**
 * Pluginul „Aspect forumuri” instalat cap-coadă: taburile din formularul forumului și al categoriei, stilul rândului
 * (iconița, gradientul, eticheta deasupra, fundalul „Doar în dreapta”), moștenirea fundalului, insignele subforumurilor,
 * aspectul unui widget; oprit, totul revine la implicit (valorile rămân), pornit, revine.
 */
const KEY = "gcs.forum_aspect";
const EXT = pluginRegistryKey(KEY);
const OPTS = { plugins: true };

let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
  ({ root, member } = await resetPluginWorld(services, [KEY]));
  const zip = await buildForumAspect({ sign: TEST_SIGN });
  const { id, report } = await services.pluginAdmin.stage(root, { fileName: "gcs.forum_aspect.zip", data: zip });
  expect(report.checks.filter((c) => c.level === "error")).toEqual([]);
  await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY });
}, 180_000);

afterAll(async () => {
  await closePluginServices(services, configDir, [KEY]);
});

async function tree() {
  const { forums } = services;
  const category = await forums.create({ parentId: null, type: "CATEGORY", name: "Gaming" }, root);
  const forum = await forums.create({ parentId: category.id, type: "FORUM", name: "Servere CS2" }, root);
  const sub = await forums.create({ parentId: forum.id, type: "FORUM", name: "Public 128 tick" }, root);
  return { category, forum, sub };
}

const ref = (f: { id: number; type: "CATEGORY" | "FORUM"; parentId: number | null; name: string; slug: string }) => ({ id: f.id, type: f.type, parentId: f.parentId, name: f.name, slug: f.slug });

describe("Aspect forumuri (pluginul instalat)", () => {
  test("taburile, stilul rândului, eticheta deasupra, moștenirea fundalului și insignele; oprit = implicit, pornit = înapoi", async () => {
    const { forumSlots } = services;
    const { category, forum, sub } = await tree();
    expect((await forumSlots.editTabs(forum, OPTS)).map((t) => `${t.extension}:${t.tab.key}`)).toContain(`${EXT}:aspect`);
    expect((await forumSlots.editTabs(category, OPTS)).map((t) => `${t.extension}:${t.tab.key}`)).toContain(`${EXT}:categoryAspect`);

    await forumSlots.saveTab(
      root,
      {
        forumId: forum.id,
        extension: EXT,
        tab: "aspect",
        values: { icon: "icon1", titleGradient: "linear-gradient(90deg, #ff6a3d, #ffd36a)", tag: "Recrutăm", tagColor: "warn", tagPlace: "above", bg: "bg1", bgStyle: "right", veil: "70", veilHover: "55", inherit: "on" },
      },
      OPTS,
    );
    await forumSlots.saveTab(root, { forumId: sub.id, extension: EXT, tab: "aspect", values: { badge: "on", inherit: "on" } }, OPTS);
    await forumSlots.saveTab(root, { forumId: category.id, extension: EXT, tab: "categoryAspect", values: { catBg: "band1", catTitleColor: "#ff6a3d" } }, OPTS);
    await expect(forumSlots.saveTab(member, { forumId: forum.id, extension: EXT, tab: "aspect", values: {} }, OPTS)).rejects.toThrow();

    const index = await forumSlots.list(member, "ro", "index", [ref(category), { ...ref(forum), children: [{ id: sub.id, type: "FORUM", name: sub.name, slug: sub.slug }] }], OPTS);
    const row = index.get(forum.id)!;
    expect(row.style.classes).toEqual(expect.arrayContaining(["gcs-forumRow--iconImage", "gcs-forumRow--image", "gcs-forumRow--image-right"]));
    expect(row.style.vars).toMatchObject({
      "--gcs-forum-icon-image": 'url("/files/icon1")',
      "--gcs-forum-row-image": 'url("/files/bg1")',
      "--gcs-forum-title-fill": "linear-gradient(90deg, #FF6A3D, #FFD36A)",
      "--gcs-forum-row-veil": "70%",
      "--gcs-forum-row-veil-hover": "55%",
    });
    expect(row.title).toEqual([{ kind: "chip", label: "Recrutăm", icon: "fa-solid fa-tag", tone: "warn", id: "tag", place: "above" }]);
    // Insigna subforumului: HTML-ul pluginului (pastila sistemului, tonul „ok”).
    const badge = row.subs[sub.id]?.[0];
    expect(badge).toMatchObject({ kind: "html", plugin: KEY });
    expect(badge && badge.kind === "html" ? badge.html : "").toMatch(/gcs-slotChip gcs-slotTone--ok[^>]*>ON</);
    // Banda categoriei: imaginea și culoarea titlului.
    expect(index.get(category.id)!.style.classes).toContain("gcs-category--image");
    expect(index.get(category.id)!.style.vars["--gcs-forum-title-color"]).toBe("#FF6A3D");

    // Pagina forumului: subforumul fără imagine moștenește fundalul (și stilul) părintelui.
    const page = await forumSlots.list(member, "ro", "forum", [{ ...ref(sub), parentType: "FORUM" }], OPTS);
    expect(page.get(sub.id)!.style.classes).toEqual(expect.arrayContaining(["gcs-forumRow--image", "gcs-forumRow--image-right"]));
    expect(page.get(sub.id)!.style.vars["--gcs-forum-row-image"]).toBe('url("/files/bg1")');

    // Un forum fără nimic salvat rămâne cu aspectul implicit.
    const plain = await services.forums.create({ parentId: category.id, type: "FORUM", name: "Discuții" }, root);
    expect((await forumSlots.list(member, "ro", "index", [ref(plain)], OPTS)).get(plain.id)).toBeUndefined();

    // Oprit: niciun stil, nicio etichetă (valorile rămân în bază); pornit: același aspect.
    await services.pluginAdmin.setEnabled(root, KEY, false);
    await services.plugins.reconcile();
    expect((await forumSlots.list(member, "ro", "index", [ref(forum)], OPTS)).get(forum.id)).toBeUndefined();
    expect(await services.db.forumExtensionData.count({ where: { key: EXT } })).toBe(3);
    await services.pluginAdmin.setEnabled(root, KEY, true);
    await services.plugins.reconcile();
    expect((await forumSlots.list(member, "ro", "index", [ref(forum)], OPTS)).get(forum.id)!.style.vars["--gcs-forum-row-image"]).toBe('url("/files/bg1")');
  }, 120_000);

  test("aspectul unui widget: tabul pluginului, salvat în amplasare, banda cu imaginea, titlul și eticheta", async () => {
    const { widgets } = services;
    await widgets.save(root, "index", [{ zone: "sidebar", type: "core.newMembers", config: { limit: 5 } }]);
    const [placement] = (await widgets.layout("index", root)).sidebar;
    expect((await widgets.editTabs(placement!.config, OPTS)).map((t) => `${t.extension}:${t.tab.key}`)).toEqual([`${EXT}:aspect`]);
    await widgets.saveExtension(root, { placementId: placement!.id, extension: EXT, tab: "aspect", values: { bg: "wbg1", titleColor: "#3ddc97", tag: "Live", tagPlace: "above", tagColor: "ok" } }, OPTS);
    const decor = await widgets.decor((await widgets.placement(placement!.id))!.config, OPTS);
    expect(decor.style.classes).toEqual(expect.arrayContaining(["gcs-widget--image"]));
    expect(decor.style.vars).toMatchObject({ "--gcs-forum-row-image": 'url("/files/wbg1")', "--gcs-forum-title-color": "#3DDC97" });
    expect(decor.title).toEqual([{ kind: "chip", label: "Live", icon: "fa-solid fa-tag", tone: "ok", id: "tag", place: "above" }]);
    expect((await widgets.decor((await widgets.placement(placement!.id))!.config, { plugins: false })).title).toEqual([]);
  }, 60_000);
});
