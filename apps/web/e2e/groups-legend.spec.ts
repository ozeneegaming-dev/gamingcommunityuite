import { mkdirSync } from "node:fs";
import path from "node:path";
import { categoryKeyFor } from "@gcs/modules/groups-pro-legend";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, groupId, resetSetting, sql, useFreshIp } from "./helpers";

/**
 * ACP → Membri → Legenda grupurilor (aplicația premium Grupuri Pro): pagina apare doar cu aplicația pornită (meniul și
 * linkul „Setări” din ACP → Aplicații); adminul creează o categorie, trage Admin în ea, trage Moderator sub Admin (grup
 * legat), oprește numărătorile, vede totul în previzualizarea live, salvează și găsește rezultatul în legenda din panoul
 * de statistici al paginii de start. Cu `GCS_E2E_SHOTS=<folder>`, salvează capturi.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

test.describe.configure({ mode: "serial" });

async function flushGroupCaches(): Promise<void> {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    const keys = [...(await redis.keys("gcs:k:groups*")), ...(await redis.keys("gcs:k:setting*"))];
    await redis.del("gcs:k:stats:group-legend", "gcs:k:apps:enabled", "gcs:k:groups-pro:places", ...keys);
  } finally {
    redis.disconnect();
  }
}

async function setGroupsPro(enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ('groups_pro', $1, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [enabled]);
  await flushGroupCaches();
}

/** Legenda implicită: categoriile și opțiunile implicite, Admin în Staff, Moderator în Moderatori, fără părinți și poziții. */
async function resetLegend(): Promise<void> {
  await resetSetting("groups_pro.legend_categories");
  await resetSetting("groups_pro.legend_display");
  await sql(`DELETE FROM group_settings WHERE key IN ('legend.parent', 'legend.position')`);
  await sql(`UPDATE group_settings SET value = '"staff"'::jsonb WHERE key = 'legend.category' AND "groupId" = (SELECT id FROM groups WHERE key = 'admin')`);
  await sql(`UPDATE group_settings SET value = '"moderators"'::jsonb WHERE key = 'legend.category' AND "groupId" = (SELECT id FROM groups WHERE key = 'moderator')`);
  await flushGroupCaches();
}

async function shot(target: Page | Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  await target.screenshot({ path: path.join(SHOTS, `groups-legend-${name}.png`) });
}

/** Tragerea cu mouse-ul (dnd-kit): apasă pe mâner, trece pragul de activare, ajunge pe țintă în pași, eliberează. */
async function drag(page: Page, handle: Locator, target: Locator): Promise<void> {
  await handle.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 });
  await target.scrollIntoViewIfNeeded();
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2, { steps: 2 });
  await page.mouse.up();
}

/** `inLegend` al grupurilor atinse (salvarea pune în legendă un grup tras într-o categorie); se readuce la final. */
let inLegend: { key: string; inLegend: boolean }[] = [];

test.beforeAll(async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  inLegend = await sql<{ key: string; inLegend: boolean }>(`SELECT key, "inLegend" FROM groups WHERE key IN ('admin', 'moderator')`);
  await resetLegend();
});

test.afterAll(async () => {
  for (const g of inLegend) await sql(`UPDATE groups SET "inLegend" = $2 WHERE key = $1`, [g.key, g.inLegend]).catch(() => {});
  await resetLegend().catch(() => {});
  await setGroupsPro(false).catch(() => {});
});

