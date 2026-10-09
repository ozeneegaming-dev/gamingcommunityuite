import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * Capturile ecranelor ACP noi (navigația pe două niveluri și pagina Aplicații), în temele întunecată și luminoasă, pe
 * desktop și la 375 px. Rulează doar la cerere: `GCS_E2E_SHOTS=<folder> … test:e2e acp-screens`.
 */
const OUT = process.env.GCS_E2E_SHOTS;
test.skip(!OUT, "doar la cerere (GCS_E2E_SHOTS)");

async function theme(page: Page, value: "dark" | "light") {
  await page.context().addCookies([{ name: "gcs-acp-theme", value, url: page.url() }]);
  await page.reload();
}

async function shot(page: Page, name: string, full = false) {
  mkdirSync(OUT!, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT!, `${name}.png`), fullPage: full });
}

test("capturi: navigația și pagina Aplicații", async ({ page, context }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.79.0");
  const id = uid();
  await enterAcpAsRoot(page, `Shots${id}`, `shots-${id}@example.com`);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const t of ["dark", "light"] as const) {
    await page.goto("/admin/groups");
    await theme(page, t);
    await expect(page.getByRole("heading", { name: "Grupuri", level: 1 })).toBeVisible();
    await shot(page, `nav-desktop-${t}`);
    await page.goto("/admin/system/applications");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, `apps-desktop-${t}`, true);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  for (const t of ["dark", "light"] as const) {
    await page.goto("/admin/groups");
    await theme(page, t);
    await shot(page, `nav-375-closed-${t}`);
    await page.getByTestId("gcs-acp-menu-toggle").click();
    await expect(page.getByRole("dialog", { name: "Meniul ACP" })).toBeVisible();
    await shot(page, `nav-375-drawer-${t}`);
    await page.keyboard.press("Escape");
    await page.goto("/admin/system/applications");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, `apps-375-${t}`, true);
    // Fără defilare orizontală.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});
