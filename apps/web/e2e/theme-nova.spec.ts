import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * Tema implicită „GCS Nova” (specul 2026-10-10-tema-nova): designul pe paginile site-ului (nu în ACP), antetul cu
 * rândul breadcrumb + căutare, benzile cu iconița în cerc și subsolul. Cu `GCS_SHOTS_DIR`, salvează și capturi
 * (întunecat / luminos, desktop / 375 px) ale paginilor principale.
 */
test.describe.configure({ mode: "serial" });

const ADMIN = { name: "NovaRoot", email: "nova-root@example.com" };

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.GCS_SHOTS_DIR;
  if (!dir) return;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test("site-ul primește designul Nova; ACP-ul nu", async ({ page, context, request }) => {
  test.setTimeout(240_000);
  await useFreshIp(context);
  await enterAcpAsRoot(page, ADMIN.name, ADMIN.email);
  await fixture(request, { action: "demo", adminEmail: ADMIN.email });

  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/gcs-nova/);
  await expect(page.getByTestId("gcs-crumb-trail")).toBeVisible();
  await expect(page.getByTestId("gcs-crumb-search")).toBeVisible();
  await shot(page, "home-dark-desktop");

  await page.goto("/admin");
  await expect(page.locator("html")).not.toHaveClass(/gcs-nova/);
});
