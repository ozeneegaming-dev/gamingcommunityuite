import { expect, test } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

/** Header-ul nou (specul etapei 5): meniul principal, meniul userului, limba și tema (din footer) și sertarul de pe mobil. */
test("meniul userului se folosește din tastatură; tema și limba se schimbă din footer și rămân", async ({ page, context }) => {
  await useFreshIp(context, "100.69.0");
  const id = uid();
  await member(page, `Nav${id}`, `nav-${id}@example.com`);
  await page.goto("/");

  const trigger = page.getByTestId("gcs-user-menu");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Meniul contului" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Profilul meu" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // Tema și limba nu mai sunt în meniul userului, ci în footer.
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: "Ieșire" })).toBeVisible();
  await expect(menu.getByText("Luminoasă")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const footer = page.locator(".gcs-siteFooter");
  await footer.getByRole("button", { name: "Luminoasă" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await footer.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Members" })).toBeVisible();
  const [row] = await sql<{ prefs: { locale?: string; theme?: string } }>(`SELECT prefs FROM users WHERE email = $1`, [`nav-${id}@example.com`]);
  expect(row!.prefs).toMatchObject({ locale: "en", theme: "light" });
});

test("un item de meniu vizibil doar pentru staff nu apare unui membru; meniul implicit are Forum, Chat, Membri, Staff", async ({ page, context }) => {
  await useFreshIp(context, "100.69.1");
  const id = uid();
  await member(page, `Nav2${id}`, `nav2-${id}@example.com`);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" });
  for (const name of ["Forum", "Chat", "Membri", "Staff"]) await expect(nav.getByRole("link", { name })).toBeVisible();
});

test("pe mobil (375px), sertarul se deschide și duce la pagini", async ({ page, context }) => {
  await useFreshIp(context, "100.69.2");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeHidden();
  await page.getByTestId("gcs-mobile-nav").click();
  const drawer = page.getByRole("dialog", { name: "Principal" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Membri" }).click();
  await expect(page).toHaveURL(/\/members$/);
});
