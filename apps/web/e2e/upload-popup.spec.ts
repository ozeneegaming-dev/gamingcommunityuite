import { expect, test, type Locator, type Page } from "@playwright/test";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

/**
 * Popupul de încărcare al sistemului (în locul alegerii goale a browserului): câmpul arată butonul cu iconiță, popupul se
 * deschide, un fișier prea mare sau de alt tip arată eroarea și oprește „Folosește”, iar unul bun arată previzualizarea
 * și verificările, apoi e încărcat (cu progres) și salvat. Pe o pagină din ACP (imaginea de distribuire SEO) și pe una
 * a site-ului (avatarul din Setări → Profil).
 */
const id = Math.random().toString(36).slice(2, 8);
const NAME = `Upl${id}`;
const EMAIL = `upl-${id}@example.com`;

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await useFreshIp(context);
  page = await context.newPage();
  await enterAcpAsRoot(page, NAME, EMAIL);
});

test.afterAll(async () => {
  await resetSetting("seo.share_image");
  await page?.context().close();
});

/** O imagine PNG reală (o captură mică a paginii), decodabilă de browser și de server. */
const png = (w = 96, h = 64) => page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });

/** Deschide popupul câmpului și alege fișierul (alegerea din calculator a popupului). */
async function pick(field: Locator, testId: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<Locator> {
  const dialog = field.getByTestId(`${testId}-dialog`);
  if (!(await dialog.isVisible())) await field.getByTestId(`${testId}-open`).click();
  await expect(dialog).toBeVisible();
  await field.getByTestId(`${testId}-pick`).setInputFiles(file);
  return dialog;
}

test("ACP → SEO: imaginea de distribuire prin popup (prea mare refuzată, cea bună salvată)", async () => {
  await page.goto("/admin/system/seo");
  const field = page.getByTestId("gcs-seo-share-image-file");
  // Câmpul: miniatura, regulile și butonul cu iconiță (nu „Choose File” al browserului).
  await expect(field).toBeVisible();
  await expect(field).toContainText("până la 5 MB");
  const open = field.getByTestId("gcs-seo-share-image-file-open");
  await expect(open.locator("svg")).toBeVisible();
  await expect(field.locator('input[type="file"]')).toHaveCount(0);

  // Peste 5 MB: eroarea mărimii, „Folosește” oprit.
  const big = Buffer.alloc(6 * 1024 * 1024, 0);
  const dialog = await pick(field, "gcs-seo-share-image-file", { name: "mare.png", mimeType: "image/png", buffer: big });
  await expect(dialog.locator('[data-check="errSize"]')).toContainText("limita e 5 MB");
  await expect(field.getByTestId("gcs-seo-share-image-file-use")).toBeDisabled();

  // Imaginea bună: previzualizarea și verificările, apoi „Folosește” o încarcă și devine setarea.
  await pick(field, "gcs-seo-share-image-file", { name: "distribuire.png", mimeType: "image/png", buffer: await png(120, 63) });
  await expect(dialog.locator(".gcs-updialog__pv img")).toBeVisible();
  await expect(dialog.locator('[data-check="okType"]')).toBeVisible();
  await expect(dialog.locator('[data-check="okDims"]')).toContainText("120 × 63 px");
  await expect(dialog.locator('[data-check="okReal"]')).toBeVisible();
  await field.getByTestId("gcs-seo-share-image-file-use").click();
  await expect(dialog).toHaveCount(0);
  // Valoarea setării (JSON: șirul cu adresa fișierului; pe MySQL poate veni ca text).
  await expect.poll(async () => String((await sql<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'seo.share_image'`))[0]?.value ?? "")).toMatch(/\/files\//);
  await page.reload();
  await expect(page.getByTestId("gcs-seo-share-image-file").locator(".gcs-upfield__thumb img")).toHaveAttribute("src", /^\/files\//);
});

test("Site → Setări → Profil: avatarul prin popup (tip greșit refuzat, imaginea bună salvată)", async () => {
  await page.goto("/settings/profile");
  const field = page.getByTestId("gcs-upload-avatar");
  await expect(field).toBeVisible();
  await expect(field.getByTestId("gcs-upload-avatar-open").locator("svg")).toBeVisible();

  // Un fișier text: tipul nu e acceptat, „Folosește” oprit.
  const dialog = await pick(field, "gcs-upload-avatar", { name: "notite.txt", mimeType: "text/plain", buffer: Buffer.from("nu e o imagine") });
  await expect(dialog.locator('[data-check="errType"]')).toContainText("PNG, JPG, WebP, GIF");
  await expect(field.getByTestId("gcs-upload-avatar-use")).toBeDisabled();

  // Imaginea bună: previzualizarea și verificările, apoi încărcarea (avatarul devine WebP 512 × 512).
  await pick(field, "gcs-upload-avatar", { name: "avatar.png", mimeType: "image/png", buffer: await png(80, 80) });
  await expect(dialog.locator(".gcs-updialog__pv img")).toBeVisible();
  await expect(dialog.locator('[data-check="okDims"]')).toContainText("80 × 80 px");
  await field.getByTestId("gcs-upload-avatar-use").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("gcs-settings-avatar").getByTestId("gcs-settings-status")).toHaveText("Salvat.");
  await expect.poll(async () => (await sql<{ image: string | null }>(`SELECT image FROM users WHERE email = $1`, [EMAIL]))[0]?.image ?? null).toEqual(expect.stringMatching(/^\/files\//));
});
