import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

/**
 * Numele simple pe temele luminoase: un membru din grupul Membru (culoarea `#ECEDF1`, textul temei închise) are pe tema
 * luminoasă culoarea textului temei (contrast pe cardurile deschise), iar pe cea închisă culoarea grupului; în ambele
 * designuri (Nova, implicit, și clasic). Cu `GCS_E2E_SHOTS=<folder>`, salvează capturi ale listei de membri.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const CLASSIC = "e2e_classic_names";

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
    `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, 'Clasic nume E2E', false, true, '{"preset":"classic"}'::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
    [CLASSIC],
  );
  await flushThemes();
});

test.afterAll(async () => {
  await sql(`DELETE FROM themes WHERE key = $1`, [CLASSIC]);
  await flushThemes();
});

/** Luminanța relativă a unei culori `rgb(r, g, b)`. */
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
    const s = Number(v) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const colorOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);

test("un membru simplu are numele lizibil pe temele luminoase (Nova și clasic) și culoarea grupului pe cele închise", async ({ browser }) => {
  test.setTimeout(120_000);
  const id = uid();
  const name = `Simplu${id}`;
  const email = `plain-${id}@example.com`;
  const context = await browser.newContext();
  await useFreshIp(context, "100.92.1");
  const page = await context.newPage();
  // Membrul (grupul Membru) se uită la lista membrilor grupului lui.
  await member(page, name, email);
  const groupId = (await sql<{ id: number }>(`SELECT id FROM groups WHERE key = 'member'`))[0]!.id;
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");

  for (const skin of [null, CLASSIC] as const) {
    for (const mode of ["light", "dark"] as const) {
      await context.clearCookies({ name: "gcs-skin" });
      await context.addCookies([
        { name: "gcs-theme", value: mode, domain: url.hostname, path: "/" },
        ...(skin ? [{ name: "gcs-skin", value: skin, domain: url.hostname, path: "/" }] : []),
      ]);
      await page.goto(`/members?group=${groupId}`);
      const link = page.locator("a.gcs-name--member:visible", { hasText: name }).first();
      await expect(link).toBeVisible();
      const color = await colorOf(link);
      const label = `${skin ?? "nova"}/${mode}: ${color}`;
      if (mode === "light") expect(luminance(color), label).toBeLessThan(0.2);
      else expect(color, label).toBe("rgb(236, 237, 241)");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `names-plain-${skin ? "classic" : "nova"}-${mode}.png`) });
    }
  }
  await context.close();
});
