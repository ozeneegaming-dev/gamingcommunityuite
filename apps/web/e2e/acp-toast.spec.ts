import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/** Toast-urile din ACP: editoarele confirmă salvarea printr-un toast (host-ul e montat în layout-ul panoului). */
test("ACP: salvarea subsolului arată toast-ul „salvat”, cu butonul de închidere tradus", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.88.31");
  const id = uid();
  await page.goto("/register");
  await enterAcpAsRoot(page, `Toast${id}`, `toast-${id}@example.com`);

  await page.goto("/admin/appearance/footer");
  await expect(page.getByTestId("gcs-footer-editor")).toBeVisible();
  await page.getByTestId("gcs-footer-save").click();

  const toast = page.getByTestId("gcs-toast");
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Subsolul a fost salvat.");
  await expect(page.locator(".gcs-acp .gcs-toastHost")).toHaveCount(1);

  const dir = process.env.GCS_SHOTS_DIR;
  if (dir) {
    await page.waitForTimeout(400); // după animația de intrare
    await page.screenshot({ path: `${dir}/acp-footer-saved-toast.png` });
  }

  await toast.getByRole("button", { name: "Închide notificarea" }).click();
  await expect(toast).toHaveCount(0);

  // Subsolul rămâne implicit pentru celelalte teste (theme-nova pornește de la valorile implicite).
  await page.getByTestId("gcs-footer-reset").click();
  await page.getByRole("dialog").getByTestId("gcs-footer-reset-confirm").click();
  await expect(page.getByTestId("gcs-footer-defaults")).toBeVisible();
  await expect(page.getByTestId("gcs-toast")).toHaveCount(1);
});
