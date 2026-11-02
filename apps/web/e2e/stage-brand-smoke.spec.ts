import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Aspectul livrat implicit, pe instanța instalată de `install.spec.ts` cu „Date demo”: exact ce vede o comunitate nouă,
 * ca vizitator. GCS Dark și GCS White au antetul de pe preview (Esports), contoarele forumului doar la hover și nicio
 * derulare orizontală la 375 px. Cu `GCS_SHOTS_DIR`, și capturile pentru proprietar. Doar navigare: nu schimbă nimic.
 */
const SHOTS = process.env.GCS_SHOTS_DIR;

async function shot(page: Page, name: string, full = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS!, `new-${name}.png`), fullPage: full });
}

test("o instalare nouă: antetul de pe preview, contoarele la hover, fără derulare orizontală pe telefon (GCS Dark și White)", async ({ page, context }) => {
  test.setTimeout(180_000);
  const host = new URL(test.info().project.use.baseURL ?? "http://localhost:3101").hostname;
  for (const skin of ["gcs-dark", "gcs-white"] as const) {
    await context.clearCookies();
    await context.addCookies([{ name: "gcs-skin", value: skin, domain: host, path: "/" }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".gcs-hb--esports")).toBeVisible();
    await shot(page, `forum-${skin}-desktop`);
    await shot(page, `forum-${skin}-desktop-full`, true);
    // Contoarele forumului (topicuri, postări): doar la hover, în bula butonului de statistici.
    const row = page.locator(".gcs-forumRow").first();
    await expect(row.locator(".gcs-forumRow__stats")).toBeHidden();
    await row.hover();
    await expect(row.locator(".gcs-forumRow__bubble")).toBeVisible();
    await page.waitForTimeout(400);
    if (SHOTS) await page.locator(".gcs-category").first().screenshot({ path: path.join(SHOTS, `new-forum-${skin}-hover.png`) });
    await page.mouse.move(0, 0);
    // La derulare: antetul se ascunde în jos și revine compact la o derulare în sus.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -200);
    await shot(page, `forum-${skin}-scrolled`);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // Pe telefon, antetul (meniul, logo-ul, „Înregistrare / Autentificare”) încape fără derulare orizontală.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await shot(page, `forum-${skin}-375`);
  }
});
