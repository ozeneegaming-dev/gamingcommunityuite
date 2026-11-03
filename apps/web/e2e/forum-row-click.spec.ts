import { expect, test, type Page } from "@playwright/test";
import { fixture, forumTree, member, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

/**
 * Tot rândul unui forum (și cardul, în grilă) duce în forum, iar linkurile din el (subforumurile) își păstrează
 * destinația; logo-ul din antet duce mereu la prima pagină (și pentru un membru logat, cu clopoțelul și contul în antet).
 */
let tree: Awaited<ReturnType<typeof forumTree>>;
let subName = "";

test.beforeAll(async ({ request }) => {
  tree = await forumTree(request);
  subName = `Subforum clic ${tree.id}`;
  await fixture(request, { action: "forum", parentId: tree.forum.id, type: "FORUM", name: subName });
});

/** Rândul forumului testului și adresa forumului (linkul titlului). */
async function forumRow(page: Page) {
  const row = page
    .locator(".gcs-category")
    .filter({ has: page.getByRole("heading", { name: `Categorie ${tree.id}` }) })
    .getByTestId("gcs-forum-row")
    .first();
  await expect(row).toBeVisible();
  const href = await row.locator(".gcs-forumRow__link").getAttribute("href");
  return { row, href: href! };
}

for (const view of ["rows", "grid"] as const) {
  test(`forumuri (${view === "rows" ? "rânduri" : "grilă"}): click pe zona goală a rândului → forumul; click pe un subforum → subforumul`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await useFreshIp(context, `100.99.${view === "rows" ? 1 : 2}`);
    const host = new URL(test.info().project.use.baseURL ?? "http://localhost:3100").hostname;
    await context.addCookies([{ name: "gcs-forum-view", value: view, domain: host, path: "/" }]);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator(".gcs-forumIndex")).toHaveAttribute("data-view", view);
    let { row, href } = await forumRow(page);
    await row.scrollIntoViewIfNeeded();
    expect(await row.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
    // Colțul de jos din stânga al rândului: nici titlu, nici alt link.
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + box.height - 6);
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await page.goBack();
    ({ row } = await forumRow(page));
    const sub = row.getByTestId("gcs-subforums").getByRole("link", { name: subName });
    const subHref = await sub.getAttribute("href");
    expect(subHref).not.toBe(href);
    await sub.click();
    await expect(page).toHaveURL(new RegExp(`${subHref!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await context.close();
  });
}

test("logo-ul duce la prima pagină: membru logat (clopoțelul și contul în antet), desktop și telefon", async ({ browser }) => {
  const context = await browser.newContext();
  await useFreshIp(context, "100.99.3");
  const page = await context.newPage();
  const id = uid();
  await member(page, `Logo${id}`, `logo-${id}@example.com`, "admin");
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: width < 400 ? 812 : 900 });
    await page.goto("/activity");
    const logo = page.locator("a.gcs-hb__logo").filter({ visible: true }).first();
    await expect(logo).toHaveAttribute("href", "/");
    // Nimic nu acoperă logo-ul: click-ul în centrul lui ajunge la link.
    const box = (await logo.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest("a.gcs-hb__logo"), [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit, `${width}px`).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("gcs-notif-panel")).toBeHidden();
  }
  await context.close();
});
