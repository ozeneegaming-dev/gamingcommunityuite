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

test("o instalare nouă: antetul de pe preview, consola compactă, cardurile în grilă, fără derulare orizontală pe telefon (GCS Dark și White)", async ({ page, context }) => {
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
    // Prima pagină aleasă de proprietar (varianta A): consola compactă (salutul și serverele, fără cele trei panouri),
    // forumurile în grilă, cu cardurile noi (zona de previzualizare, contoarele pe rândul titlului).
    await expect(page.locator('[data-testid="gcs-cockpit"][data-layout="compact"]')).toBeVisible();
    await expect(page.getByTestId("gcs-cockpit-feed")).toHaveCount(0);
    await expect(page.getByTestId("gcs-forum-index")).toHaveAttribute("data-view", "grid");
    const card = page.locator(".gcs-forumCard").first();
    await expect(card.getByTestId("gcs-forum-card-media")).toBeVisible();
    await expect(card.getByTestId("gcs-forum-stats-btn")).toHaveCount(0);
    if (SHOTS) await page.locator(".gcs-category").first().screenshot({ path: path.join(SHOTS, `new-forum-${skin}-cards.png`) });
    // La derulare: antetul se ascunde în jos și revine compact la o derulare în sus.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -200);
    await shot(page, `forum-${skin}-scrolled`);
    // Logo-ul din crestătura antetului duce la prima pagină (nimic nu-l acoperă).
    await page.goto("/activity");
    await page.locator("a.gcs-hb__logo").filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/activity");
    await page.locator("a.gcs-hb__logo").filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    // Pe telefon, antetul (meniul, logo-ul, „Înregistrare / Autentificare”) încape fără derulare orizontală.
    await shot(page, `forum-${skin}-375`);
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const out = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.getBoundingClientRect().width > 0)
        .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).trim().split(/\s+/).slice(0, 3).join(".")} → ${Math.round(el.getBoundingClientRect().right)}`);
      return { overflow: document.documentElement.scrollWidth - w, out: out.slice(0, 12) };
    });
    expect(wide.overflow, `${skin}: ${wide.out.join(" | ")}`).toBeLessThanOrEqual(0);
  }
});
