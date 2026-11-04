import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { member, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, setSetting, sql, useFreshIp } from "./helpers";

/**
 * Aplicația Descărcări (specul 2026-11-03-descarcari), cap-coadă: staff-ul creează din ACP o categorie și una VIP, un
 * membru trimite un fișier ZIP (încărcat pe bucăți din popup, verificat după conținut), fișierul așteaptă aprobarea și nu
 * se vede de alții, staff-ul îl aprobă din coadă, vizitatorul vede invitația de înregistrare, alt membru îl descarcă prin
 * linkul paginii (un link copiat fără token duce înapoi la pagină), lasă o recenzie, iar în categoria VIP membrul obișnuit
 * primește invitația VIP. Antivirusul e oprit aici (nu rulează ClamAV în E2E; testele unitare acoperă scanarea).
 * Cu `GCS_E2E_SHOTS=<folder>` salvează capturile (index, formular, pagina fișierului, ACP, mobil).
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
const CAT = `Harti CS2 ${id}`;
const VIP_CAT = `Pachete VIP ${id}`;
const TITLE = `Pachet aim ${id}`;
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]), Buffer.from(`aim_map ${id} `.repeat(40))]);
const opened: BrowserContext[] = [];
let root: Page;
let ana: Page;
let categoryId = 0;
let vipCategoryId = 0;
let fileHref = "";

async function user(browser: Browser, name: string, email: string, group: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  opened.push(context);
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  return page;
}

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

test.beforeAll(async () => {
  await setSetting("downloads.av_enabled", false);
});

test.afterAll(async () => {
  for (const c of opened) await c.close().catch(() => {});
  await resetSetting("downloads.av_enabled");
  const cats = await sql<{ id: number }>(`SELECT id FROM download_categories WHERE name LIKE $1`, [`%${id}`]);
  for (const c of cats) {
    await sql(`DELETE FROM container_permissions WHERE "containerType" = 'downloads' AND "containerId" = $1`, [String(c.id)]);
    await sql(`DELETE FROM container_inherit WHERE "containerType" = 'downloads' AND "containerId" = $1`, [String(c.id)]);
  }
  await sql(`DELETE FROM download_categories WHERE name LIKE $1`, [`%${id}`]);
});

test("ACP: o categorie obișnuită și una VIP, din listă + panou", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  opened.push(context);
  await useFreshIp(context, "100.77.0");
  root = await context.newPage();
  await enterAcpAsRoot(root, `DlAdm${id}`, `dl-adm-${id}@example.com`);

  for (const [name, vip] of [[CAT, false], [VIP_CAT, true]] as const) {
    await root.goto("/admin/community/downloads/categories");
    await root.getByTestId("gcs-acp-dlcat-new").click();
    const panel = root.locator(".gcs-drawer");
    await panel.getByTestId("gcs-acp-dlcat-name").fill(name);
    if (vip) await panel.locator('input[name="vipOnly"]').check();
    await panel.getByRole("button", { name: /Creează/ }).click();
    await expect(root.getByTestId("gcs-acp-dlcat").filter({ hasText: name })).toBeVisible();
  }
  const rows = await sql<{ id: number; name: string; vipOnly: boolean }>(`SELECT id, name, "vipOnly" FROM download_categories WHERE name LIKE $1`, [`%${id}`]);
  categoryId = rows.find((r) => r.name === CAT)!.id;
  vipCategoryId = rows.find((r) => r.name === VIP_CAT)!.id;
  expect(Boolean(rows.find((r) => r.id === vipCategoryId)!.vipOnly)).toBe(true);
  // Permisiunile implicite ale unei categorii noi: membrii încarcă, vizitatorii doar văd.
  const perms = await sql<{ action: string; key: string }>(
    `SELECT cp.action, g.key FROM container_permissions cp JOIN groups g ON g.id = cp."groupId" WHERE cp."containerType" = 'downloads' AND cp."containerId" = $1`,
    [String(categoryId)],
  );
  expect(perms.some((p) => p.key === "member" && p.action === "downloads.upload")).toBe(true);
  expect(perms.some((p) => p.key === "guest" && p.action === "downloads.download")).toBe(false);
  await shot(root, "acp-categories");
});

test("un membru trimite un fișier: încărcarea pe bucăți, verificarea, apoi „așteaptă aprobarea”", async ({ browser }) => {
  test.setTimeout(180_000);
  ana = await user(browser, `DlAna${id}`, `dl-ana-${id}@example.com`, "member", "100.77.1");
  await ana.goto(`/downloads/submit?category=${categoryId}`);
  const form = ana.getByTestId("gcs-download-form");
  await expect(form).toBeVisible();
  await form.getByTestId("gcs-download-files-open").click();
  await form.getByTestId("gcs-download-files-pick").setInputFiles({ name: "aim-pack.zip", mimeType: "application/zip", buffer: ZIP });
  await form.getByTestId("gcs-download-files-use").click();
  const asset = form.getByTestId("gcs-download-asset");
  await expect(asset).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await form.getByTestId("gcs-download-title").fill(TITLE);
  await form.getByTestId("gcs-download-summary").fill("Hărți de aim pentru antrenament.");
  await typeInEditor(ana, "Pachet cu hărți de aim, gata de pus pe server.", form.locator(".gcs-richInput").first());
  await form.getByTestId("gcs-download-version").fill("1.0");
  await shot(ana, "submit-form", true);
  await form.getByTestId("gcs-download-submit").click();
  await ana.waitForURL(/\/downloads\/file\/\d+-/);
  fileHref = new URL(ana.url()).pathname;
  await expect(ana.getByTestId("gcs-download-notice")).toHaveAttribute("data-status", "pending");
  const [row] = await sql<{ status: string; scanStatus: string; kind: string }>(
    `SELECT f.status, a."scanStatus", a.kind FROM download_files f JOIN download_assets a ON a."fileId" = f.id WHERE f.title = $1`,
    [TITLE],
  );
  expect(row).toMatchObject({ status: "PENDING", scanStatus: "SKIPPED", kind: "zip" });
});

test("în așteptare, fișierul nu se vede de vizitatori; staff-ul îl aprobă din coadă", async ({ browser }) => {
  test.setTimeout(120_000);
  const guest = await browser.newContext();
  opened.push(guest);
  const g = await guest.newPage();
  expect((await g.goto(fileHref))?.status()).toBe(404);

  await root.goto("/admin/community/downloads/queue");
  const item = root.getByTestId("gcs-acp-queue-row").filter({ hasText: TITLE });
  await item.getByTestId("gcs-acp-queue-open").click();
  await root.locator(".gcs-drawer").getByRole("button", { name: /Aprobă/ }).click();
  await expect(root.getByTestId("gcs-acp-queue-row").filter({ hasText: TITLE })).toHaveCount(0);

  await g.goto(fileHref);
  await expect(g.getByTestId("gcs-download-guest")).toBeVisible();
  await expect(g.getByTestId("gcs-download-get")).toHaveCount(0);
  await g.goto("/downloads");
  await expect(g.getByTestId("gcs-download-card").filter({ hasText: TITLE }).first()).toBeVisible();
  await shot(g, "index-guest", true);
});

test("alt membru descarcă prin linkul paginii; un link copiat fără token duce la pagină; recenzia", async ({ browser }) => {
  test.setTimeout(120_000);
  const bob = await user(browser, `DlBob${id}`, `dl-bob-${id}@example.com`, "member", "100.77.2");
  await bob.goto(fileHref);
  const [download] = await Promise.all([bob.waitForEvent("download"), bob.getByTestId("gcs-download-get").first().click()]);
  expect(download.suggestedFilename()).toBe("aim-pack.zip");
  const [counts] = await sql<{ downloads: number }>(`SELECT downloads FROM download_files WHERE title = $1`, [TITLE]);
  expect(Number(counts!.downloads)).toBe(1);
  const [asset] = await sql<{ id: string }>(`SELECT a.id FROM download_assets a JOIN download_files f ON f.id = a."fileId" WHERE f.title = $1`, [TITLE]);
  await bob.goto(`/downloads/get/${asset!.id}`);
  await expect(bob).toHaveURL(new RegExp(`${fileHref}$`));

  const reviews = bob.getByTestId("gcs-download-review-form");
  await reviews.locator(".gcs-dlStarsPick__star").nth(3).click();
  await reviews.getByTestId("gcs-download-review-submit").click();
  await expect(bob.getByTestId("gcs-download-review")).toHaveCount(1);
  await shot(bob, "file-page", true);
  await bob.setViewportSize({ width: 375, height: 812 });
  await bob.reload();
  await shot(bob, "file-page-mobile", true);
});

test("categoria VIP: membrul obișnuit vede fișierul și invitația VIP", async ({ browser }) => {
  test.setTimeout(120_000);
  await sql(`UPDATE download_files SET "categoryId" = $1 WHERE title = $2`, [vipCategoryId, TITLE]);
  const cid = await user(browser, `DlCid${id}`, `dl-cid-${id}@example.com`, "member", "100.77.3");
  await cid.goto(fileHref);
  await expect(cid.getByTestId("gcs-download-vip")).toBeVisible();
  await expect(cid.getByTestId("gcs-download-get")).toHaveCount(0);
  const vip = await user(browser, `DlVip${id}`, `dl-vip-${id}@example.com`, "vip_gold", "100.77.4");
  await vip.goto(fileHref);
  await expect(vip.getByTestId("gcs-download-get").first()).toBeVisible();
});
