import { expect, test, type Locator, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/** Tipurile widget-urilor dintr-o zonă a editorului, în ordine. */
const editorOrder = (zone: Locator) => zone.getByTestId("gcs-edit-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-widget-type")));

/** Pe pagina publică: elementul `a` apare înaintea lui `b` (selectori CSS). */
const before = (page: Page, a: string, b: string) =>
  page.evaluate(([x, y]) => {
    const ea = document.querySelector(x!);
    const eb = document.querySelector(y!);
    return !!ea && !!eb && (ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, [a, b]);

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
  await page.getByTestId("gcs-edit-page").click();
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
  await page.getByTestId("gcs-page-editor-exit").click();
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
  await expect(visitor.locator('[data-widget="core.newMembers"] li')).toHaveCount(3);
  await expect(visitor.locator('[data-widget="forums.featuredTopics"]')).toHaveCount(0);
  // Panoul: plăcile (cu VIP), „Cine e online”, „Cine a fost online” (adminul tocmai a fost activ) și legenda.
  await expect(panel.locator('[data-tile="forums.topics"]')).toBeVisible();
  await expect(panel.locator('[data-tile="vip.members"]')).toBeVisible();
  await expect(panel.getByTestId("gcs-who-online")).toBeVisible();
  await expect(panel.getByTestId("gcs-online-day-members")).toContainText(`Wid${id}`);
  await expect(panel.getByTestId("gcs-legend")).toContainText("Root Admin");
  await visitorContext.close();

  // Layout-ul implicit înapoi (alte teste se bazează pe pagina principală implicită).
  await page.getByTestId("gcs-edit-page").click();
  await page.getByTestId("gcs-page-editor-default").click();
  await page.getByTestId("gcs-page-editor-default-confirm").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a revenit la widget-urile implicite.");
  await expect.poll(() => editorOrder(sidebar)).toEqual(["chat.shoutbox", "forums.recentTopics"]);
  await expect.poll(() => editorOrder(bottom)).toEqual(["core.statsPanel"]);
  await page.getByTestId("gcs-page-editor-exit").click();
  await expect(editor).toHaveCount(0);
});

test("un membru nu vede „Editează pagina”", async ({ page, context }) => {
  await useFreshIp(context, "100.71.2");
  const id = uid();
  await member(page, `Mw${id}`, `mw-${id}@example.com`);
  await page.goto("/");
  await expect(page.getByTestId("gcs-header-user")).toBeVisible();
  await expect(page.getByTestId("gcs-edit-page")).toHaveCount(0);
});
