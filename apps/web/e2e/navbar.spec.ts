import { expect, test } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

/**
 * Header-ul (constructorul de antet, același în orice temă): meniul principal, meniul contului, limba și tema (din
 * subsol: comutatorul lună / soare trece între GCS Dark și GCS White) și sertarul de pe mobil.
 */
test("meniul contului se folosește din tastatură; tema și limba se schimbă din footer și rămân", async ({ page, context }) => {
  await useFreshIp(context, "100.69.0");
  const id = uid();
  await member(page, `Nav${id}`, `nav-${id}@example.com`);
  await page.goto("/");

  const trigger = page.getByTestId("gcs-user-menu");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Meniul contului" });
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("gcs-menu-profile")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(menu.getByTestId("gcs-menu-logout")).toBeVisible();
  await page.keyboard.press("Escape");

  // Subsolul: soarele trece la tema luminoasă a perechii (GCS White), alegerea rămâne după reîncărcare.
  const footer = page.locator(".gcs-siteFooter");
  await footer.getByRole("button", { name: "Luminoasă" }).click();
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css?t=gcs-white"]')).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Limba: meniul din bara de jos a subsolului (designul Nova).
  await footer.getByTestId("gcs-footer-language").evaluate((d) => void ((d as HTMLDetailsElement).open = true));
  await footer.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // Membri e acum un submeniu (buton): eticheta lui e tradusă.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Members" })).toBeVisible();
  const [row] = await sql<{ prefs: { locale?: string; skin?: string } }>(`SELECT prefs FROM users WHERE email = $1`, [`nav-${id}@example.com`]);
  expect(row!.prefs).toMatchObject({ locale: "en", skin: "gcs-white" });
});

test("meniul implicit: Forum, Servere, Clanuri, Activitate, Chat, Membri (cu Staff în submeniu); Clasament și VIP în „Mai mult”", async ({ page, context }) => {
  await useFreshIp(context, "100.69.1");
  await page.setViewportSize({ width: 1600, height: 900 });
  const id = uid();
  await member(page, `Nav2${id}`, `nav2-${id}@example.com`);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav).toHaveAttribute("data-ready", "");
  for (const name of ["Forum", "Clanuri", "Activitate", "Chat"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  // Servere are submeniu (paginile punții, `nav:v6`): e un buton.
  await expect(nav.getByRole("button", { name: "Servere", exact: true })).toBeVisible();
  // Clasament și VIP: pe bară, dacă încap (meniul Nova e mai compact), altfel în „Mai mult”.
  await page.setViewportSize({ width: 1100, height: 900 });
  const more = page.getByTestId("gcs-nav-more");
  for (const name of ["Clasament", "VIP"]) {
    if (await nav.getByRole("link", { name, exact: true }).isVisible()) continue;
    await more.click();
    // Clasament apare și ca item, și în submeniul Membri (ambele în „Mai mult” când nu încap).
    await expect(page.getByRole("menu", { name: "Mai mult" }).getByRole("menuitem", { name }).first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await nav.getByRole("button", { name: "Membri" }).click();
  await expect(page.getByRole("menu", { name: "Membri" }).getByRole("menuitem", { name: "Staff" })).toBeVisible();
});

test("pe mobil (375px), sertarul se deschide și duce la pagini", async ({ page, context }) => {
  await useFreshIp(context, "100.69.2");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeHidden();
  await page.getByTestId("gcs-mobile-nav").click();
  const drawer = page.getByRole("dialog", { name: "Principal" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Membri" }).click();
  await drawer.getByRole("link", { name: "Toți membrii" }).click();
  await expect(page).toHaveURL(/\/members$/);
});

test("antetul compact la derulare: fără tremur la prag (derularea nu sare înapoi; revine la mărimea întreagă abia mai sus)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const header = page.getByTestId("gcs-header-builder");
  await expect(header).toBeVisible();
  test.skip((await header.getAttribute("data-sticky")) === null, "antetul temei nu e lipit sus");
  // Pagina destul de lungă pentru derulare, oricâte forumuri are baza.
  await page.evaluate(() => (document.body.style.minHeight = "3000px"));
  const scrollTo = async (y: number) => {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(500);
    return page.evaluate(() => window.scrollY);
  };
  await scrollTo(0);
  // Peste prag: antetul se strânge, iar derularea rămâne unde a fost (înainte sărea înapoi și antetul se mărea la loc).
  for (const y of [125, 130, 140]) expect(Math.abs((await scrollTo(y)) - y), `derularea la ${y}`).toBeLessThanOrEqual(30);
  await expect(header).toHaveAttribute("data-compact", "");
  // Puțin sub prag: rămâne compact (histerezis); mult mai sus: revine la mărimea întreagă.
  await scrollTo(105);
  await expect(header).toHaveAttribute("data-compact", "");
  await scrollTo(20);
  await expect(header).not.toHaveAttribute("data-compact", "");
});
