import { expect, test, type Frame, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/** Un PNG 120×40 roșu (logo-ul de test). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

const SAVED = "Draft salvat. Vizitatorii văd modificările doar după ce salvezi.";
const PUBLISHED = "Salvat: tema e publicată pentru toți.";

/** Documentul din iframe-ul previzualizării. */
async function previewFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId("gcs-studio-preview").elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("previzualizarea nu are document");
  return frame;
}

/**
 * Logo-ul temei (specul etapei 5), din editorul vizual deschis din meniul contului („Editor temă”): adminul îl încarcă
 * în draft și îl vede în previzualizare, vizitatorul nu vede nimic până la „Salvează”, apoi îl vede; la final logo-ul
 * e șters și tema revine la starea inițială.
 */
test("adminul încarcă logo-ul din editorul vizual deschis din meniu; vizitatorul îl vede doar după salvare", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.70.0");
  const id = uid();
  await enterAcpAsRoot(page, `Tema${id}`, `tema-${id}@example.com`);

  const visitorContext = await browser.newContext();
  await useFreshIp(visitorContext, "100.70.1");
  const visitor = await visitorContext.newPage();
  await visitor.goto("/");
  await expect(visitor.getByTestId("gcs-brand")).toBeVisible();
  await expect(visitor.getByTestId("gcs-brand-logo")).toHaveCount(0);

  // Meniul contului: „Editor temă” deschide editorul vizual al temei afișate.
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-theme-editor").click();
  await expect(page).toHaveURL(/\/admin\/theme-editor\/default$/);
  await expect(page.getByTestId("gcs-theme-studio")).toBeVisible();
  const status = page.getByTestId("gcs-studio-status");

  // Draft: logo-ul apare în previzualizare (doar pentru admin).
  await page.getByTestId("gcs-studio-nav-logos").click();
  await page.getByTestId("gcs-studio-upload-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(status).toHaveText(SAVED);
  await expect(page.getByTestId("gcs-studio-image-logo").locator("img")).toBeVisible();
  await expect.poll(async () => (await previewFrame(page)).getByTestId("gcs-brand-logo").count()).toBe(1);

  await visitor.reload();
  await expect(visitor.getByTestId("gcs-brand")).toBeVisible();
  await expect(visitor.getByTestId("gcs-brand-logo")).toHaveCount(0);

  // „Salvează” publică tema: vizitatorul vede logo-ul (URL-ul CSS-ului are versiunea nouă).
  await page.getByTestId("gcs-studio-save").click();
  await expect(status).toHaveText(PUBLISHED);
  await visitor.reload();
  await expect(visitor.getByTestId("gcs-brand-logo")).toBeVisible();
  await expect(visitor.locator('link[rel="stylesheet"][href^="/gcs-theme.css"]')).toHaveAttribute("href", /v=\d+/);

  // Revenire: logo-ul șters și salvat (alte teste se bazează pe numele site-ului din header).
  await page.getByTestId("gcs-studio-remove-logo").click();
  await expect(status).toHaveText(SAVED);
  await expect.poll(async () => (await previewFrame(page)).getByTestId("gcs-brand-logo").count()).toBe(0);
  await page.getByTestId("gcs-studio-save").click();
  await expect(status).toHaveText(PUBLISHED);
  await page.getByTestId("gcs-studio-exit").click();
  await expect(page).toHaveURL(/\/admin\/appearance\/themes$/);

  await visitor.reload();
  await expect(visitor.getByTestId("gcs-brand")).toBeVisible();
  await expect(visitor.getByTestId("gcs-brand-logo")).toHaveCount(0);
  await visitorContext.close();
});

test("un membru fără drept ACP nu vede uneltele de editare în meniu", async ({ page, context }) => {
  await useFreshIp(context, "100.70.2");
  const id = uid();
  await member(page, `Fara${id}`, `fara-${id}@example.com`);
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  await expect(page.getByTestId("gcs-menu-settings")).toBeVisible();
  await expect(page.getByTestId("gcs-menu-theme-editor")).toHaveCount(0);
  await expect(page.getByTestId("gcs-menu-page-editor")).toHaveCount(0);
  await expect(page.getByTestId("gcs-menu-acp")).toHaveCount(0);
});
