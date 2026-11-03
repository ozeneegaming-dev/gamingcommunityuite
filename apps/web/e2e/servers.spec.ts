import { expect, test, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { startFakeGameServer, type FakeGameServer } from "./game-server";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Aplicația Servere (specul 2026-10-07-servere), cu un server de joc fals local (A2S pe UDP, Server List Ping pe TCP):
 * ACP-ul (adăugare, „Testează”, banner, admini), pagina `/servers`, pagina serverului (cu actualizarea live), widget-ul
 * de pe pagina principală și aplicația dezactivată. Worker-ul E2E interoghează serverul fals (excepția operatorului
 * `GCS_SERVERS_ALLOW_NETS=127.0.0.1/32`).
 */

test.describe.configure({ mode: "serial" });

let fake: FakeGameServer;
const id = uid();
const CS = `CS2 E2E ${id}`;
const MC = `Minecraft E2E ${id}`;
const ADMIN = `SrvAdm${id}`;
// Un banner mic (degrade PNG), trecut prin pipeline-ul atașamentelor.
const BANNER =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAYCAMAAAAyNwimAAAB6VBMVEWALRCPMRF4Kw+DLhCKMBFxKQ9+LBB7LA+FLhB2Kg99LBBnJg5uKA55Kw+SMhFpJw6XMxKZNBJiJQ2HLxB0Kg9fJA1vKA5/LRCMMBGCLRB8LBCBLRBaIw16Kw+ELhB1Kg93Kw+GLxCILxGRMhFqJw5zKQ9yKQ+JLxGLMBFVIQxwKQ6NMRGOMRFTIQxsKA5tKA6QMRFrJw5sJw6TMhGUMhGWMxJoJg5QIAyUMhKVMxJkJg5lJg5kJQ1mJg6YMxKNMBGILxBhJQ1jJQ2aNBKcNhKdOBKfOhJzKg9eJA1gJA2iPRGkPxGlQRFcIw1bIw1dIw1dJA1LHwusSBGqRxGnQxGoRRFYIg1ZIg2CLhCvTBCtShGyUBCwThBYIgxWIgxXIgxJHguzUhC3VRC4VxBUIQy9XQ+7Ww+/Xw+6WRBSIAxRIAxGHQvFZg/DZA/AYA/CYg9EHQtOIAxPIAxOHwxNHwzKaw7Iag7LbQ7GaA+gPBJKHgtMHwyhPBHQcw7RdQ7OcQ7Nbw5BHAtHHgtIHgu1VBDYfA21UxDVeA3Tdg7Weg0/GwpFHQvZfg3bgA3dgg3egw1DHAtCHAvghQ3hhw3kiwzjiQxAHAvmjQzpkAzojgzrkgw9Gwo+Gwo8Ggo8GwrxmQvulgzslAzwmAt75//pAAAACXBIWXMAAAsTAAALEwEAmpwYAAABOUlEQVRIx7XM1VJCUQAF0I10N6JigoGKjdjdjd1iBwZ2B7bY3fmlPvjo6BzuzFkfsPD69vzi8dy53ZcXLtex07m943Cs2O2rc7PTMzbb2KjFMmA2d/d0NbcYDDXVtXVlWm15vkpVkJWRmS0Wp8pNpsSkuHiJThfN5UaEazTBQmGIj1QayOf7i3g8X4BqHuDHBs2cHSQQgEkuJ8xD1XlhoJlHcjhRYJBLSHN9bkwsaOYsVoIR3uelxLlMlpwCmnlaulUBr3Mf8lyRo1SCZl5YVFwCmvlaRWUVaOaNTQ31IM1FP3mrN3l7W2cHaOa9u339oJmPDA0Og2Y+OTUxDrJc/W++/Ee+tDC/CJr51ub6BohyPUG+/zs/PDjaA8385PTsHCS5kWF+dX17A5r5/ePDEwhyK9P88+Pr/RstbbpQdknnFgAAAABJRU5ErkJggg==";

/** „Editor pagină” din meniul contului. */
async function openPageEditor(page: Page) {
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-account-staff").click();
  await page.getByTestId("gcs-menu-page-editor").click();
  await expect(page.getByTestId("gcs-page-editor")).toBeVisible();
}

/** Formularul ACP: jocul, numele, adresa. */
async function fillServer(page: Page, game: string, name: string, host: string, port: number) {
  await page.getByRole("radio", { name: game }).check();
  await page.getByLabel("Numele afișat").fill(name);
  await page.getByLabel("Host (IP sau domeniu)").fill(host);
  await page.getByLabel("Portul jocului", { exact: true }).fill(String(port));
}

/** Cardul unui server de pe `/servers` (pagina se reîncarcă până când worker-ul l-a interogat). */
async function onlineCard(page: Page, name: string) {
  const card = page.getByTestId("gcs-server-card").filter({ hasText: name });
  await expect(async () => {
    await page.goto("/servers");
    await expect(card.getByTestId("gcs-server-status")).toHaveText("Online", { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  return card;
}

test.beforeAll(async () => {
  fake = await startFakeGameServer();
});

test.afterAll(async () => {
  await fake?.close();
  // Serverele testului dispar, ca plăcile de statistici și pagina principală să rămână ca înainte pentru celelalte specuri.
  await sql(`DELETE FROM game_servers WHERE name LIKE $1`, [`%E2E ${id}`]);
});

test("ACP: „Testează” refuză adresele private, citește serverul fals; adăugarea cu banner și admin", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.75.0");
  await enterAcpAsRoot(page, ADMIN, `srvadm-${id}@example.com`);

  await page.goto("/admin/gaming/servers");
  await page.getByTestId("gcs-acp-server-add").click();
  await expect(page).toHaveURL(/\/admin\/gaming\/servers\/new$/);
  await fillServer(page, "Counter-Strike 2 / CS:GO", CS, "10.0.0.5", fake.udpPort);
  await page.getByTestId("gcs-server-test").click();
  await expect(page.getByTestId("gcs-server-test-result")).toContainText("Adresa e privată sau locală");

  await page.getByLabel("Host (IP sau domeniu)").fill("127.0.0.1");
  await page.getByTestId("gcs-server-test").click();
  const result = page.getByTestId("gcs-server-test-result");
  await expect(result).toContainText("Serverul răspunde");
  await expect(result).toContainText("3 / 32 jucători");
  await expect(result).toContainText("Harta: de_mirage");
  await expect(result).toContainText("3 jucători în listă");

  // Bannerul, din popupul de încărcare: pleacă odată cu formularul la salvare.
  await page.getByTestId("gcs-server-banner-open").click();
  await page.getByTestId("gcs-server-banner-pick").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: Buffer.from(BANNER, "base64") });
  await page.getByTestId("gcs-server-banner-use").click();
  await expect(page.getByTestId("gcs-server-banner")).toContainText("banner.png");
  await page.getByLabel("Descriere").fill(`Server competitiv ${id}.\nReguli pe forum.`);
  await page.getByTestId("gcs-server-admin-search").fill(ADMIN.slice(0, 8));
  await page.getByRole("button", { name: ADMIN, exact: true }).click();
  await expect(page.getByTestId("gcs-server-admins-chosen")).toContainText(ADMIN);
  await page.getByTestId("gcs-server-save").click();
  await expect(page).toHaveURL(/\/admin\/gaming\/servers$/);
  await expect(page.getByTestId("gcs-acp-server").filter({ hasText: CS })).toBeVisible();

  // Minecraft Java pe portul TCP al serverului fals (fără Connect: doar copierea adresei).
  await page.getByTestId("gcs-acp-server-add").click();
  await fillServer(page, "Minecraft: Java Edition", MC, "127.0.0.1", fake.tcpPort);
  await page.getByTestId("gcs-server-test").click();
  await expect(page.getByTestId("gcs-server-test-result")).toContainText("12 / 60 jucători");
  await page.getByTestId("gcs-server-save").click();
  await expect(page.getByTestId("gcs-acp-server").filter({ hasText: MC })).toBeVisible();

  const [row] = await sql<{ bannerId: string | null; admins: string }>(
    `SELECT g."bannerId", (SELECT count(*)::text FROM game_server_admins a WHERE a."serverId" = g.id) AS admins FROM game_servers g WHERE g.name = $1`,
    [CS],
  );
  expect(row!.bannerId).not.toBeNull();
  expect(Number(row!.admins)).toBe(1);
});

test("/servers: cardurile cu statusul citit de worker, Connect, copierea adresei, filtrul pe joc; vizitatorul le vede", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.75.1");
  const cs = await onlineCard(page, CS);
  await expect(cs.getByTestId("gcs-server-players")).toHaveText("3 / 32 jucători");
  await expect(cs.getByTestId("gcs-server-map")).toHaveText("de_mirage");
  await expect(cs.getByTestId("gcs-server-address")).toHaveText(`127.0.0.1:${fake.udpPort}`);
  await expect(cs.getByTestId("gcs-server-connect")).toHaveAttribute("href", `steam://connect/127.0.0.1:${fake.udpPort}`);
  await expect(cs.locator("img.gcs-serverBanner__img")).toHaveAttribute("src", /^\/files\//);

  const mc = await onlineCard(page, MC);
  await expect(mc.getByTestId("gcs-server-map")).toHaveText("Paper 1.21.1");
  await expect(mc.getByTestId("gcs-server-connect")).toHaveCount(0);
  await expect(mc.getByTestId("gcs-server-copy")).toHaveText("Copiază adresa");
  await expect(page.getByTestId("gcs-servers-summary")).toContainText("jucători online acum pe");

  await page.getByTestId("gcs-servers-filter").getByRole("link", { name: "Minecraft" }).click();
  await expect(page).toHaveURL(/\/servers\?game=minecraft$/);
  await expect(page.getByTestId("gcs-server-card").filter({ hasText: CS })).toHaveCount(0);
  await expect(page.getByTestId("gcs-server-card").filter({ hasText: MC })).toBeVisible();

  // Meniul principal are „Servere”; un vizitator vede aceleași carduri.
  const guest = await browser.newContext();
  await useFreshIp(guest, "100.75.2");
  const visitor = await guest.newPage();
  await visitor.goto("/");
  // Servere e un submeniu (`nav:v6`): „Toate serverele” duce la listă.
  await visitor.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Servere", exact: true }).click();
  await visitor.getByRole("menu", { name: "Servere" }).getByRole("menuitem", { name: "Toate serverele" }).click();
  await expect(visitor).toHaveURL(/\/servers$/);
  await expect(visitor.getByTestId("gcs-server-card").filter({ hasText: CS })).toBeVisible();
  await guest.close();
});

test("pagina serverului: statusul, jucătorii, graficul, adminii; noii jucători apar fără reîncărcare", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.75.3");
  const cs = await onlineCard(page, CS);
  await cs.getByRole("link", { name: `Detalii: ${CS}` }).click();
  await expect(page).toHaveURL(/\/servers\/\d+-cs2-e2e-/);
  await expect(page.locator(".gcs-pageHeader__title")).toHaveText(CS);
  const head = page.getByTestId("gcs-server-head-status");
  await expect(head).toContainText("Online");
  await expect(head).toContainText("de_mirage");
  const table = page.getByTestId("gcs-server-players-table");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("ShadowRO");
  await expect(table.getByRole("row", { name: /ShadowRO/ })).toContainText("1 h 12 min");
  await expect(page.getByTestId("gcs-server-chart")).toBeVisible();
  await expect(page.getByTestId("gcs-server-admins")).toContainText(ADMIN);
  await expect(page.getByText(`Server competitiv ${id}.`)).toBeVisible();

  await page.getByTestId("gcs-server-ranges").getByRole("link", { name: "7 zile" }).click();
  await expect(page).toHaveURL(/\?range=7d$/);
  await expect(page.getByTestId("gcs-server-chart")).toHaveAttribute("data-range", "7d");

  // Doi jucători noi pe serverul fals: worker-ul îi citește la următoarea interogare, pagina se actualizează singură.
  fake.state.players.push({ name: "Vortex", score: 25, time: 7380 }, { name: "PixelKid", score: 9, time: 660 });
  await expect(page.getByTestId("gcs-server-head-players")).toHaveText("5 / 32 jucători", { timeout: 75_000 });
  await expect(page.getByTestId("gcs-server-players-table")).toContainText("PixelKid", { timeout: 75_000 });
});

test("widget-ul „Servere” pe pagina principală; aplicația dezactivată dispare din meniu, iar /servers dă 404", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.75.4");
  await enterAcpAsRoot(page, `SrvWid${id}`, `srvwid-${id}@example.com`);
  await page.goto("/");
  await openPageEditor(page);
  await page.getByTestId("gcs-widget-add-sidebar").click();
  await page.getByTestId("gcs-widget-catalog-sidebar").getByRole("listitem").filter({ hasText: "Servere" }).click();
  await page.getByTestId("gcs-page-editor-save").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a fost salvată.");
  await page.getByTestId("gcs-page-editor-done").click();
  // Pagina principală implicită are deja serverele (aspectul compact, primul în coloană): widget-ul adăugat (aspectul
  // complet) e ultimul din coloană.
  const widget = page.getByTestId("gcs-widget-servers").filter({ visible: true }).last();
  const row = widget.getByTestId("gcs-widget-server").filter({ hasText: CS });
  await expect(row).toHaveAttribute("data-state", "online");
  await expect(row.getByTestId("gcs-widget-server-players")).toContainText("/ 32");
  await expect(widget.getByRole("link", { name: "Toate serverele" })).toHaveAttribute("href", "/servers");
  // Plăcile din panoul de statistici (serverele publice online și jucătorii lor).
  await expect(page.locator('[data-tile="servers.online"]').filter({ visible: true })).toBeVisible();
  await expect(page.locator('[data-tile="servers.players"]').filter({ visible: true })).toBeVisible();

  // Aplicația dezactivată: meniul, widget-ul, pagina și ruta API dispar pentru un membru.
  const app = async (enabled: boolean) => {
    await page.goto("/admin/system/applications");
    const row = page.getByTestId("gcs-app-servers");
    await row.getByRole("switch", { name: "Servere pornită" }).click();
    if (!enabled) await page.getByTestId("gcs-app-confirm-ok").click();
    await expect(row.getByTestId("gcs-app-status")).toHaveText(enabled ? "Activă" : "Oprită");
    // Insigna se schimbă optimist; notificarea apare după răspunsul serverului (salvarea e gata).
    await expect(page.getByTestId("gcs-apps-notice")).toHaveText(enabled ? "Servere a fost pornită." : "Servere a fost oprită.");
  };
  await app(false);
  const other = await browser.newContext();
  await useFreshIp(other, "100.75.5");
  const m = await other.newPage();
  await member(m, `SrvMem${id}`, `srvmem-${id}@example.com`);
  await m.goto("/");
  await expect(m.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Servere", exact: true })).toHaveCount(0);
  await expect(m.getByTestId("gcs-widget-servers")).toHaveCount(0);
  expect((await m.goto("/servers"))?.status()).toBe(404);
  expect((await m.request.get("/api/servers/status?ids=1")).status()).toBe(404);
  await app(true);
  await m.goto("/servers");
  await expect(m.getByTestId("gcs-server-card").filter({ hasText: CS })).toBeVisible();
  await other.close();

  // Layout-ul implicit înapoi (alte teste se bazează pe pagina principală implicită).
  await page.goto("/");
  await openPageEditor(page);
  await page.getByTestId("gcs-page-editor-default").click();
  await page.getByTestId("gcs-page-editor-default-confirm").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a revenit la widget-urile implicite.");
  await page.getByTestId("gcs-page-editor-done").click();
});
