import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { forumTree, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/** Pachetul temei RED-LINE OFFICIAL (construit din `themes/redline-official` cu `node themes/build.mjs`). */
const PACKAGE = path.resolve(__dirname, "../../../themes/redline-official/redline-official.gcs-theme.json");

/** Capturile de ecran ale temei (doar cu `GCS_E2E_SHOTS=<folder>`), pentru verificarea vizuală. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.GCS_E2E_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

const themeCard = (page: Page, name: string) => page.getByTestId("gcs-acp-theme").filter({ has: page.getByRole("heading", { name }) });

/**
 * Pachetele de temă (ACP → Aspect → Teme): adminul încarcă `.gcs-theme.json`, tema apare inactivă, o pornește, iar
 * oricine o alege din subsolul forumului („Tema forumului”); exportul descarcă același pachet. La final tema e ștearsă.
 */
test("adminul importă RED-LINE OFFICIAL din fișier, o pornește și o alege din subsolul forumului", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.71.0");
  const id = uid();
  const email = `pachet-${id}@example.com`;
  await enterAcpAsRoot(page, `Pachet${id}`, email);

  // Importul: tema nouă apare în listă, inactivă.
  await page.goto("/admin/appearance/themes");
  await page.getByTestId("gcs-acp-theme-import-file").setInputFiles(PACKAGE);
  await page.getByRole("button", { name: "Importă tema" }).click();
  const card = themeCard(page, "RED-LINE OFFICIAL");
  await expect(card).toBeVisible();
  await expect(card.getByText("redline-official", { exact: true })).toBeVisible();
  await expect(card.getByLabel("Activă (membrii o pot alege)")).not.toBeChecked();

  // Exportul descarcă pachetul temei.
  const exported = await page.request.get("/api/themes/export?key=redline-official");
  expect(exported.headers()["content-disposition"]).toContain("redline-official.gcs-theme.json");
  const pkg = (await exported.json()) as { format: string; name: string; cssFiles: { name: string }[] };
  expect(pkg.format).toBe("gcs-theme");
  expect(pkg.name).toBe("RED-LINE OFFICIAL");
  expect(pkg.cssFiles.map((f) => f.name)).toEqual(["redline-core.css", "redline-components.css", "redline-pages.css"]);

  // Tema pornită apare în meniul „Tema forumului” din subsol.
  await card.getByLabel("Activă (membrii o pot alege)").check();
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByText("Salvat")).toBeVisible();

  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, email, `Turneu RED-LINE ${id}`, 2);

  await page.goto("/");
  const menu = page.getByTestId("gcs-footer-skin");
  await menu.locator("summary").click();
  await menu.getByRole("button", { name: "RED-LINE OFFICIAL" }).click();
  await expect(page.locator('link[href*="/gcs-theme.css?t=redline-official"]')).toHaveCount(1);
  await expect(page.locator("html")).toHaveClass(/gcs-nova/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gcs-accent").trim())).toBe("#8B3DFF");
  await expect(menu.locator("summary")).toContainText("RED-LINE OFFICIAL");
  await expect(menu).not.toHaveAttribute("open", "");
  await shot(page, "redline-home");

  await page.goto(`/forum/${tree.forum.id}-${tree.forum.slug}`);
  await expect(page.getByText(`Turneu RED-LINE ${id}`).first()).toBeVisible();
  await shot(page, "redline-forum");
  await page.goto(topic.url);
  await expect(page.getByText("Răspunsul 2").first()).toBeVisible();
  await shot(page, "redline-topic");

  // Modul luminos (antetul rămâne închis).
  await page.goto("/");
  await page.locator(".gcs-siteFooter__scheme button[value=light]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await shot(page, "redline-home-light");
  await page.locator(".gcs-siteFooter__scheme button[value=dark]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Pe telefon.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await shot(page, "redline-mobile");
  await page.setViewportSize({ width: 1280, height: 720 });

  // Înapoi la Nova, apoi tema importată e ștearsă.
  await menu.locator("summary").click();
  await menu.getByRole("button", { name: "GCS Nova" }).click();
  await expect(page.locator('link[href*="/gcs-theme.css?t=nova"]')).toHaveCount(1);
  await page.goto("/admin/appearance/themes");
  page.once("dialog", (d) => void d.accept());
  await themeCard(page, "RED-LINE OFFICIAL").getByRole("button", { name: "Șterge" }).click();
  await expect(themeCard(page, "RED-LINE OFFICIAL")).toHaveCount(0);
});
