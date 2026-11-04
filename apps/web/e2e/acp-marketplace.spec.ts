import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * ACP › Sistem › Marketplace. Instanța principală a testelor nu are licență și nu vorbește cu Data Center-ul
 * (`GCS_LICENSE_SERVER=off`): pagina se deschide din meniu și explică pe loc ce lipsește, cu drumul spre pagina
 * Licență, fără „în curând”. Catalogul, comenzile și plățile le acoperă testele Data Center-ului și cele unitare.
 */
test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.73");
});

test("Marketplace: din meniu, fără licență explică ce lipsește și duce la Licență", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Market${id}`, `market-${id}@example.com`);
  await page.goto("/admin/system/applications");
  await page.getByTestId("gcs-apps-marketplace").click();
  await expect(page).toHaveURL(/\/admin\/system\/marketplace$/);
  await expect(page.getByRole("heading", { name: "Marketplace", level: 1 })).toBeVisible();
  const notice = page.getByTestId("gcs-market-error");
  await expect(notice).toContainText("Site-ul nu are încă o licență");
  await expect(page.getByText("Această secțiune vine într-o etapă următoare")).toHaveCount(0);
  await notice.getByRole("link", { name: "Deschide pagina Licență" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/license$/);
});
