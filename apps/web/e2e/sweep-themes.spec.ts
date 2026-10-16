import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { sql, useFreshIp } from "./helpers";

/**
 * Sweep-ul butoanelor în orice temă (nu doar în Nova): pe o temă cu designul clasic, stratul de sticlă umple butonul la
 * hover (`background-size` 0% → 100%), cu culoarea dată de temă (`--gcs-sweep`), pe întunecat și pe luminos; cu
 * „reduced motion”, sweep-ul e oprit. Cu `GCS_E2E_SHOTS=<folder>`, salvează capturi ale butonului la hover.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const THEME = "e2e_classic_sweep";

async function flushThemes(): Promise<void> {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    await redis.del("gcs:k:themes:all");
  } finally {
    redis.disconnect();
  }
}

test.beforeAll(async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await sql(
    `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, 'Clasic E2E', false, true, '{"preset":"classic"}'::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
    [THEME],
  );
  await flushThemes();
});

test.afterAll(async () => {
  await sql(`DELETE FROM themes WHERE key = $1`, [THEME]);
  await flushThemes();
});

const look = (btn: Locator) =>
  btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.backgroundSize, image: s.backgroundImage, sweep: s.getPropertyValue("--gcs-sweep").trim() };
  });

/** Primul buton vizibil al paginii de start (vizitator: „Autentificare” / „Înregistrare”). */
const firstButton = (page: Page) => page.locator(".gcs-btn:visible").first();

for (const mode of ["dark", "light"] as const) {
  test(`tema clasică (${mode}): butonul își umple stratul de sticlă la hover`, async ({ page, context }) => {
    await useFreshIp(context, mode === "dark" ? "100.91.1" : "100.91.2");
    const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
    await context.addCookies([
      { name: "gcs-skin", value: THEME, domain: url.hostname, path: "/" },
      { name: "gcs-theme", value: mode, domain: url.hostname, path: "/" },
    ]);
    await page.goto("/");
    // Nu e designul Nova: tema aleasă e cea clasică.
    await expect(page.locator("html")).not.toHaveClass(/gcs-nova/);
    await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", new RegExp(`t=${THEME}`));

    const btn = firstButton(page);
    await expect(btn).toBeVisible();
    const before = await look(btn);
    expect(before.size).toBe("0% 100%");
    expect(before.image).toMatch(/linear-gradient/);
    await btn.hover();
    // Tranziția durează 1,2 s (cu un mic recul la intrare).
    await expect.poll(async () => (await look(btn)).size, { timeout: 3_000 }).toBe("100% 100%");
    const after = await look(btn);
    expect(after.image).toMatch(/linear-gradient/);
    // Culoarea stratului vine din temă: 8% alb pe întunecat, din culoarea textului pe luminos.
    if (mode === "dark") expect(after.sweep).toMatch(/255 255 255 \/ 0\.08|rgba\(255, 255, 255, 0\.08\)/);
    else expect(after.sweep).toContain("color-mix");
    if (SHOTS) await btn.screenshot({ path: path.join(SHOTS, `sweep-classic-${mode}.png`) });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await look(btn)).size, { timeout: 3_000 }).toBe("0% 100%");
  });
}

test("tema clasică, „reduced motion”: sweep-ul e oprit", async ({ page, context }) => {
  await useFreshIp(context, "100.91.3");
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.addCookies([{ name: "gcs-skin", value: THEME, domain: url.hostname, path: "/" }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const btn = firstButton(page);
  await btn.hover();
  expect((await look(btn)).image).toBe("none");
});
