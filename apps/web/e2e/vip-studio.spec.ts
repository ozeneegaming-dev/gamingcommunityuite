import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Studio VIP (pluginul `gcs.vip_studio`, semnat cu cheia de test a rulării): instalarea din ACP, o ramă nouă încărcată
 * din ACP, studioul unui membru VIP (alegeri → previzualizarea live → numărătoarea → salvarea), apoi aspectul în
 * postbit, hover card și pe profil, widget-ul „VIP online”, refuzul pentru ne-VIP și expirarea.
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const KEY = "gcs.vip_studio";
const UNSIGNED = path.join(SDK_DIR, "plugins/vip-studio/dist/gcs.vip_studio-1.0.0.zip");
const SIGNED = path.join(__dirname, "../.e2e", "gcs.vip_studio-e2e.zip");
const WIDGET = `[data-widget="plugin.${KEY}.roster"]`;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // Construirea (nesemnat) și semnarea cu scriptul SDK-ului, ca în livrare; cheia e cea de unică folosință a rulării.
  mkdirSync(path.dirname(SIGNED), { recursive: true });
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-vip-studio.ts"], { cwd: SDK_DIR, stdio: "pipe" });
  execFileSync(process.execPath, ["--import", "tsx", "scripts/sign-plugin.ts", UNSIGNED, "--out", SIGNED], {
    cwd: SDK_DIR,
    stdio: "pipe",
    env: { ...process.env, GCS_PLUGIN_SIGNING_KEY: process.env.GCS_E2E_PLUGIN_KEY ?? "", GCS_PLUGIN_SIGNING_KEY_ID: "e2e" },
  });
});

test.afterAll(async () => {
  await sql(`UPDATE plugins SET enabled = false WHERE key = $1`, [KEY]).catch(() => {});
  await sql(`DELETE FROM widget_placements WHERE type LIKE $1`, [`plugin.${KEY}.%`]).catch(() => {});
});

/** O ramă originală de test: un inel PNG 256×256 cu transparență în mijloc (codificat aici, fără dependențe). */
function framePng(): Buffer {
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 128, y - 128);
      const on = d > 100 && d < 118;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = 40;
      raw[o + 1] = 220;
      raw[o + 2] = 160;
      raw[o + 3] = on ? 255 : 0;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function profileFixture(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
}

const studio = (page: Page) => page.locator("[data-gcsp-studio]");
const tile = (page: Page, name: string, value: string) => studio(page).locator(`label.gcsp-tile:has(input[name="${name}"][value="${value}"])`);
/** Alege o placă; cele de după primele 20 se încarcă pe loturi la derulare (ca la un membru real). */
async function pick(page: Page, name: string, value: string) {
  const t = tile(page, name, value);
  await expect(async () => {
    if (!(await t.isVisible())) await page.mouse.wheel(0, 700);
    await expect(t).toBeVisible({ timeout: 400 });
  }).toPass({ timeout: 20_000 });
  await t.click();
}

let rootPage: Page;
const id = uid();
const vipEmail = `vipstudio-${id}@example.com`;

