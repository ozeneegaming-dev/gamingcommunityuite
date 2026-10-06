import { expect, test, type Locator, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/** Tipurile widget-urilor dintr-o zonă a editorului, în ordine. */
const editorOrder = (zone: Locator) => zone.getByTestId("gcs-edit-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-widget-type")));

/** Pe pagina publică: elementul `a` apare înaintea lui `b` (selectori CSS). */
const before = (page: Page, a: string, b: string) =>
  page.evaluate(([x, y]) => {
    const ea = document.querySelector(x!);
    const eb = document.querySelector(y!);
    return !!ea && !!eb && (ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, [a, b]);

/** „Editor pagină” din meniul contului: pornește modul „Editează pagina” pe pagina curentă. */
async function openPageEditor(page: Page) {
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-page-editor").click();
}

/**
 * Widget-urile paginii principale și modul „Editează pagina” (specul etapei 5): mutare între zone, mutare din
 * tastatură, adăugare, vizibilitate pe grup; vizitatorul vede aranjarea salvată și panoul de statistici.
 * La final, layout-ul implicit revine.
 */
test("adminul aranjează widget-urile; vizitatorul vede aranjarea, fără widget-ul doar pentru staff", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.71.0");
  const id = uid();
  await enterAcpAsRoot(page, `Wid${id}`, `wid-${id}@example.com`);

  await page.goto("/");
  await openPageEditor(page);
  const editor = page.getByTestId("gcs-page-editor");
  await expect(editor).toBeVisible();
  const top = page.getByTestId("gcs-zone-top");
  const sidebar = page.getByTestId("gcs-zone-sidebar");
  const bottom = page.getByTestId("gcs-zone-bottom");
  await expect.poll(() => editorOrder(sidebar)).toEqual(["chat.shoutbox", "forums.recentTopics"]);
  await expect.poll(() => editorOrder(bottom)).toEqual(["core.statsPanel"]);

  // Panoul de statistici în zona de sus (din selectorul de zonă al widget-ului).
  await bottom.locator('[data-widget-type="core.statsPanel"]').getByTestId("gcs-edit-item-zone").selectOption("top");
  await expect.poll(() => editorOrder(top)).toEqual(["core.announcement", "core.statsPanel"]);

  // Mutare din tastatură: panoul urcă deasupra anunțului.
  // Ca un om: ridică (Spațiu), mută (săgeata), lasă (Spațiu), cu o clipă între taste (dnd-kit măsoară zonele după
  // ridicare). Un ciclu care nu mută nimic lasă ordinea neschimbată, deci îl repetăm până apare mutarea.
  const handle = top.locator('[data-widget-type="core.statsPanel"]').getByTestId("gcs-edit-item-handle");
  await expect(async () => {
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(400);
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    expect(await editorOrder(top)).toEqual(["core.statsPanel", "core.announcement"]);
  }).toPass({ timeout: 30_000 });
  await expect.poll(() => editorOrder(top)).toEqual(["core.statsPanel", "core.announcement"]);

  // „Membri noi” jos, pentru toată lumea; „Topicuri promovate” jos, doar pentru Root Admin.
  await page.getByTestId("gcs-widget-add-bottom").click();
  await page.getByTestId("gcs-widget-catalog-bottom").getByRole("listitem").filter({ hasText: "Membri noi" }).click();
  await bottom.getByTestId("gcs-edit-item-panel").getByLabel("Câte elemente").fill("3");
  await page.getByTestId("gcs-widget-add-bottom").click();
  await page.getByTestId("gcs-widget-catalog-bottom").getByRole("listitem").filter({ hasText: "Topicuri promovate" }).click();
  await bottom.locator('[data-widget-type="forums.featuredTopics"]').getByLabel("Root Admin").check();
  await expect.poll(() => editorOrder(bottom)).toEqual(["core.newMembers", "forums.featuredTopics"]);

  await page.getByTestId("gcs-page-editor-save").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a fost salvată.");
  await page.getByTestId("gcs-page-editor-done").click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-zone="bottom"] [data-widget="forums.featuredTopics"]')).toBeVisible();

  // Vizitatorul: Statistici sus, Membri noi jos, fără widget-ul restrâns; ordinea din coloana din dreapta.
  const visitorContext = await browser.newContext();
  await useFreshIp(visitorContext, "100.71.1");
  const visitor = await visitorContext.newPage();
  await visitor.goto("/");
  const panel = visitor.locator('[data-zone="top"] [data-widget="core.statsPanel"]');
  await expect(panel).toBeVisible();
  expect(await before(visitor, '[data-widget="core.statsPanel"]', '[data-widget="core.announcement"]')).toBe(true);
  await expect(visitor.locator('[data-zone="bottom"] [data-widget="core.newMembers"]')).toBeVisible();
  // Limita aleasă (3), sau câți membri are baza, dacă sunt mai puțini.
  const [users] = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM users`);
  await expect(visitor.locator('[data-widget="core.newMembers"] li')).toHaveCount(Math.min(3, Number(users!.n)));
  await expect(visitor.locator('[data-widget="forums.featuredTopics"]')).toHaveCount(0);
  // Panoul: plăcile (cu VIP), „Cine e online”, „Cine a fost online” (adminul tocmai a fost activ) și legenda.
  await expect(panel.locator('[data-tile="forums.topics"]')).toBeVisible();
  await expect(panel.locator('[data-tile="vip.members"]')).toBeVisible();
  await expect(panel.getByTestId("gcs-who-online")).toBeVisible();
  // Lista „Cine a fost online” e păstrată în cache un minut, deci verificăm că apare, nu că îl conține deja pe admin.
  await expect(panel.getByTestId("gcs-online-day-members")).toBeVisible();
  await expect(panel.getByTestId("gcs-legend")).toContainText("Root Admin");
  await visitorContext.close();

  // Layout-ul implicit înapoi (alte teste se bazează pe pagina principală implicită).
  await openPageEditor(page);
  await page.getByTestId("gcs-page-editor-default").click();
  await page.getByTestId("gcs-page-editor-default-confirm").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a revenit la widget-urile implicite.");
  await expect.poll(() => editorOrder(sidebar)).toEqual(["chat.shoutbox", "forums.recentTopics"]);
  await expect.poll(() => editorOrder(bottom)).toEqual(["core.statsPanel"]);
  await page.getByTestId("gcs-page-editor-done").click();
  await expect(editor).toHaveCount(0);
});

/**
 * Lista „Widget-uri disponibile” (fixată în stânga): pornită din meniu de pe o pagină fără widget-uri (editorul se
 * deschide pe pagina principală), căutare, favorite păstrate pe server, adăugare cu „+” și prin tragere, apoi
 * „Termină editarea” salvează și închide. La final, layout-ul implicit revine.
 */
test("lista de widget-uri: căutare, favorite, adăugare cu „+” și prin tragere, „Termină editarea”", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.71.5");
  const id = uid();
  await enterAcpAsRoot(page, `Wl${id}`, `wl-${id}@example.com`);

  // De pe o pagină fără zone de widget-uri, „Editor pagină” duce pe pagina principală, cu editorul pornit.
  await page.goto("/members");
  await openPageEditor(page);
  await expect(page).toHaveURL(/\/$/);
  const editor = page.getByTestId("gcs-page-editor");
  await expect(editor).toBeVisible();
  const list = page.getByTestId("gcs-widget-sidebar");
  await expect(list).toBeVisible();
  // Conținutul paginii se mută la dreapta listei.
  const listBox = (await list.boundingBox())!;
  expect((await editor.boundingBox())!.x).toBeGreaterThanOrEqual(listBox.x + listBox.width);
  for (const zone of ["top", "sidebar", "bottom"]) await expect(page.getByTestId(`gcs-widget-add-${zone}`)).toContainText("Trage widget-urile aici");

  // Căutarea filtrează pe loc (fără diacritice, și în descrieri).
  const card = (key: string, section = "core") => list.locator(`[data-category="${section}"] [data-widget-key="${key}"]`);
  await page.getByTestId("gcs-widget-search").fill("membri");
  await expect(card("core.newMembers")).toBeVisible();
  await expect(list.locator('[data-widget-key="chat.shoutbox"]')).toHaveCount(0);
  await page.getByTestId("gcs-widget-search").fill("zzzz");
  await expect(page.getByTestId("gcs-widget-search-empty")).toBeVisible();
  await page.getByTestId("gcs-widget-search").fill("");
  await expect(list.locator('[data-widget-key="chat.shoutbox"]')).toHaveCount(1);

  // Favorite: steluța pune widget-ul la „Favorite”, iar alegerea rămâne după reîncărcare (salvată pe server).
  const favorites = page.getByTestId("gcs-widget-favorites");
  await card("core.newMembers").getByTestId("gcs-widget-favorite").click();
  await expect(favorites.locator('[data-widget-key="core.newMembers"]')).toBeVisible();
  await expect(card("core.newMembers").getByTestId("gcs-widget-favorite")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await page.reload(), await favorites.locator('[data-widget-key="core.newMembers"]').count()), { timeout: 20_000 }).toBe(1);
  await favorites.locator('[data-widget-key="core.newMembers"]').getByTestId("gcs-widget-favorite").click();
  await expect(favorites.locator('[data-widget-key="core.newMembers"]')).toHaveCount(0);

  // Adăugare din tastatură / cu un clic: „+” și zona.
  const top = page.getByTestId("gcs-zone-top");
  const bottom = page.getByTestId("gcs-zone-bottom");
  await card("core.groupLegend").getByTestId("gcs-widget-card-add").click();
  await card("core.groupLegend").getByTestId("gcs-widget-card-add-bottom").click();
  await expect.poll(() => editorOrder(bottom)).toEqual(["core.statsPanel", "core.groupLegend"]);

  // Prin tragere: din listă pe zona de drop de sus.
  const source = card("core.onlineDay").locator(".gcs-widgetCard__drag");
  const target = page.getByTestId("gcs-widget-add-top");
  await target.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 5 });
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await expect(target).toHaveAttribute("data-state", "over");
  await page.mouse.up();
  await expect.poll(() => editorOrder(top)).toEqual(["core.announcement", "core.onlineDay"]);

  // „Termină editarea” salvează și închide editorul.
  await page.getByTestId("gcs-page-editor-done").click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-zone="bottom"] [data-widget="core.groupLegend"]')).toBeVisible();
  await expect(page.locator('[data-zone="top"] [data-widget="core.onlineDay"]')).toBeVisible();

  // Layout-ul implicit înapoi.
  await openPageEditor(page);
  await page.getByTestId("gcs-page-editor-default").click();
  await page.getByTestId("gcs-page-editor-default-confirm").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a revenit la widget-urile implicite.");
  await expect.poll(() => editorOrder(bottom)).toEqual(["core.statsPanel"]);
  await page.getByTestId("gcs-page-editor-done").click();
  await expect(editor).toHaveCount(0);
});

test("un membru nu vede „Editor pagină” în meniu", async ({ page, context }) => {
  await useFreshIp(context, "100.71.2");
  const id = uid();
  await member(page, `Mw${id}`, `mw-${id}@example.com`);
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  await expect(page.getByTestId("gcs-menu-settings")).toBeVisible();
  await expect(page.getByTestId("gcs-menu-page-editor")).toHaveCount(0);
});
