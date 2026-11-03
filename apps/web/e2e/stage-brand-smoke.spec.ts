import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Aspectul livrat implicit, pe instanța instalată de `install.spec.ts` cu „Date demo”: exact ce vede o comunitate nouă,
 * ca vizitator. GCS Dark și GCS White au antetul de pe preview (Esports), contoarele forumului doar la hover și nicio
 * derulare orizontală la 375 px. Cu `GCS_SHOTS_DIR`, și capturile pentru proprietar. Doar navigare: nu schimbă nimic.
 */
const SHOTS = process.env.GCS_SHOTS_DIR;

/**
 * Contrastul WCAG dintre culoarea unui text și fundalul de lângă el: pixelul din marginea stângă a paginii, la mijlocul
 * textului (spațiul lateral al benzii, fără text), citit din captură în browser (fără dependențe în spec).
 */
async function contrastBeside(page: Page, selector: string): Promise<number> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const png = (await page.screenshot({ clip: { x: 4, y: Math.round(box.y + box.height / 2), width: 1, height: 1 } })).toString("base64");
  return page.evaluate(
    async ({ png, selector }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const g = canvas.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const bg = [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      const text = getComputedStyle(document.querySelector(selector)!).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const channel = (x: number) => {
        const v = x / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (c: number[]) => 0.2126 * channel(c[0]!) + 0.7152 * channel(c[1]!) + 0.0722 * channel(c[2]!);
      const [hi, lo] = [lum(bg), lum(text)].sort((a, b) => b - a);
      return (hi! + 0.05) / (lo! + 0.05);
    },
    { png, selector },
  );
}

async function shot(page: Page, name: string, full = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS!, `new-${name}.png`), fullPage: full });
}

test("o instalare nouă: antetul de pe preview, consola compactă, cardurile în grilă, fără derulare orizontală pe telefon (GCS Dark și White)", async ({ page, context }) => {
  test.setTimeout(180_000);
  const host = new URL(test.info().project.use.baseURL ?? "http://localhost:3101").hostname;
  for (const skin of ["gcs-dark", "gcs-white"] as const) {
    await context.clearCookies();
    await context.addCookies([{ name: "gcs-skin", value: skin, domain: host, path: "/" }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".gcs-hb--esports")).toBeVisible();
    // În spatele antetului: imaginea inclusă „Forja” (proprietarul, 2026-11-03), servită din build.
    await expect(page.locator("html")).toHaveAttribute("data-gcs-header-image", "all");
    const art = await page.locator(".gcs-hb--esports").evaluate((n) => /url\("?([^")]+)"?\)/.exec(getComputedStyle(n).backgroundImage)?.[1] ?? null);
    expect(art, `${skin}: imaginea antetului`).toContain("header-forja");
    expect((await page.request.get(art!)).status()).toBe(200);
    await shot(page, `forum-${skin}-desktop`);
    await shot(page, `forum-${skin}-desktop-full`, true);
    // Prima pagină aleasă de proprietar (varianta A): consola compactă (salutul și serverele, fără cele trei panouri),
    // forumurile în grilă, cu cardurile noi (zona de previzualizare, contoarele pe rândul titlului).
    await expect(page.locator('[data-testid="gcs-cockpit"][data-layout="compact"]')).toBeVisible();
    await expect(page.getByTestId("gcs-cockpit-feed")).toHaveCount(0);
    // Salutul se citește pe banda consolei, și pe GCS White (banda închisă nu se mai estompează sub text).
    for (const sel of [".gcs-ck__helloKicker", ".gcs-ck__helloName"]) {
      expect(await contrastBeside(page, sel), `${skin}: contrastul ${sel}`).toBeGreaterThanOrEqual(4.5);
    }
    await expect(page.getByTestId("gcs-forum-index")).toHaveAttribute("data-view", "grid");
    const card = page.locator(".gcs-forumCard").first();
    await expect(card.getByTestId("gcs-forum-card-media")).toBeVisible();
    await expect(card.getByTestId("gcs-forum-stats-btn")).toHaveCount(0);
    if (SHOTS) await page.locator(".gcs-category").first().screenshot({ path: path.join(SHOTS, `new-forum-${skin}-cards.png`) });
    // La derulare: antetul se ascunde în jos și revine compact la o derulare în sus.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -200);
    await shot(page, `forum-${skin}-scrolled`);
    // Logo-ul din crestătura antetului duce la prima pagină (nimic nu-l acoperă).
    await page.goto("/activity");
    await page.locator("a.gcs-hb__logo").filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/activity");
    await page.locator("a.gcs-hb__logo").filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    // Pe telefon, antetul (meniul, logo-ul, „Înregistrare / Autentificare”) încape fără derulare orizontală.
    await shot(page, `forum-${skin}-375`);
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const out = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > w + 0.5 && el.getBoundingClientRect().width > 0)
        .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).trim().split(/\s+/).slice(0, 3).join(".")} → ${Math.round(el.getBoundingClientRect().right)}`);
      return { overflow: document.documentElement.scrollWidth - w, out: out.slice(0, 12) };
    });
    expect(wide.overflow, `${skin}: ${wide.out.join(" | ")}`).toBeLessThanOrEqual(0);
  }
});
