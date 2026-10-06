import { expect, test } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { setPrimaryGroup, sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.40");
});

/** Lista de membri și a staff-ului (specul etapei 5): căutare fără diacritice, filtru pe grup, sortare, grupare pe staff. */
test("căutarea fără diacritice, filtrul pe grup și sortarea după postări", async ({ page }) => {
  const id = uid();
  await member(page, `Ștefănel${id}`, `stef-${id}@example.com`);
  await sql(`UPDATE users SET "postsCount" = 999 WHERE email = $1`, [`stef-${id}@example.com`]);

  await page.goto(`/members?q=stefanel${id}`);
  const cards = page.getByTestId("gcs-member-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(`Ștefănel${id}`);

  // Filtrul pe grup (Membru) și sortarea după postări: el e primul.
  await page.goto("/members");
  await page.getByLabel("Grup").selectOption({ label: "Membru" });
  await page.getByLabel("Ordonează după").selectOption("posts");
  await page.getByRole("button", { name: "Aplică" }).click();
  await expect(page).toHaveURL(/sort=posts/);
  await expect(cards.first()).toContainText(`Ștefănel${id}`);
  expect(await cards.count()).toBeLessThanOrEqual(24);
});

test("staff-ul e grupat pe grupuri; un banat nu are acces la liste", async ({ page, browser }) => {
  const id = uid();
  await member(page, `Moder${id}`, `moder-${id}@example.com`, "moderator");
  await page.goto("/staff");
  await expect(page.locator('[data-testid="gcs-staff-group"][data-group="moderator"]')).toContainText(`Moder${id}`);
  await expect(page.locator('[data-group="member"]')).toHaveCount(0);

  const other = await browser.newContext();
  await useFreshIp(other, "198.18.41");
  const banned = await other.newPage();
  await member(banned, `Banat${id}`, `banat-${id}@example.com`);
  await setPrimaryGroup(`banat-${id}@example.com`, "banned");
  await banned.goto("/members");
  await expect(banned.getByTestId("gcs-members-forbidden")).toBeVisible();
  await other.close();
});
