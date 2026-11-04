import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { member, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Aplicația Pagini (specul 2026-11-03-pagini), cap-coadă: adminul creează o bază de date din șablonul „Ghiduri” (cu
 * pagina ei) și o pagină cu constructorul (o secțiune, un bloc de conținut), care apare în meniu; un membru trimite un
 * ghid, care așteaptă aprobarea; staff-ul îl aprobă de pe pagina lui; alt membru îl găsește în căutare și în flux, îl
 * comentează și îi dă o notă. Cu `GCS_E2E_SHOTS=<folder>` salvează capturile (ACP, constructorul, baza, înregistrarea).
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
const DB_NAME = `Ghiduri ${id}`;
const PAGE_TITLE = `Bun venit ${id}`;
const RECORD = `Crosshair curat ${id}`;
const opened: BrowserContext[] = [];
let root: Page;
let dbPath = "";
let recordUrl = "";

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function user(browser: Browser, name: string, email: string, group: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  opened.push(context);
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  return page;
}

test.afterAll(async () => {
  for (const c of opened) await c.close();
});

test("ACP: baza „Ghiduri” din șablon, cu câmpurile, categoriile și pagina ei", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  opened.push(context);
  await useFreshIp(context, "100.77.0");
  root = await context.newPage();
  await enterAcpAsRoot(root, `PagAdm${id}`, `pages-adm-${id}@example.com`);

  await root.goto("/admin/pages/databases");
  await root.getByTestId("gcs-acp-db-new-open").click();
  const panel = root.getByTestId("gcs-acp-db-new");
  await panel.getByTestId("gcs-acp-preset-guides").click();
  await panel.getByLabel("Nume").fill(DB_NAME);
  await shot(root, "acp-pages-db-new");
  await panel.getByRole("button", { name: "Creează baza și pagina ei" }).click();
  const row = root.getByTestId("gcs-acp-database").filter({ hasText: DB_NAME });
  await expect(row).toBeVisible();
  const [dbRow] = await sql<{ id: number; key: string; path: string }>(
    `SELECT d.id, d.key, n.path FROM pages_databases d JOIN pages_nodes n ON n."databaseId" = d.id WHERE d.name = $1`,
    [DB_NAME],
  );
  expect(dbRow).toBeTruthy();
  dbPath = dbRow!.path;
  expect(Number((await sql<{ n: string }>(`SELECT count(*)::text AS n FROM pages_categories WHERE "databaseId" = $1`, [dbRow!.id]))[0]!.n)).toBe(3);

  // Fișa bazei: tab-ul câmpurilor arată câmpurile șablonului.
  await row.getByRole("link", { name: "Editează" }).click();
  await root.getByTestId("gcs-acp-db-tab-fields").click();
  await expect(root.getByTestId("gcs-acp-field")).toHaveCount(4);
  await shot(root, "acp-pages-db-fields");
});

test("constructorul: o pagină cu o secțiune și un bloc de conținut, în meniul site-ului", async () => {
  test.setTimeout(180_000);
  await root.goto("/admin/pages");
  await root.getByTestId("gcs-acp-pages-new-open").click();
  const panel = root.getByTestId("gcs-acp-pages-new");
  await panel.getByLabel("Titlu").fill(PAGE_TITLE);
  await panel.getByLabel("În meniul site-ului").check();
  await panel.getByRole("button", { name: "Creează" }).click();
  const node = root.getByTestId("gcs-acp-pages-node").filter({ hasText: PAGE_TITLE });
  await expect(node).toBeVisible();
  await node.getByTestId("gcs-acp-pages-build").click();

  const builder = root.getByTestId("gcs-pages-builder");
  await builder.getByTestId("gcs-pages-builder-add-section").click();
  await builder.getByTestId("gcs-pages-cols-2-1").click();
  await builder.getByTestId("gcs-pages-builder-add").first().click();
  await builder.getByTestId("gcs-pages-add-content").click();
  const blockPanel = root.getByTestId("gcs-pages-block-panel");
  await blockPanel.getByTestId("gcs-pages-block-title").fill(`Despre noi ${id}`);
  await typeInEditor(root, `Comunitatea noastră de gaming ${id}.`, blockPanel);
  await blockPanel.getByRole("button", { name: "Gata" }).click();
  // Un bloc de înregistrări în coloana îngustă, din baza creată mai sus.
  await builder.getByTestId("gcs-pages-builder-add").nth(1).click();
  await builder.getByTestId("gcs-pages-add-records").click();
  await root.getByTestId("gcs-pages-block-database").selectOption({ label: DB_NAME });
  await root.getByTestId("gcs-pages-block-panel").getByRole("button", { name: "Gata" }).click();
  await shot(root, "acp-pages-builder");
  await builder.getByTestId("gcs-pages-builder-save").click();
  await expect(builder.getByText("Pagina a fost salvată.")).toBeVisible();

  const slug = (await sql<{ path: string }>(`SELECT path FROM pages_nodes WHERE title = $1`, [PAGE_TITLE]))[0]!.path;
  await root.goto(`/pages/${slug}`);
  await expect(root.getByTestId("gcs-pages-layout")).toContainText(`Comunitatea noastră de gaming ${id}.`);
  await expect(root.getByRole("navigation").getByRole("link", { name: PAGE_TITLE }).first()).toBeAttached();
  await shot(root, "pages-page");
});

