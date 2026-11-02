import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Capturile pentru proprietar (doar cu `GCS_SHOTS_DIR`), pe instanța instalată de `install.spec.ts` cu „Date demo”:
 * exact ce vede o comunitate nouă, ca vizitator. GCS Dark (antetul implicit, cel de pe preview) și GCS White, pe
 * desktop, după derulare (antetul compact) și pe telefon. Doar navigare: nu schimbă nimic pe instanță.
 */
const SHOTS = process.env.GCS_SHOTS_DIR;
test.skip(!SHOTS, "doar la cerere (GCS_SHOTS_DIR)");

async function shot(page: Page, name: string, full = false) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS!, `new-${name}.png`), fullPage: full });
}

test("capturi: forumul unei instalări noi, GCS Dark și GCS White", async ({ page, context }) => {
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
    // La derulare: antetul se ascunde în jos și revine compact la o derulare în sus.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -200);
    await shot(page, `forum-${skin}-scrolled`);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await shot(page, `forum-${skin}-375`);
  }
});
