import { expect, test, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/** Un PNG 120×40 roșu (logo-ul de test). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

const accent = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gcs-accent").trim().toUpperCase());

/**
 * Editorul de temă de pe site (specul etapei 5): adminul schimbă accentul și logo-ul în draft, vizitatorul nu vede
 * nimic până la „Publică”, apoi le vede; la final tema revine la valorile inițiale.
 */
test("adminul schimbă accentul și logo-ul pe site; vizitatorul le vede doar după publicare", async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  await useFreshIp(context, "100.70.0");
  const id = uid();
  await enterAcpAsRoot(page, `Tema${id}`, `tema-${id}@example.com`);

  const visitorContext = await browser.newContext();
  await useFreshIp(visitorContext, "100.70.1");
  const visitor = await visitorContext.newPage();
  await visitor.goto("/");
  const original = await accent(visitor);
  expect(original).toMatch(/^#[0-9A-F]{6}$/);

  await page.goto("/");
  await page.getByTestId("gcs-edit-theme").click();
  const editor = page.getByTestId("gcs-theme-editor");
  await expect(editor).toBeVisible();
  const status = page.getByTestId("gcs-theme-status");

  // Draft: accentul nou și logo-ul (previzualizare doar pentru admin).
  await page.getByTestId("gcs-theme-color-dark-accent").fill("#123456");
  await expect(status).toHaveText("Draft salvat. Doar tu vezi modificările până la publicare.");
  await expect.poll(() => accent(page)).toBe("#123456");
  await page.getByTestId("gcs-theme-upload-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("gcs-brand-logo")).toBeVisible();
  await expect(page.getByTestId("gcs-theme-draft-badge")).toBeVisible();

  await visitor.reload();
  expect(await accent(visitor)).toBe(original);
  await expect(visitor.getByTestId("gcs-brand-logo")).toHaveCount(0);

  // Publicare: vizitatorul vede tema nouă (URL-ul CSS-ului are versiunea nouă).
  await page.getByTestId("gcs-theme-publish").click();
  await expect(status).toHaveText("Tema a fost publicată pentru toți.");
  await visitor.reload();
  expect(await accent(visitor)).toBe("#123456");
  await expect(visitor.getByTestId("gcs-brand-logo")).toBeVisible();
  await expect(visitor.locator('link[rel="stylesheet"][href^="/gcs-theme.css"]')).toHaveAttribute("href", /v=\d+/);

  // Revenire la valorile inițiale (alte teste se bazează pe numele site-ului din header).
  await page.getByTestId("gcs-theme-color-dark-accent").fill(original.toLowerCase());
  await expect(status).toHaveText("Draft salvat. Doar tu vezi modificările până la publicare.");
  await editor.getByRole("button", { name: "Șterge" }).first().click();
  await expect(page.getByTestId("gcs-brand-logo")).toHaveCount(0);
  await page.getByTestId("gcs-theme-publish").click();
  await expect(status).toHaveText("Tema a fost publicată pentru toți.");
  await page.getByTestId("gcs-theme-editor-close").click();
  await expect(page.getByTestId("gcs-edit-theme")).toBeVisible();

  await visitor.reload();
  expect(await accent(visitor)).toBe(original);
  await expect(visitor.getByTestId("gcs-brand-logo")).toHaveCount(0);
  await visitorContext.close();
});

test("un membru fără drept ACP nu vede bara de editare", async ({ page, context }) => {
  await useFreshIp(context, "100.70.2");
  const id = uid();
  await member(page, `Fara${id}`, `fara-${id}@example.com`);
  await page.goto("/");
  await expect(page.getByTestId("gcs-header-user")).toBeVisible();
  await expect(page.getByTestId("gcs-edit-theme")).toHaveCount(0);
});