test("un membru trimite un ghid (în așteptare); staff-ul îl aprobă; apare în listă", async ({ browser }) => {
  test.setTimeout(180_000);
  const author = await user(browser, `Autor${id}`, `pages-autor-${id}@example.com`, "member", "100.77.1");
  await author.goto(`/pages/${dbPath}`);
  await author.getByTestId("gcs-pages-submit").click();
  const form = author.getByTestId("gcs-pages-form");
  await form.getByTestId("gcs-pages-title").fill(RECORD);
  await form.getByLabel("Joc").selectOption("CS2");
  await form.getByLabel("Nivel").selectOption("Începător");
  await typeInEditor(author, `Setările pas cu pas pentru crosshair ${id}.`, form.locator("#gcs-pg-editor").locator(".."));
  await shot(author, "pages-submit");
  await form.getByTestId("gcs-pages-save").click();
  await expect(author.getByTestId("gcs-pages-status")).toContainText("așteaptă aprobarea");
  recordUrl = new URL(author.url()).pathname;

  // Vizitatorii nu o văd încă.
  const guest = await browser.newContext();
  opened.push(guest);
  const g = await guest.newPage();
  expect((await g.goto(recordUrl))!.status()).toBe(404);

  await root.goto(recordUrl);
  await root.getByTestId("gcs-pages-mod-approve").click();
  await expect(root.getByTestId("gcs-pages-status")).toHaveCount(0);
  await g.goto(`/pages/${dbPath}`);
  await expect(g.getByTestId("gcs-pages-record").filter({ hasText: RECORD })).toBeVisible();
  await shot(g, "pages-database");
});

test("alt membru găsește ghidul în căutare și în flux, îl comentează și îi dă o notă", async ({ browser }) => {
  test.setTimeout(180_000);
  const reader = await user(browser, `Cititor${id}`, `pages-cititor-${id}@example.com`, "member", "100.77.2");
  await reader.goto(`/search?q=${encodeURIComponent(`crosshair ${id}`)}&type=pages.records`);
  await expect(reader.getByTestId("gcs-search-app-results").getByRole("link", { name: RECORD })).toBeVisible();
  await reader.goto("/activity");
  await expect(reader.getByTestId("gcs-activity")).toContainText(RECORD);

  await reader.goto(recordUrl);
  await typeInEditor(reader, `Mersi, @Autor${id}!`, reader.getByTestId("gcs-pages-comment-form"));
  await reader.keyboard.press("Escape");
  await reader.getByTestId("gcs-pages-comment-send").click();
  await expect(reader.getByTestId("gcs-pages-comment").filter({ hasText: "Mersi" })).toBeVisible();
  await reader.getByTestId("gcs-pages-rating").getByTestId("gcs-rate-4").click();
  await expect(reader.getByTestId("gcs-pages-rating")).toHaveAttribute("data-count", "1");
  await shot(reader, "pages-record");
});
