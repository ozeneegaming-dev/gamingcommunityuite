import { expect, test, type Locator, type Page } from "@playwright/test";
import { novaSettings, patchNova, preset, restoreNova } from "./cockpit-fixtures";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/** Adresa imaginii din ultimul strat al fundalului (imaginea antetului), sau `null` fără imagine. */
const imageUrl = (el: Locator) => el.evaluate((n) => /url\("?([^")]+)"?\)/.exec(getComputedStyle(n).backgroundImage)?.[1] ?? null);

async function expectJpeg(page: Page, url: string | null) {
  expect(url, "antetul are imaginea în fundal").not.toBeNull();
  const res = await page.request.get(url!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/jpeg");
}

/**
 * Imaginea antetului (proprietarul, 2026-11-03: „Forja”): imaginea desenată pentru GCS stă în spatele antetului Esports
 * (logo-ul și meniul rămân deasupra), pe tot antetul sau doar pe primul rând, și pe telefon doar dacă tema o lasă.
 */
test("imaginea Forja în spatele antetului Esports: tot antetul, doar rândul de sus, telefonul", async ({ page, context }) => {
  await useFreshIp(context, "100.93.8");
  const saved = await novaSettings();
  try {
    const layout = await preset("esports");
    await patchNova({ header: { layout, art: "forja", image: null, imageArea: "all", imageMobile: true } });
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-image", "all");
    const header = page.getByTestId("gcs-header-builder");
    await expect(header).toHaveAttribute("data-device", "desktop");
    const art = await imageUrl(header);
    expect(art).toContain("header-forja");
    await expectJpeg(page, art);
    // Logo-ul și meniul rămân deasupra imaginii (vizibile, pe locul lor).
    await expect(page.getByTestId("gcs-brand").first()).toBeVisible();
    await expect(page.getByTestId("gcs-hb-nav")).toBeVisible();

    // Doar rândul de sus: antetul își păstrează fundalul, imaginea trece pe primul rând.
    await patchNova({ header: { imageArea: "top" } });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-image", "top");
    expect(await imageUrl(header)).toBeNull();
    expect(await imageUrl(header.locator(":scope > .gcs-hb__row").first())).toContain("header-forja");

    // Pe telefon: implicit și acolo; oprită, antetul de pe telefon rămâne pe fundalul lui.
    await patchNova({ header: { imageArea: "all" } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(header).toHaveAttribute("data-device", "mobile");
    expect(await imageUrl(header)).toContain("header-forja");
    await patchNova({ header: { imageMobile: false } });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-image-mobile", "off");
    await expect(header).toHaveAttribute("data-device", "mobile");
    expect(await imageUrl(header)).toBeNull();

    // Fără imagine: antetul de dinainte.
    await patchNova({ header: { art: "none", imageMobile: true } });
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-image", "off");
    expect(await imageUrl(header)).toBeNull();
  } finally {
    await restoreNova(saved);
  }
});

test("editorul vizual: Antet › Antet desktop alege imaginea inclusă, cu miniaturi, și o arată live", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.93.9");
  const id = uid();
  await enterAcpAsRoot(page, `Art${id}`, `art-${id}@example.com`);
  await page.goto("/admin/theme-editor/gcs-dark");
  await expect(page.getByTestId("gcs-theme-studio")).toBeVisible();
  await page.getByTestId("gcs-studio-nav-header").click();
  await page.getByTestId("gcs-studio-nav-headerDesktop").click();

  const choices = page.getByTestId("gcs-studio-field-header_art");
  await expect(choices.getByRole("radio")).toHaveCount(3);
  await expect(choices.getByRole("radio", { name: "Fără" })).toHaveAttribute("aria-checked", "true");
  // Miniaturile imaginilor incluse (imaginea reală, încărcată).
  const thumb = choices.locator('[data-value="forja"] .gcs-themeStudio__choiceThumb');
  await expectJpeg(page, await imageUrl(thumb));
  await expect(page.getByTestId("gcs-studio-field-header_imageDim")).toBeVisible();
  await expect(page.getByTestId("gcs-studio-image-headerImage")).toBeVisible();

  await choices.getByRole("radio", { name: "Forja" }).click();
  const handle = await page.getByTestId("gcs-studio-preview").elementHandle();
  const frame = (await handle?.contentFrame())!;
  await expect.poll(() => frame.evaluate(() => document.documentElement.getAttribute("data-gcs-header-image"))).toBe("all");
  await expect.poll(() => imageUrl(frame.getByTestId("gcs-header-builder"))).toContain("header-forja");

  // Ieșirea fără salvare: tema publicată rămâne fără imagine.
  await expect(page.getByTestId("gcs-studio-status")).toHaveText("Draft salvat. Vizitatorii văd modificările doar după ce salvezi.");
  await page.getByTestId("gcs-studio-exit").click();
  await page.getByTestId("gcs-studio-exit-discard").click();
  await expect(page).toHaveURL(/\/admin\/appearance\/themes$/);
  expect(await (await page.request.get("/gcs-theme.css?t=gcs-dark")).text()).toContain("--gcs-header-image: none;");
});
