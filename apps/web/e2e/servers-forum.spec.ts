import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { startFakeGameServer, type FakeGameServer } from "./game-server";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Serverele ca forumuri (machetele aprobate `ServerWizard` și `ServerForum`), cu serverul de joc fals local: asistentul
 * „Creează categorie” din ACP (Verifică cu răspunsul live, subforumurile), indexul (bara live a rândului, eticheta ON,
 * sumarul categoriei), cardul mare din pagina forumului serverului și tabul „Server” din ACP (stilul Compact). Capturile:
 * `GCS_E2E_SHOTS=<folder>` (1440 și 375).
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
const CAT = `Servere CS2 E2E ${id}`;
const SRV = `Public 128 tick ${id}`;
let fake: FakeGameServer;

async function shot(page: Page, name: string, full = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
}

test.beforeAll(async () => {
  fake = await startFakeGameServer();
});

test.afterAll(async () => {
  await fake?.close();
  await sql(`DELETE FROM game_servers WHERE name LIKE $1`, [`%${id}`]);
  // Arborele categoriei, de jos în sus (subforumurile, forumurile serverelor, categoria): legătura părinte e RESTRICT.
  for (const [cat] of [await sql<{ id: number }>(`SELECT id FROM forums WHERE name = $1`, [CAT])]) {
    if (!cat) continue;
    await sql(`DELETE FROM forums WHERE "parentId" IN (SELECT id FROM forums WHERE "parentId" = $1)`, [cat.id]);
    await sql(`DELETE FROM forums WHERE "parentId" = $1`, [cat.id]);
    await sql(`DELETE FROM forums WHERE id = $1`, [cat.id]);
  }
});

test("asistentul: tipul, jocul, serverul verificat live, subforumurile, rezumatul și crearea", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.77.0");
  await enterAcpAsRoot(page, `SfAdm${id}`, `sfadm-${id}@example.com`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/community/forums");
  await page.getByTestId("gcs-forum-wizard-open").click();
  await expect(page.getByTestId("gcs-server-wizard")).toBeVisible();

  await page.getByTestId("gcs-wizard-name").fill(CAT);
  await page.getByTestId("gcs-wizard-type-servers").click();
  await shot(page, "wizard-1-type");
  await page.getByTestId("gcs-wizard-next").click();
  await expect(page.getByTestId("gcs-wizard-game-fivem")).toBeDisabled();
  await page.getByTestId("gcs-wizard-game-cs2").click();
  await shot(page, "wizard-2-game");
  await page.getByTestId("gcs-wizard-next").click();

  await page.getByTestId("gcs-wizard-server-name").first().fill(SRV);
  await page.getByTestId("gcs-wizard-server-address").first().fill(`127.0.0.1:${fake.udpPort}`);
  // „Top jucători” e oprit implicit (macheta); aici îl pornim, pentru cardul mare.
  await page.getByRole("button", { name: "Top jucători" }).click();
  await page.getByTestId("gcs-wizard-verify").first().click();
  await expect(page.getByTestId("gcs-wizard-server-check").first()).toContainText("Online · de_mirage", { timeout: 15_000 });
  await shot(page, "wizard-3-servers");
  await page.getByTestId("gcs-wizard-next").click();
  await expect(page.getByTestId("gcs-wizard-tree")).toContainText("Reclamații · Cereri admin · Propuneri · Cereri unban");
  await shot(page, "wizard-4-confirm");
  await page.getByTestId("gcs-wizard-next").click();
  await expect(page).toHaveURL(/\/admin\/community\/forums\?created=\d+$/);

  const [srv] = await sql<{ forumId: number | null }>(`SELECT "forumId" FROM game_servers WHERE name = $1`, [SRV]);
  expect(srv?.forumId).toBeTruthy();
  const subs = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM forums WHERE "parentId" = $1`, [srv!.forumId]);
  expect(Number(subs[0]!.n)).toBe(4);
});

test("indexul: bara live, eticheta ON și sumarul categoriei; pagina forumului: cardul mare", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const row = page.getByTestId("gcs-forum-row").filter({ hasText: SRV });
  await expect(async () => {
    await page.goto("/forum");
    await expect(row.getByTestId("gcs-forum-server-strip")).toHaveAttribute("data-state", "online", { timeout: 2000 });
  }).toPass({ timeout: 90_000 });
  await expect(row.getByTestId("gcs-forum-server-state")).toHaveText("ON");
  await expect(row.getByTestId("gcs-forum-server-strip")).toContainText("de_mirage");
  await expect(row.getByTestId("gcs-forum-server-connect")).toHaveAttribute("href", `steam://connect/127.0.0.1:${fake.udpPort}`);
  const category = page.getByTestId("gcs-category").filter({ hasText: CAT });
  await expect(category.getByTestId("gcs-forum-server-summary")).toContainText("jucători online");
  await category.scrollIntoViewIfNeeded();
  await shot(page, "index-1440");

  await row.locator(".gcs-forumRow__link").click();
  const card = page.getByTestId("gcs-forum-server-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("de_mirage");
  await expect(card.getByTestId("gcs-forum-server-players")).toContainText("ShadowRO");
  await shot(page, "server-forum-1440");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByTestId("gcs-forum-server-card")).toBeVisible();
  // Fără scroll orizontal pe telefon.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, "server-forum-375", true);
  await page.goto("/forum");
  await shot(page, "index-375", true);
});

test("ACP › Forumuri › Editează › Server: stilul Compact și cardul mare oprit", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.77.1");
  // Un cont nou (contul din primul test există deja: înregistrarea cu același nume ar fi refuzată).
  await enterAcpAsRoot(page, `SfTab${id}`, `sftab-${id}@example.com`);
  await page.setViewportSize({ width: 1440, height: 900 });
  const [srv] = await sql<{ forumId: number }>(`SELECT "forumId" FROM game_servers WHERE name = $1`, [SRV]);
  await page.goto(`/admin/community/forums/${srv!.forumId}?tab=${encodeURIComponent("x:servers:server")}`);
  const tab = page.getByTestId("gcs-forum-server-tab");
  await expect(tab).toBeVisible();
  await shot(page, "acp-server-tab");
  await tab.getByText("Compact", { exact: true }).click();
  await page.getByTestId("gcs-ext-card").uncheck();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Salvat").first()).toBeVisible();

  await page.goto("/forum");
  const row = page.getByTestId("gcs-forum-row").filter({ hasText: SRV });
  await expect(row.locator(".gcsx-srv--compact")).toBeVisible();
  await row.locator(".gcs-forumRow__link").click();
  await expect(page.getByTestId("gcs-forum-server-card")).toHaveCount(0);
});
