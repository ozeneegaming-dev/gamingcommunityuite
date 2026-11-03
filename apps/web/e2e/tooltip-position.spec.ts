import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type ElementHandle, type Locator, type Page } from "@playwright/test";
import { forumTree, topicWithReplies, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

/**
 * Tooltip-ul sistemului apare LÂNGĂ elementul lui (și cu „animații reduse” în sistem, unde corecția poziției dubla
 * coordonatele), e mai deschis decât pagina pe tema închisă, cu text lizibil în ambele teme, și nu iese din ecran pe
 * telefon. Banda „Sus / Jos” stă întreagă în ecran: în marginea conținutului când are loc, altfel andocată jos.
 * Capturile: `GCS_E2E_SHOTS=<folder>`.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
/** Distanța maximă dintre bulă și element (spațiul dintre ele e de 10 px). */
const NEAR = 16;

let topicUrl = "";
let categoryName = "";

test.beforeAll(async ({ request }) => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const id = uid();
  // Membri noi (rândurile „s-a alăturat comunității” din Activitate) și un topic lung (derularea pentru bandă).
  for (const n of ["Ana", "Bogdan", "Cris"]) {
    await sql(
      `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
      [`e2etip${n}${id}`, `${n}${id}`, `${n.toLowerCase()}${id}`, `tip-${n.toLowerCase()}-${id}@example.com`],
    );
  }
  const tree = await forumTree(request);
  categoryName = `Categorie ${tree.id}`;
  topicUrl = (await topicWithReplies(request, tree.forum.id, `tip-ana-${id}@example.com`, `Topic tooltip ${id}`, 14)).url;
});

async function guest(browser: Browser, opts: { width: number; height?: number; motion: "reduce" | "no-preference"; light?: boolean; ip: string }) {
  const context = await browser.newContext({ reducedMotion: opts.motion, viewport: { width: opts.width, height: opts.height ?? (opts.width < 400 ? 812 : 900) } });
  await useFreshIp(context, opts.ip);
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.addCookies([
    { name: "gcs-skin", value: opts.light ? "gcs-white" : "gcs-dark", domain: url.hostname, path: "/" },
    // Butonul statisticilor e al vederii pe rânduri (în grilă, contoarele stau pe rândul titlului cardului).
    { name: "gcs-forum-view", value: "rows", domain: url.hostname, path: "/" },
  ]);
  return { context, page: await context.newPage() };
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Pagina s-a așezat: derularea, înălțimea paginii și elementul nu s-au mai mișcat aproape o secundă (conținutul care
 * se încarcă după pagină o mai lungește, iar browserul ține derularea pe loc; o derulare închide tooltip-ul, intenționat).
 */
async function settled(el: ElementHandle<Element>) {
  await el.scrollIntoViewIfNeeded();
  const seen: string[] = [];
  await expect
    .poll(async () => {
      seen.push(await el.evaluate((n) => `${window.scrollY}:${document.documentElement.scrollHeight}:${n.getBoundingClientRect().y}`));
      return seen.length >= 3 && seen.slice(-3).every((s) => s === seen.at(-1));
    }, { intervals: [400] })
    .toBe(true);
}

/**
 * Bula afișată pentru element, după animația de intrare (opacă și nemișcată între două cadre), cu dreptunghiurile
 * bulei și ale elementului măsurate în același cadru. Elementul se fixează ÎNAINTE de hover: tooltip-ul îi mută
 * `title`-ul în `data-gcs-title`, iar un locator după `[title]` ar trece apoi la elementul următor.
 */
async function hoverTip(page: Page, target: Locator) {
  const anchor = (await target.elementHandle())!;
  const text = (await anchor.getAttribute("data-tip")) ?? (await anchor.getAttribute("title"));
  await settled(anchor);
  const visible = page.getByRole("tooltip").filter({ visible: true });
  const tip = visible.first();
  // O derulare întârziată închide bula (intenționat): mouse-ul pleacă și revine, ca un vizitator.
  await expect(async () => {
    await page.mouse.move(1, 1);
    await anchor.hover();
    await expect(tip).toHaveText(text!, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(visible).toHaveCount(1);
  let rects: { ok: boolean; box: Rect; anchor: Rect } | undefined;
  await expect
    .poll(async () => {
      rects = await tip.evaluate(
        (el, a) =>
          new Promise<{ ok: boolean; box: Rect; anchor: Rect }>((resolve) => {
            const r = (n: Element) => {
              const b = n.getBoundingClientRect();
              return { x: b.x, y: b.y, width: b.width, height: b.height };
            };
            const first = r(el);
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const box = r(el);
                const opacity = getComputedStyle(el).opacity;
                resolve({ ok: opacity === "1" && box.x === first.x && box.y === first.y, box, anchor: r(a as Element) });
              }),
            );
          }),
        anchor,
      );
      return rects.ok;
    }, { message: "bula se așază: opacă și nemișcată între două cadre" })
    .toBe(true);
  return { tip, box: rects!.box, anchor: rects!.anchor };
}

/** Bula e lângă element: deasupra sau dedesubt la cel mult `NEAR` px, cu centrul elementului în dreptul ei. */
function expectNear(box: Rect, anchor: Rect) {
  const where = `bula la ${JSON.stringify(box)}, elementul la ${JSON.stringify(anchor)}`;
  const gap = box.y + box.height <= anchor.y ? anchor.y - (box.y + box.height) : box.y - (anchor.y + anchor.height);
  expect(gap, where).toBeGreaterThanOrEqual(0);
  expect(gap, where).toBeLessThanOrEqual(NEAR);
  const cx = anchor.x + anchor.width / 2;
  expect(cx, where).toBeGreaterThanOrEqual(box.x);
  expect(cx, where).toBeLessThanOrEqual(box.x + box.width);
}

/** Luminanța relativă (WCAG) a unei culori calculate (`rgb()` sau `color(srgb …)`, cum o dă `color-mix`). */
function luminance(css: string): number {
  const n = (css.match(/[\d.]+/g) ?? []).map(Number);
  const c = css.startsWith("color(") ? n.slice(0, 3) : n.slice(0, 3).map((v) => v / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** Culoarea unui token al temei, calculată pe pagină. */
const token = (page: Page, name: string) =>
  page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${v})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  }, name);

for (const motion of ["reduce", "no-preference"] as const) {
  test(`Activitate (animații ${motion === "reduce" ? "reduse" : "normale"}): tooltip-urile apar lângă element, mai deschise decât pagina`, async ({ browser }) => {
    const { context, page } = await guest(browser, { width: 1440, motion, ip: motion === "reduce" ? "100.96.1" : "100.96.2" });
    await page.goto("/activity");
    const kinds = page.locator(".gcs-stream__kind");
    await expect(kinds.first()).toBeVisible();
    // Mai multe rânduri la rând (bula precedentă dispare, următoarea se așază de la zero).
    for (let i = 0; i < Math.min(3, await kinds.count()); i++) {
      const { box, anchor } = await hoverTip(page, kinds.nth(i));
      expectNear(box, anchor);
    }
    const time = await hoverTip(page, page.locator(".gcs-stream time").first());
    expectNear(time.box, time.anchor);
    const { tip, box, anchor } = await hoverTip(page, kinds.first());
    expectNear(box, anchor);
    // Mai deschis decât pagina și decât cardurile; textul alb are contrast ≥ 7:1.
    const bg = await tip.evaluate((el) => getComputedStyle(el).backgroundColor);
    const fg = await tip.evaluate((el) => getComputedStyle(el).color);
    expect(luminance(bg)).toBeGreaterThan(luminance(await token(page, "--gcs-surface")));
    expect(contrast(bg, await token(page, "--gcs-bg"))).toBeGreaterThan(1.6);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(7);
    if (motion === "reduce") await shot(page, "tooltip-activity-dark-1440");
    await context.close();
  });
}

test("tema luminoasă: tooltip-ul lângă element, text lizibil", async ({ browser }) => {
  const { context, page } = await guest(browser, { width: 1440, motion: "reduce", light: true, ip: "100.96.3" });
  await page.goto("/activity");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const { tip, box, anchor } = await hoverTip(page, page.locator(".gcs-stream__kind").first());
  expectNear(box, anchor);
  const bg = await tip.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(contrast(await tip.evaluate((el) => getComputedStyle(el).color), bg)).toBeGreaterThanOrEqual(7);
  expect(contrast(bg, await token(page, "--gcs-bg"))).toBeGreaterThan(3);
  await shot(page, "tooltip-activity-light-1440");
  await context.close();
});

for (const width of [1440, 375]) {
  test(`statisticile forumului pe rânduri (${width} px): bula de pe primul rând e în stratul tooltip-urilor, întreagă și lângă buton`, async ({ browser }) => {
    const { context, page } = await guest(browser, { width, motion: "reduce", ip: `100.96.${width === 375 ? 30 : 31}` });
    await page.goto("/");
    await expect(page.locator(".gcs-forumIndex")).toHaveAttribute("data-view", "rows");
    const card = page.locator(".gcs-category").filter({ has: page.getByRole("heading", { name: categoryName }) }).getByTestId("gcs-forum-row").first();
    const btn = (await card.getByTestId("gcs-forum-stats-btn").elementHandle())!;
    await settled(btn);
    await btn.click();
    const bubble = page.getByTestId("gcs-forum-bubble");
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(/[0-9]+ topic/);
    // În `<body>` (nu în rândul sau caseta categoriei, care taie conținutul), întreagă în ecran, lângă buton.
    expect(await bubble.evaluate((el) => el.parentElement === document.body)).toBe(true);
    const box = (await bubble.boundingBox())!;
    const anchor = (await btn.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expectNear(box, anchor);
    await shot(page, `stats-rows-${width}`);
    await page.keyboard.press("Escape");
    await expect(bubble).toBeHidden();
    await context.close();
  });
}

test("telefon (375 px): tooltip-ul și banda „Sus / Jos” stau în ecran, pagina nu se lățește", async ({ browser }) => {
  const { context, page } = await guest(browser, { width: 375, motion: "reduce", ip: "100.96.4" });
  await page.goto("/activity");
  const kinds = page.locator(".gcs-stream__kind");
  for (const target of [kinds.first(), page.locator(".gcs-stream time").first()]) {
    const { box, anchor } = await hoverTip(page, target);
    expectNear(box, anchor);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  await shot(page, "tooltip-activity-dark-375");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // Banda, andocată jos, întreagă; tooltip-ul „Jos” lângă buton.
  await page.goto(topicUrl);
  await page.mouse.wheel(0, 900);
  const rail = page.getByTestId("gcs-scroll-rail");
  await expect(rail).toHaveClass(/gcs-scrollRail--show/);
  await expect(rail).toHaveClass(/gcs-scrollRail--dock/);
  const r = (await rail.boundingBox())!;
  expect(r.x).toBeGreaterThanOrEqual(4);
  expect(r.x + r.width).toBeLessThanOrEqual(375);
  const { box, anchor } = await hoverTip(page, page.getByTestId("gcs-scroll-down"));
  expectNear(box, anchor);
  expect(box.x).toBeGreaterThanOrEqual(0);
  await shot(page, "rail-dark-375");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await context.close();
});

test("banda „Sus / Jos”: în marginea conținutului când are loc, altfel andocată jos; niciodată tăiată sau peste conținut", async ({ browser }) => {
  for (const width of [1920, 1440, 1100]) {
    const { context, page } = await guest(browser, { width, motion: "reduce", ip: `100.96.${10 + width / 10}` });
    await page.goto(topicUrl);
    await page.mouse.wheel(0, 900);
    const rail = page.getByTestId("gcs-scroll-rail");
    await expect(rail).toHaveClass(/gcs-scrollRail--show/);
    const r = (await rail.boundingBox())!;
    const main = (await page.locator(".gcs-siteMain").boundingBox())!;
    const docked = /gcs-scrollRail--dock/.test((await rail.getAttribute("class")) ?? "");
    // Întreagă în ecran.
    expect(r.x).toBeGreaterThanOrEqual(4);
    expect(r.x + r.width).toBeLessThanOrEqual(width);
    // Banda (38 px) + distanța până la conținut (8 px) + marginea față de ecran (8 px).
    if (main.x >= 54) {
      // E loc în margine: lipită de conținut, fără să intre peste el.
      expect(docked, `${width}px`).toBe(false);
      expect(r.x + r.width).toBeLessThanOrEqual(main.x);
      expect(main.x - (r.x + r.width)).toBeLessThanOrEqual(12);
    } else {
      expect(docked, `${width}px`).toBe(true);
    }
    const { box, anchor } = await hoverTip(page, page.getByTestId("gcs-scroll-up"));
    expectNear(box, anchor);
    await shot(page, `rail-dark-${width}`);
    await context.close();
  }
});