test("Legenda grupurilor: categorie nouă, grup tras în ea, grup legat, numărători oprite → salvat și văzut pe site", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await useFreshIp(context, "198.18.71");
  const page = await context.newPage();
  const id = uid();
  await enterAcpAsRoot(page, `Leg${id}`, `legend-root-${id}@example.com`);
  const adminId = await groupId("admin");
  const label = `Echipa ${id}`;
  const key = categoryKeyFor(label, ["staff", "moderators", "vip", "members"]);

  await test.step("oprită: pagina nu există, iar ACP → Aplicații n-are linkul „Setări”", async () => {
    await setGroupsPro(false);
    expect((await page.goto("/admin/members/groups-legend"))?.status()).toBe(404);
    await page.goto("/admin/system/applications");
    await expect(page.getByTestId("gcs-app-groups_pro")).toBeVisible();
    await expect(page.getByTestId("gcs-app-settings-groups_pro")).toHaveCount(0);
  });

  await test.step("pornită: „Setări” pe cardul Grupuri Pro duce la pagină, care apare și în meniul Membri", async () => {
    await setGroupsPro(true);
    await page.goto("/admin/system/applications");
    await page.getByTestId("gcs-app-settings-groups_pro").click();
    await expect(page).toHaveURL(/\/admin\/members\/groups-legend$/);
    await expect(page.getByTestId("gcs-legend-editor")).toBeVisible();
    await expect(page.getByTestId("gcs-acp-column").getByRole("link", { name: "Legenda grupurilor" })).toBeVisible();
  });

  await test.step("o categorie nouă, apoi una ștearsă (cu confirmare în pagină)", async () => {
    await page.getByTestId("gcs-legend-cat-new").fill(label);
    await page.getByTestId("gcs-legend-cat-add").click();
    await expect(page.getByTestId(`gcs-legend-cat-${key}`)).toBeVisible();
    await expect(page.getByTestId(`gcs-legend-col-${key}`)).toBeVisible();
    await page.getByTestId("gcs-legend-cat-new").fill("Temporar");
    await page.getByTestId("gcs-legend-cat-add").click();
    await page.getByTestId("gcs-legend-cat-delete-temporar").click();
    const dialog = page.getByRole("dialog", { name: "Ștergi categoria „Temporar”?" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("gcs-legend-cat-delete-confirm").click();
    await expect(page.getByTestId("gcs-legend-cat-temporar")).toHaveCount(0);
    await expect(page.getByTestId("gcs-legend-status")).toHaveText("Modificări nesalvate");
  });

  await test.step("Admin tras în categoria nouă, Moderator tras sub Admin (grup legat)", async () => {
    const column = page.getByTestId(`gcs-legend-col-${key}`);
    await drag(page, page.getByTestId("gcs-legend-drag-admin"), page.getByTestId(`gcs-legend-end-${key}`));
    await expect(column.getByTestId("gcs-legend-group-admin")).toBeVisible();
    await drag(page, page.getByTestId("gcs-legend-drag-moderator"), page.getByTestId(`gcs-legend-into-${adminId}`));
    await expect(column.getByTestId("gcs-legend-group-moderator")).toHaveAttribute("data-parent", String(adminId));
    await shot(page.getByTestId("gcs-legend-board"), "board");
  });

  await test.step("numărătorile oprite; previzualizarea live arată categoria, grupul legat și lipsa numerelor", async () => {
    const preview = page.getByTestId("gcs-legend-preview");
    await expect(preview.getByTestId("gcs-legend-pro-members").first()).toBeVisible();
    await page.getByTestId("gcs-legend-opt-memberCounts").uncheck();
    await page.getByTestId("gcs-legend-opt-onlineCounts").uncheck();
    await page.getByTestId("gcs-legend-columns-2").check({ force: true });
    const card = preview.locator(`[data-category="${key}"]`);
    await expect(card).toContainText(label);
    await expect(card.getByTestId("gcs-legend-pro-row").filter({ hasText: "Admin" })).toBeVisible();
    await expect(preview.getByTestId("gcs-legend-pro-members")).toHaveCount(0);
    await expect(preview.getByTestId("gcs-legend-pro-online")).toHaveCount(0);
    await expect(preview.getByTestId("gcs-legend-pro")).toHaveAttribute("data-columns", "2");
    await card.getByTestId("gcs-legend-pro-toggle").click();
    await expect(card.getByTestId("gcs-legend-pro-menu")).toContainText("Moderator");
    await shot(page, "editor");
  });

  await test.step("salvează: totul e salvat și rămâne după reîncărcare", async () => {
    await page.getByTestId("gcs-legend-save").click();
    await expect(page.getByTestId("gcs-legend-status")).toHaveText("Totul e salvat");
    await page.reload();
    await expect(page.getByTestId(`gcs-legend-col-${key}`).getByTestId("gcs-legend-group-moderator")).toHaveAttribute("data-parent", String(adminId));
    await expect(page.getByTestId("gcs-legend-opt-memberCounts")).not.toBeChecked();
  });

  await test.step("pe site: legenda din panoul de statistici are categoria, Admin cu Moderator legat, fără numărători", async () => {
    await page.goto("/");
    const legend = page.locator('[data-widget="core.statsPanel"] [data-testid="gcs-legend-pro"]:visible');
    await expect(legend).toBeVisible();
    await expect(legend).toHaveAttribute("data-columns", "2");
    const card = legend.locator(`[data-category="${key}"]`);
    await expect(card.locator(".gcs-legendPro__title")).toContainText(label);
    await expect(card.getByTestId("gcs-legend-pro-row").filter({ hasText: "Admin" })).toBeVisible();
    await expect(legend.getByTestId("gcs-legend-pro-members")).toHaveCount(0);
    await expect(legend.getByTestId("gcs-legend-pro-online")).toHaveCount(0);
    // Moderatori a rămas fără grupuri: categoria lipsește.
    await expect(legend.locator('[data-category="moderators"]')).toHaveCount(0);
    await card.getByTestId("gcs-legend-pro-toggle").click();
    await expect(card.getByTestId("gcs-legend-pro-menu")).toContainText("Moderator");
    await shot(page.locator('[data-widget="core.statsPanel"]:visible'), "site");
  });

  await context.close();
});