test("Root Admin instalează Studio VIP semnat și adaugă o ramă nouă din ACP", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  await useFreshIp(context, "100.74.0");
  rootPage = await context.newPage();
  const page = rootPage;
  await enterAcpAsRoot(page, `VipAdm${id}`, `vipadm-${id}@example.com`);

  await page.goto("/admin/system/applications");
  await page.getByTestId("gcs-plugin-upload").locator('input[type="file"]').setInputFiles(SIGNED);
  await page.getByTestId("gcs-plugin-upload").getByRole("button", { name: "Încarcă și verifică" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await expect(page.getByTestId("gcs-plugin-signed")).toBeVisible();
  await expect(page.getByTestId("gcs-plugin-checks").locator('[data-level="error"]')).toHaveCount(0);
  await expect(page.getByTestId("gcs-plugin-capabilities")).toContainText("Aspectul membrilor");
  await page.getByRole("button", { name: "Instalează pluginul" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/system/applications/plugins/${KEY.replace(".", "\\.")}$`));
  await expect(page.getByTestId("gcs-plugin-header").getByTestId("gcs-plugin-status")).toHaveText("Activ");

  // ACP → Rame avatar: catalogul implicit, apoi o ramă nouă, încărcată (GCS o recodează în WebP).
  await page.goto(`/admin/plugins/${KEY}/frames`);
  await expect(page.getByTestId("gcs-acp-plugin-page")).toContainText("Inel de foc");
  await page.getByRole("link", { name: "Adaugă ramă" }).click();
  await expect(page).toHaveURL(`/admin/plugins/${KEY}/new/frame`);
  const form = page.locator("form.gcsp-acpForm");
  await form.getByLabel("Nume").fill(`Rama E2E ${id}`);
  await form.getByLabel("Imaginea ramei").setInputFiles({ name: "rama.png", mimeType: "image/png", buffer: framePng() });
  await form.getByLabel("Scara față de avatar (%)").fill("136");
  await form.getByRole("checkbox", { name: "VIP Gold" }).check();
  await form.getByRole("button", { name: "Creează" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/plugins/${KEY.replace(".", "\\.")}/item/\\d+\\?saved=1$`));
  await expect(page.locator(".gcsp-notice--ok")).toContainText("Modificările au fost salvate");
  await expect(page.locator(".gcsp-framePreview img.gcsp-av__frame").first()).toHaveAttribute("src", /\/plugins\/gcs\.vip_studio\/media\/[a-z0-9]+\.webp$/);
  const media = await sql<{ status: string; mime: string }>(`SELECT status, mime FROM plugin_media WHERE "pluginKey" = $1`, [KEY]);
  expect(media).toEqual([{ status: "kept", mime: "image/webp" }]);
});

test("un ne-VIP poate încerca orice în previzualizare, dar „Salvează” deschide „Devino VIP”", async ({ browser }) => {
  const page = await memberInNewContext(browser, `Curios${id}`, `curios-${id}@example.com`, "100.74.1");
  await page.goto(`/p/${KEY}`);
  await expect(studio(page)).toHaveClass(/gcsp-js/);
  await pick(page, "nameStyle", "neon");
  await expect(studio(page).locator('.gcsp-plate [data-gcsp-pv="name"]')).toHaveClass(/gcsp-fx-neon/);
  await expect(studio(page).locator("[data-gcsp-count]")).toHaveText("1 modificare nesalvată");
  await studio(page).locator("[data-gcsp-save]").click();
  await expect(studio(page).locator('[data-gcsp-sheet="vip"]')).toBeVisible();
  await expect(studio(page).locator('[data-gcsp-sheet="vip"]')).toContainText("Devino VIP ca să salvezi");
  expect(await sql(`SELECT 1 FROM ${"plugin_gcs__vip_studio"}.loadouts`)).toEqual([]);
  await page.context().close();
});

test("un VIP își alege echipamentul: previzualizarea live, numărătoarea și salvarea", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const page = await memberInNewContext(browser, `Vip${id}`, vipEmail, "100.74.2");
  await profileFixture(request, { action: "vip", email: vipEmail, groupKey: "vip_gold", days: 30 });
  await page.goto(`/p/${KEY}`);
  await expect(studio(page)).toHaveClass(/gcsp-js/);
  await expect(studio(page)).toContainText("Planul tău: VIP Gold");

  // Stilul numelui cu banda de variante.
  await pick(page, "nameStyle", "neon");
  await studio(page).locator('label.gcsp-swatch:has(input[value="neon:cyan"])').click();
  const plate = studio(page).locator('.gcsp-plate [data-gcsp-pv="name"]');
  await expect(plate).toHaveClass(/gcsp-fx-neon/);
  await expect(plate).toHaveAttribute("style", /--c1:#22D3EE/);

  // Rama încărcată în ACP, banner-ul, fundalul cardului și arma.
  await studio(page).locator('input[name="gcsp_tab_mini"][value="frame"]').locator("..").click();
  await studio(page).locator("label.gcsp-tile--frame", { hasText: `Rama E2E ${id}` }).click();
  await expect(studio(page).locator('.gcsp-card [data-gcsp-pv="frame"]')).toHaveAttribute("src", /\/media\//);
  await studio(page).locator('input[name="gcsp_tab_mini"][value="banner"]').locator("..").click();
  await pick(page, "banner", "gold_shine");
  await expect(studio(page).locator('.gcsp-card [data-gcsp-pv="banner"]')).toHaveClass(/gcsp-pill--shine/);
  await studio(page).locator('input[name="gcsp_tab_mini"][value="card"]').locator("..").click();
  await pick(page, "card", "nebula");
  await expect(studio(page).locator('.gcsp-card [data-gcsp-pv="card"]')).toHaveAttribute("src", /cards\/nebula\.webp/);
  await studio(page).locator('input[name="gcsp_tab_mini"][value="weapon"]').locator("..").click();
  await pick(page, "weapon", "rifle");
  await expect(studio(page).locator('.gcsp-card [data-gcsp-pv="weapon-label"]')).toHaveText("Pușcă de asalt");

  // Profilul complet: fundalul, citatul (numărătoarea caracterelor), tema.
  await studio(page).locator("label.gcsp-mode--full").click();
  await pick(page, "background", "aurora");
  await studio(page).locator('input[name="gcsp_tab_full"][value="quote"]').locator("..").click();
  await studio(page).locator('textarea[name="quote"]').fill("Joc pentru echipă, nu pentru scor.");
  await expect(studio(page).locator("[data-gcsp-quote-count]")).toHaveText("34/200");
  await expect(studio(page).locator('[data-gcsp-pv="quote"]')).toHaveText("Joc pentru echipă, nu pentru scor.");
  await studio(page).locator('input[name="gcsp_tab_full"][value="theme"]').locator("..").click();
  await pick(page, "theme", "carbon");
  await expect(studio(page).locator("[data-gcsp-count]")).toHaveText("8 modificări nesalvate");

  await studio(page).locator("[data-gcsp-save]").click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY.replace(".", "\\.")}\\?saved=1&tab=theme$`));
  await expect(studio(page).locator(".gcsp-notice--ok")).toContainText("Echipamentul a fost salvat");
  await expect(studio(page).locator("[data-gcsp-count]")).toHaveText("Nicio modificare nesalvată");
  const css = await (await request.get("/gcs-names.css")).text();
  const uidRow = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [vipEmail]);
  expect(css).toContain(`[data-name-user="${uidRow[0]!.id}"]`);
  expect(css).toContain(`.gcs-avatar[data-avatar-user="${uidRow[0]!.id}"]::after`);
  await page.context().close();
});

test("echipamentul apare în postbit, în hover card și pe profil, în structura existentă", async ({ page, request, context }) => {
  await useFreshIp(context, "100.74.3");
  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, vipEmail, `Topic VIP ${id}`, 0);
  await page.goto(topic.url);
  const postbit = page.getByTestId("gcs-postbit").first();
  await expect(postbit.getByTestId("gcs-postbit-group")).toHaveText(/VIP Gold/i);
  await expect(postbit.getByTestId("gcs-postbit-group")).toHaveAttribute("data-vip", "banner");
  await expect(postbit.getByTestId("gcs-postbit-cover")).toHaveAttribute("data-vip", "card");
  await expect(postbit.getByTestId("gcs-postbit-weapon")).toContainText("Pușcă de asalt");
  const avatar = postbit.locator(".gcs-avatar[data-avatar-user]");
  expect(await avatar.evaluate((el) => getComputedStyle(el, "::after").backgroundImage)).toMatch(/\/plugins\/gcs\.vip_studio\/media\//);
  const name = postbit.locator(".gcs-post__authorName a.gcs-userLink");
  expect(await name.evaluate((el) => getComputedStyle(el).textShadow)).not.toBe("none");

  // Hover card: banner-ul, fundalul copertei și arma.
  await name.hover();
  const card = page.getByTestId("gcs-hover-card");
  await expect(card.getByTestId("gcs-hover-vip-banner")).toHaveText("VIP Gold");
  await expect(card.getByTestId("gcs-hover-weapon")).toBeVisible();
  await expect(card.getByTestId("gcs-hover-cover")).toHaveAttribute("data-vip", "card");

  // Profilul: fundalul în spatele paginii, pastila, arma în statistici, citatul și tema (variabile CSS).
  await name.click();
  await expect(page.getByTestId("gcs-profile")).toBeVisible();
  await expect(page.getByTestId("gcs-profile-backdrop")).toBeAttached();
  await expect(page.getByTestId("gcs-profile-vip-banner")).toHaveText("VIP Gold");
  await expect(page.getByTestId("gcs-profile-weapon")).toContainText("Pușcă de asalt");
  await expect(page.getByTestId("gcs-profile-quote")).toContainText("Joc pentru echipă, nu pentru scor.");
  expect(await page.locator('[data-vip="theme"]').evaluate((el) => getComputedStyle(el).getPropertyValue("--gcs-accent").trim())).toBe("#22D3EE");
});

test("widget-ul „VIP online” arată membrul VIP cu numele, rama și banner-ul lui", async () => {
  const page = rootPage;
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-page-editor").click();
  await expect(page.getByTestId("gcs-page-editor")).toBeVisible();
  await page.getByTestId("gcs-widget-add-sidebar").click();
  await page.getByTestId("gcs-widget-catalog-sidebar").getByRole("listitem").filter({ hasText: "VIP online" }).click();
  await page.getByTestId("gcs-page-editor-save").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a fost salvată.");
  await page.getByTestId("gcs-page-editor-done").click();
  const widget = page.locator(WIDGET).filter({ visible: true });
  await expect(widget).toContainText(`Vip${id}`);
  await expect(widget.locator("[data-gcsp-roster]")).toHaveAttribute("data-gcsp-ready", "1");
  await expect(widget.locator("a.gcs-userLink", { hasText: `Vip${id}` }).first()).toHaveClass(/gcsp-fx-neon/);
});

test("VIP expirat: aspectul dispare de pe site, alegerile rămân în studio", async ({ request, browser }) => {
  await profileFixture(request, { action: "expire", email: vipEmail });
  // Expirarea propriu-zisă (jobul VIP din worker, rulat aici pe loc): emite `vip.expired`.
  await profileFixture(request, { action: "sweep" });
  const userRow = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [vipEmail]);
  await expect.poll(async () => (await sql(`SELECT 1 FROM member_appearances WHERE "userId" = $1`, [userRow[0]!.id])).length, { timeout: 15_000 }).toBe(0);
  const rows = await sql<{ data: { nameStyle?: string } }>(`SELECT data FROM plugin_gcs__vip_studio.loadouts WHERE user_id = $1`, [userRow[0]!.id]);
  expect(rows[0]?.data.nameStyle).toBe("neon");
  void browser;
});
