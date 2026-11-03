import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * Meniul contului, compact (macheta aprobată 2026-11-03, în orice temă): pe desktop panoul încape în ecran (derulare
 * internă când nu încape), secțiunile sunt plăci pe 2 coloane, „Staff” e un rând cu submeniu lateral (mouse și
 * tastatură: Enter / → deschid, Escape / ← închid și readuc focusul), avatarul propriu nu deschide hover card-ul peste
 * meniu; pe telefon e o foaie de jos (fundalul estompat, focusul rămâne în ea, trasă în jos se închide), fără scroll
 * orizontal. Un membru fără drepturi nu vede „Staff”. Capturile: `GCS_E2E_SHOTS=<folder>`.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const STAFF_LINKS = ["gcs-menu-moderation", "gcs-menu-theme-editor", "gcs-menu-page-editor", "gcs-menu-acp"];

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Cutia panoului și a listei lui (derularea internă), plus fereastra. */
function geometry(menu: Locator) {
  return menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const list = el.querySelector<HTMLElement>(".gcs-am__scroll")!;
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      vh: window.innerHeight,
      vw: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowY: getComputedStyle(list).overflowY,
      scrolls: list.scrollHeight > list.clientHeight + 1,
    };
  });
}

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test("admin, 1440 × 900: panoul încape în ecran, plăcile pe 2 coloane, submeniul „Staff”, fără hover card pe avatar; 375 px: foaia de jos", async ({ page, context }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.98.1");
  // Ca proprietarul: fără animații, totul apare pe loc.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = uid();
  await enterAcpAsRoot(page, `Meniu${id}`, `am-root-${id}@example.com`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByTestId("gcs-user-menu").click();
  const menu = page.getByTestId("gcs-account-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-variant", "dropdown");
  await expect(menu.getByRole("link", { name: `Meniu${id}` })).toBeVisible();

  // Tot panoul în ecran; lista derulează înăuntru (bara temei).
  const fit = await geometry(menu);
  expect(fit.bottom).toBeLessThanOrEqual(fit.vh);
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.vw);
  expect(fit.overflowY).toBe("auto");

  // Plăcile: 2 coloane (primele două pe același rând).
  const content = menu.getByTestId("gcs-account-section-content");
  expect(await content.locator(".gcs-am__tiles").evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length)).toBe(2);
  const [a, b] = [await content.locator(".gcs-am__tile").nth(0).boundingBox(), await content.locator(".gcs-am__tile").nth(1).boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
  await expect(menu.getByTestId("gcs-account-section-settings").locator(".gcs-am__tiles")).toBeVisible();

  // Avatarul (și numele) propriu nu deschid hover card-ul peste meniu.
  await menu.getByTestId("gcs-account-avatar").hover();
  await page.waitForTimeout(900);
  await expect(page.locator(".gcs-hoverCardLayer")).toHaveCount(0);
  await menu.getByRole("link", { name: `Meniu${id}` }).hover();
  await page.waitForTimeout(900);
  await expect(page.locator(".gcs-hoverCardLayer")).toHaveCount(0);
  await shot(page, "account-menu-1440");

  // „Staff” cu mouse-ul: submeniul lângă panou (spre interiorul ecranului), în ecran, cu toate linkurile staff-ului.
  const row = menu.getByTestId("gcs-account-staff");
  const fly = menu.getByTestId("gcs-account-staff-menu");
  await expect(fly).toBeHidden();
  await row.click();
  await expect(fly).toBeVisible();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  for (const tid of STAFF_LINKS) await expect(fly.getByTestId(tid)).toBeVisible();
  const flyBox = (await fly.boundingBox())!;
  const panelBox = (await menu.boundingBox())!;
  expect(flyBox.x + flyBox.width <= panelBox.x + 1 || flyBox.x >= panelBox.x + panelBox.width - 1).toBe(true);
  expect(flyBox.x).toBeGreaterThanOrEqual(0);
  expect(flyBox.x + flyBox.width).toBeLessThanOrEqual(1440);
  expect(flyBox.y + flyBox.height).toBeLessThanOrEqual(900);
  await shot(page, "account-menu-staff-1440");
  await row.click();
  await expect(fly).toBeHidden();

  // Din tastatură: Enter deschide (focusul pe primul item), săgețile mută focusul, Escape închide doar submeniul și
  // readuce focusul pe rând; → / ← la fel; al doilea Escape închide meniul.
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(fly).toBeVisible();
  const items = fly.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(fly).toBeHidden();
  await expect(row).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(fly).toBeVisible();
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(fly).toBeHidden();
  await expect(row).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Fereastra scundă: panoul rămâne în ecran, lista derulează înăuntru.
  await page.setViewportSize({ width: 1440, height: 440 });
  await page.getByTestId("gcs-user-menu").click();
  await expect(menu).toBeVisible();
  await expect.poll(async () => (await geometry(menu)).bottom).toBeLessThanOrEqual(440);
  expect((await geometry(menu)).scrolls).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Telefonul (375 × 812): foaia de jos, toată în ecran, fără scroll orizontal.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByTestId("gcs-header-builder")).toHaveAttribute("data-device", "mobile");
  await page.getByTestId("gcs-user-menu").click();
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-variant", "sheet");
  await expect(menu).toHaveAttribute("aria-modal", "true");
  await expect.poll(async () => Math.round((await geometry(menu)).bottom)).toBe(812);
  const sheet = await geometry(menu);
  expect(sheet.top).toBeGreaterThan(0);
  expect(sheet.left).toBeGreaterThanOrEqual(0);
  expect(sheet.right).toBeLessThanOrEqual(375);
  expect(sheet.scrollWidth).toBeLessThanOrEqual(375);
  await expect(page.getByTestId("gcs-account-backdrop")).toBeVisible();
  // În foaie, „Staff” se deschide sub rând.
  await menu.getByTestId("gcs-account-staff").click();
  await expect(fly).toBeVisible();
  const inline = (await fly.boundingBox())!;
  expect(inline.x).toBeGreaterThanOrEqual(0);
  expect(inline.x + inline.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, "account-menu-375");
  // Focusul rămâne în foaie (Tab și Shift+Tab).
  for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
  expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+Tab");
  expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // Atingerea fundalului închide foaia.
  await page.mouse.click(187, 20);
  await expect(menu).toBeHidden();

  // Trasă în jos de mâner peste prag: se închide.
  await page.getByTestId("gcs-user-menu").click();
  await expect(menu).toBeVisible();
  const handle = (await menu.locator(".gcs-am__handle").boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60, { steps: 6 });
  await page.mouse.move(x, y + 180, { steps: 6 });
  await page.mouse.up();
  await expect(menu).toBeHidden();

  // Bara de jos („Cont”) deschide meniul prin evenimentul antetului; meniul îl anulează (linkul nu mai navighează).
  const handled = await page.evaluate(() => !window.dispatchEvent(new CustomEvent("gcs:account-open", { cancelable: true })));
  expect(handled).toBe(true);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-variant", "sheet");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("un membru obișnuit nu vede rândul „Staff”", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.98.2");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = uid();
  await member(page, `Simplu${id}`, `am-m-${id}@example.com`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  const menu = page.getByTestId("gcs-account-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("gcs-account-section-content")).toBeVisible();
  await expect(menu.getByTestId("gcs-menu-settings")).toBeVisible();
  await expect(menu.getByTestId("gcs-menu-logout")).toBeVisible();
  await expect(menu.getByTestId("gcs-account-staff")).toHaveCount(0);
  await expect(menu.getByTestId("gcs-account-section-staff")).toHaveCount(0);
  for (const tid of STAFF_LINKS) await expect(page.getByTestId(tid)).toHaveCount(0);
  expect((await geometry(menu)).bottom).toBeLessThanOrEqual(900);
});
