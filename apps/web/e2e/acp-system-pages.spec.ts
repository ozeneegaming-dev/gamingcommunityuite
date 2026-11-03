import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";
import { e2eKv } from "./kv";

/**
 * ACP › Sistem: paginile care erau „în curând”. Stare sistem (serviciile, un job picat apare ca problemă, alertele se
 * salvează, „Rulează acum” intră în jurnal), Cache (o zonă nouă apare și se golește) și Fișiere (filtrul, panoul cu
 * „Folosit în”, ștergerea din panou și ștergerea în masă). Capturile: `GCS_SHOTS_DIR`.
 */
const SHOTS = process.env.GCS_SHOTS_DIR ?? "";
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

const COMING_SOON = "Această secțiune vine într-o etapă următoare";
/** Momentul de acum în UTC, fără fus (coloanele `timestamp` ale bazei sunt în UTC). */
const utcNow = () => new Date().toISOString().replace("T", " ").replace("Z", "");

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.71");
});

test("Stare sistem: serviciile, un job picat, alertele și „Rulează acum”", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Stare${id}`, `stare-${id}@example.com`);
  const kv = await e2eKv();
  try {
    await kv.hset("gcs:jobs:stats", "uploads.orphans", JSON.stringify({ lastStartAt: Date.now() - 60_000, lastOkAt: null, lastErrorAt: Date.now() - 59_000, lastError: "disc E2E", durationMs: 1000, runs: 1, failures: 1 }));
    await page.goto("/admin/system/status");
    await expect(page.getByRole("heading", { name: "Stare sistem", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-status-services").locator('[data-service="db"] [data-level]')).toHaveAttribute("data-level", "ok");
    await expect(page.getByTestId("gcs-status-services").locator('[data-service="kv"] [data-level]')).toHaveAttribute("data-level", "ok");
    const failed = page.locator('[data-testid="gcs-status-job"][data-job="uploads.orphans"]');
    await expect(failed.locator("[data-level]")).toHaveAttribute("data-level", "down");
    await expect(failed).toContainText("disc E2E");
    await expect(page.getByTestId("gcs-status-summary")).toContainText("problem");
    await shot(page, "status-1");

    // Alertele: pragul discului și repetarea se salvează și apar în rezumat.
    await page.getByTestId("gcs-status-alerts-open").click();
    const panel = page.getByTestId("gcs-status-alerts");
    await panel.getByLabel("Prag spațiu liber (%)").fill("17");
    await panel.getByLabel("Repetă alerta după (ore)").fill("12");
    await panel.getByRole("button", { name: "Salvează" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("gcs-status-alerts-summary")).toContainText("17%");
    await expect(page.getByTestId("gcs-status-alerts-summary")).toContainText("12 h");

    // „Rulează acum” pune jobul în coadă și scrie în jurnalul ACP.
    await failed.getByRole("button", { name: "Rulează acum" }).click();
    await expect.poll(async () => (await sql(`SELECT 1 FROM audit_logs WHERE action = 'system.job_run' AND "targetId" = 'uploads.orphans'`)).length).toBeGreaterThan(0);
  } finally {
    await kv.del("gcs:jobs:stats");
    kv.disconnect();
    await resetSetting("system.status_alerts");
  }
});

test("Cache: o zonă nouă apare cu cheile ei și se golește", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Cache${id}`, `cache-${id}@example.com`);
  const area = `e2e${id}`.toLowerCase();
  const kv = await e2eKv();
  try {
    await kv.set(`gcs:k:${area}:a`, "1", "EX", 600);
    await kv.set(`gcs:k:${area}:b`, "2", "EX", 600);
    await page.goto("/admin/system/cache");
    await expect(page.getByRole("heading", { name: "Cache", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    const row = page.locator(`[data-area="${area}"]`);
    await expect(row).toContainText("2 chei");
    await shot(page, "cache-1");
    await row.getByRole("button", { name: "Golește" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("gcs-cache-log")).toContainText(`Zona ${area}`);
    expect(await kv.get(`gcs:k:${area}:a`)).toBeNull();
  } finally {
    await kv.del(`gcs:k:${area}:a`, `gcs:k:${area}:b`);
    kv.disconnect();
  }
});

test("Fișiere: filtrul, panoul cu „Folosit în”, ștergerea din panou și în masă", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Fis${id}`, `fis-${id}@example.com`);
  const rows = [
    { id: `e2e${randomBytes(6).toString("hex")}`, name: `captura-${id}.png`, mime: "image/png", size: 2048, contentType: "forums.post", contentId: "424242" },
    { id: `e2e${randomBytes(6).toString("hex")}`, name: `arhiva-${id}.zip`, mime: "application/zip", size: 4096, contentType: null, contentId: null },
    { id: `e2e${randomBytes(6).toString("hex")}`, name: `nota-${id}.txt`, mime: "text/plain", size: 12, contentType: null, contentId: null },
  ];
  for (const r of rows) {
    await sql(`INSERT INTO attachments (id, "storageKey", filename, mime, size, "contentType", "contentId", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      r.id,
      `e2e/${r.id}`,
      r.name,
      r.mime,
      r.size,
      r.contentType,
      r.contentId,
      utcNow(),
    ]);
  }
  try {
    await page.goto(`/admin/system/files?q=${id}`);
    await expect(page.getByRole("heading", { name: "Fișiere", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-file-row")).toHaveCount(3);
    await expect(page.getByTestId("gcs-files-total")).toHaveText("3 fișiere");
    await shot(page, "files-1");

    // Filtrul pe tip: doar arhiva.
    await page.goto(`/admin/system/files?q=${id}&kind=archive`);
    await expect(page.getByTestId("gcs-file-row")).toHaveCount(1);
    await expect(page.getByTestId("gcs-file-row")).toHaveAttribute("data-file", rows[1]!.name);

    // Panoul imaginii: unde e folosită, apoi ștergerea cu confirmare.
    await page.goto(`/admin/system/files?q=${id}`);
    const image = page.locator(`[data-testid="gcs-file-row"][data-file="${rows[0]!.name}"]`);
    await image.getByTestId("gcs-file-panel-open").click();
    const panel = page.getByTestId("gcs-file-panel");
    await expect(panel.getByTestId("gcs-file-uses")).toContainText("Postare");
    await shot(page, "files-2-panel");
    await panel.getByRole("button", { name: "Șterge" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(image).toHaveCount(0);

    // Ștergerea în masă: cele două rămase.
    await page.getByTestId("gcs-files-select-all").check();
    await expect(page.getByTestId("gcs-files-bulk-count")).toHaveText("2 fișiere bifate");
    await page.getByTestId("gcs-files-bulk").getByRole("button", { name: "Șterge bifate" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(page.getByTestId("gcs-files-bulk").getByRole("status")).toHaveText("2 fișiere șterse");
    await expect(page.getByTestId("gcs-file-row")).toHaveCount(0);
    expect(await sql(`SELECT id FROM attachments WHERE id IN ($1, $2, $3)`, rows.map((r) => r.id))).toEqual([]);
    expect((await sql(`SELECT 1 FROM audit_logs WHERE action = 'system.files_delete'`)).length).toBeGreaterThanOrEqual(2);
  } finally {
    await sql(`DELETE FROM attachments WHERE id IN ($1, $2, $3)`, rows.map((r) => r.id));
  }
});

test("Acțiuni salvate: adaug, editez pașii (același rând, nu unul nou) și șterg", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Macro${id}`, `macro-${id}@example.com`);
  const name = `Macro ${id}`;
  try {
    await page.goto("/admin/community/saved-actions");
    await page.getByTestId("gcs-saved-new-open").click();
    const add = page.getByTestId("gcs-saved-new");
    await add.getByLabel("Nume").fill(name);
    await add.getByLabel("Blochează topicul").check();
    await add.getByRole("button", { name: "Adaugă acțiunea" }).click();
    await expect(add).toHaveCount(0);
    const row = page.locator(`[data-testid="gcs-saved-row"][data-name="${name}"]`);
    await expect(row).toContainText("Blochează topicul");
    await expect(row).toContainText("În toate forumurile");

    await row.getByTestId("gcs-saved-edit-open").click();
    const edit = page.getByTestId("gcs-saved-edit");
    await expect(edit.getByLabel("Nume")).toHaveValue(name);
    await expect(edit.getByLabel("Blochează topicul")).toBeChecked();
    await edit.getByLabel("Blochează topicul").uncheck();
    await edit.getByLabel("Fixează topicul").check();
    await edit.getByLabel("Răspuns predefinit (opțional)").fill("Mulțumim, am fixat topicul.");
    await shot(page, "saved-actions-edit");
    await edit.getByRole("button", { name: "Salvează" }).click();
    await expect(edit).toHaveCount(0);
    await expect(row).toContainText("Fixează topicul");
    await expect(row).toContainText("Răspuns predefinit");
    await expect(row).not.toContainText("Blochează topicul");
    expect(await sql(`SELECT id FROM mod_saved_actions WHERE name = $1`, [name])).toHaveLength(1);

    await row.getByTestId("gcs-saved-edit-open").click();
    await page.getByTestId("gcs-saved-edit").getByRole("button", { name: "Șterge" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(row).toHaveCount(0);
  } finally {
    await sql(`DELETE FROM mod_saved_actions WHERE name = $1`, [name]);
  }
});
