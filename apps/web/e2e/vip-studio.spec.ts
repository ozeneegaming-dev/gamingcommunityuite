import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp, onMysql } from "./helpers";

// Ediția Lite pe MySQL: pluginurile cu bază de date proprie (aici și Studio VIP) nu sunt suportate.
test.skip(onMysql, "pluginurile cu bază de date proprie rulează doar pe PostgreSQL");

/**
 * Studio VIP (pluginul `gcs.vip_studio`, semnat cu cheia de test a rulării): instalarea din ACP, intrarea din meniul
 * principal, o ramă nouă încărcată din ACP și mai multe rame animate încărcate odată (servite ca WebP animat), studioul
 * unui membru VIP (alegeri → previzualizarea live → numărătoarea → salvarea), apoi aspectul în postbit, hover card și
 * pe profil, widget-ul „VIP online”, refuzul pentru ne-VIP, expirarea și meniul care dispare cu pluginul dezactivat.
 * Cu `GCS_E2E_SHOTS=<folder>`, salvează și capturi (grila stilurilor de nume pe tema închisă și deschisă, postbit-ul
 * și hover card-ul cu câteva efecte), pentru verificarea vizuală.
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const KEY = "gcs.vip_studio";
const VERSION = (JSON.parse(readFileSync(path.join(SDK_DIR, "plugins/vip-studio/plugin.json"), "utf8")) as { version: string }).version;
const UNSIGNED = path.join(SDK_DIR, `plugins/vip-studio/dist/gcs.vip_studio-${VERSION}.zip`);
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
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

/**
 * O ramă animată de test (APNG 192×192, 3 cadre): un inel care își schimbă culoarea. `seed` schimbă nuanțele, ca două
 * rame să fie fișiere diferite.
 */
function apngRing(seed: number): Buffer {
  const size = 192;
  const frame = (r: number, g: number, b: number) => {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - 96, y - 96);
        const o = y * (size * 4 + 1) + 1 + x * 4;
        raw[o] = r;
        raw[o + 1] = g;
        raw[o + 2] = b;
        raw[o + 3] = d > 74 && d < 90 ? 255 : 0;
      }
    }
    return deflateSync(raw);
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const u32 = (...v: number[]) => {
    const b = Buffer.alloc(v.length * 4);
    v.forEach((x, i) => b.writeUInt32BE(x, i * 4));
    return b;
  };
  const ihdr = Buffer.concat([u32(size, size), Buffer.from([8, 6, 0, 0, 0])]);
  const colors: [number, number, number][] = [[255, (seed * 40) % 256, 60], [60, 255, (seed * 70) % 256], [(seed * 90) % 256, 80, 255]];
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("acTL", u32(colors.length, 0))];
  let seq = 0;
  colors.forEach(([r, g, b], i) => {
    parts.push(chunk("fcTL", Buffer.concat([u32(seq++, size, size, 0, 0), Buffer.from([0, 15, 0, 100, 0, 0])])));
    parts.push(i === 0 ? chunk("IDAT", frame(r, g, b)) : chunk("fdAT", Buffer.concat([u32(seq++), frame(r, g, b)])));
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
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
  await page.getByRole("link", { name: "Încarcă de pe calculator (unul)" }).click();
  await expect(page).toHaveURL(`/admin/plugins/${KEY}/new/frame`);
  const form = page.locator("form.gcsp-acpForm");
  await form.getByLabel("Nume").fill(`Rama E2E ${id}`);
  await form.getByLabel("Încarcă de pe calculator: imaginea ramei").setInputFiles({ name: "rama.png", mimeType: "image/png", buffer: framePng() });
  await form.getByLabel("Scara față de avatar (%)").fill("136");
  await form.getByRole("checkbox", { name: "VIP Gold" }).check();
  await form.getByRole("button", { name: "Creează" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/plugins/${KEY.replace(".", "\\.")}/item/\\d+\\?saved=1$`));
  await expect(page.locator(".gcsp-notice--ok")).toContainText("Modificările au fost salvate");
  await expect(page.locator(".gcsp-framePreview img.gcsp-av__frame").first()).toHaveAttribute("src", /\/plugins\/gcs\.vip_studio\/media\/[a-z0-9]+\.webp$/);
  const media = await sql<{ status: string; mime: string }>(`SELECT status, mime FROM plugin_media WHERE "pluginKey" = $1`, [KEY]);
  expect(media).toEqual([{ status: "kept", mime: "image/webp" }]);

  // Meniul principal: „Studio VIP” apare în bara site-ului imediat după instalare.
  await page.goto("/");
  await expect(page.locator("header.gcs-hb").locator(`a[href="/p/${KEY}"]`).first()).toBeAttached();
});

test("ACP: mai multe rame animate odată (APNG), duplicatul sărit, servite ca WebP animat", async () => {
  const page = rootPage;
  await page.goto(`/admin/plugins/${KEY}/frames`);
  const bulk = page.locator("form", { has: page.locator('input[name="files"]') });
  await expect(bulk).toHaveAttribute("enctype", "multipart/form-data");
  await bulk.locator('input[name="files"]').setInputFiles([
    { name: "inel-rosu.png", mimeType: "image/png", buffer: apngRing(1) },
    { name: "inel-verde.png", mimeType: "image/png", buffer: apngRing(2) },
    { name: "inel-rosu - Copie.png", mimeType: "image/png", buffer: apngRing(1) },
  ]);
  await bulk.getByRole("button", { name: "Încarcă fișierele" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/plugins/${KEY.replace(".", "\\.")}/upload/[a-z0-9]+$`));
  const report = page.getByTestId("gcs-acp-plugin-page");
  await expect(report).toContainText("Adăugate: 2 · omise (duplicate): 1 · respinse: 0.");
  await expect(report).toContainText("animată, 3 cadre");
  await expect(report).toContainText("la fel ca „Inel rosu”");
  // Ramele noi sunt în catalog și fișierele lor sunt WebP animate (RIFF … WEBP … ANIM).
  await page.goto(`/admin/plugins/${KEY}/frames`);
  await expect(page.getByTestId("gcs-acp-plugin-page")).toContainText("Inel verde");
  const src = await page.locator('tr:has-text("Inel verde") img.gcsp-av__frame').getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.headers()["content-type"]).toBe("image/webp");
  const bytes = Buffer.from(await res.body());
  expect([bytes.toString("latin1", 0, 4), bytes.toString("latin1", 8, 12), bytes.includes(Buffer.from("ANIM"))]).toEqual(["RIFF", "WEBP", true]);
});

test("un ne-VIP poate încerca orice în previzualizare, dar „Salvează” deschide „Devino VIP”", async ({ browser }) => {
  const page = await memberInNewContext(browser, `Curios${id}`, `curios-${id}@example.com`, "100.74.1");
  await page.goto(`/p/${KEY}`);
  await expect(studio(page)).toHaveClass(/gcsp-js/);
  await pick(page, "nameStyle", "neon_tub");
  await expect(studio(page).locator('.gcsp-plate [data-gcsp-pv="name"]')).toHaveClass(/gcs-nfx--neon/);
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
  await pick(page, "nameStyle", "neon_tub");
  await studio(page).locator('label.gcsp-swatch:has(input[value="neon_tub:cyan"])').click();
  const plate = studio(page).locator('.gcsp-plate [data-gcsp-pv="name"]');
  await expect(plate).toHaveClass(/gcs-nfx--neon/);
  await expect(plate).toHaveAttribute("style", /--nfx-c1:#22D3EE/);

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
  const link = widget.locator("a.gcs-userLink", { hasText: `Vip${id}` }).first();
  await expect(link).toHaveAttribute("data-text", `Vip${id}`);
  expect(await link.evaluate((el) => getComputedStyle(el).textShadow)).not.toBe("none");
});

test("rama animată (APNG încărcat) se mișcă pe postbit; capturile efectelor (cu GCS_E2E_SHOTS)", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const email = `arta-${id}@example.com`;
  const page = await memberInNewContext(browser, `Arta${id}`, email, "100.74.6");
  await profileFixture(request, { action: "vip", email, groupKey: "vip_legend", days: 30 });
  const shot = async (target: { screenshot(o: { path: string; animations: "allow" }): Promise<Buffer> }, name: string) => {
    if (SHOTS) await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "allow" });
  };
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  // Rama animată din lotul încărcat în ACP, aleasă în studio.
  await page.goto(`/p/${KEY}`);
  await expect(studio(page)).toHaveClass(/gcsp-js/);
  await studio(page).locator('input[name="gcsp_tab_mini"][value="frame"]').locator("..").click();
  const frameTile = studio(page).locator("label.gcsp-tile--frame", { hasText: "Inel verde" });
  await expect(async () => {
    if (!(await frameTile.isVisible())) await page.mouse.wheel(0, 700);
    await expect(frameTile).toBeVisible({ timeout: 400 });
  }).toPass({ timeout: 20_000 });
  await frameTile.click();
  await studio(page).locator("[data-gcsp-save]").click();
  await expect(page).toHaveURL(/saved=1/);
  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, email, `Arta ${id}`, 0);
  await page.goto(topic.url);
  const avatar = page.getByTestId("gcs-postbit").first().locator(".gcs-avatar[data-avatar-user]");
  expect(await avatar.evaluate((el) => getComputedStyle(el, "::after").backgroundImage)).toMatch(/\/plugins\/gcs\.vip_studio\/media\/[a-z0-9]+\.webp/);
  // Cadrele se schimbă (WebP-ul animat ca fundal al ramei, redat de browser): două capturi diferite.
  const first = await avatar.screenshot({ animations: "allow" });
  await expect.poll(async () => (await avatar.screenshot({ animations: "allow" })).equals(first), { timeout: 5_000 }).toBe(false);

  if (SHOTS) {
    for (const theme of ["dark", "light"] as const) {
      await page.context().addCookies([{ name: "gcs-theme", value: theme, url: page.url() }]);
      await page.goto(`/p/${KEY}`);
      await expect(studio(page)).toHaveClass(/gcsp-js/);
      await page.evaluate(() => document.querySelectorAll(".gcsp-later").forEach((el) => el.classList.remove("gcsp-later")));
      await page.waitForTimeout(1200);
      await shot(studio(page).locator(".gcsp-panel--name"), `studio-nume-${theme}`);
    }
    await page.context().addCookies([{ name: "gcs-theme", value: "dark", url: page.url() }]);
    // Câteva efecte pe postbit și hover card.
    for (const style of ["infern", "glitch_rgb", "aur_curat", "ploaie_digitala", "tinta", "cosmic", "taietura", "fulger"]) {
      await page.goto(`/p/${KEY}`);
      await expect(studio(page)).toHaveClass(/gcsp-js/);
      await pick(page, "nameStyle", style);
      await studio(page).locator("[data-gcsp-save]").click();
      await expect(page).toHaveURL(/saved=1/);
      await page.goto(topic.url);
      const postbit = page.getByTestId("gcs-postbit").first();
      await page.waitForTimeout(900);
      await shot(postbit, `postbit-${style}`);
      if (style === "infern" || style === "cosmic") {
        await postbit.locator(".gcs-post__authorName a.gcs-userLink").hover();
        const card = page.getByTestId("gcs-hover-card");
        await expect(card).toBeVisible();
        await page.waitForTimeout(700);
        await shot(card, `hovercard-${style}`);
      }
    }
  }
  await page.context().close();
});

test("VIP expirat: aspectul dispare de pe site, alegerile rămân în studio", async ({ request, browser }) => {
  await profileFixture(request, { action: "expire", email: vipEmail });
  // Expirarea propriu-zisă (jobul VIP din worker, rulat aici pe loc): emite `vip.expired`.
  await profileFixture(request, { action: "sweep" });
  const userRow = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [vipEmail]);
  await expect.poll(async () => (await sql(`SELECT 1 FROM member_appearances WHERE "userId" = $1`, [userRow[0]!.id])).length, { timeout: 15_000 }).toBe(0);
  const rows = await sql<{ data: { nameStyle?: string } }>(`SELECT data FROM plugin_gcs__vip_studio.loadouts WHERE user_id = $1`, [userRow[0]!.id]);
  expect(rows[0]?.data.nameStyle).toBe("neon_tub");
  void browser;
});

test("meniul: „Studio VIP” e și în sertarul de pe mobil și dispare când pluginul e dezactivat", async () => {
  const page = rootPage;
  // Pe un ecran îngust, meniul principal e în sertar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // Antetul vine în flux (Suspense): până când React îl dezvăluie, butonul sertarului există de două ori (o copie ascunsă).
  await expect(page.getByTestId("gcs-mobile-nav")).toHaveCount(1);
  await page.getByTestId("gcs-mobile-nav").click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Studio VIP" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });

  // Dezactivat din ACP: intrarea dispare din meniu (fără repornire).
  await page.goto("/admin/system/applications");
  // Oprirea cere confirmare, într-un dialog din pagină (ACP → Aplicații).
  await page.getByTestId(`gcs-plugin-toggle-${KEY}`).click();
  await page.getByTestId("gcs-app-confirm-ok").click();
  await expect(page.getByTestId(`gcs-plugin-toggle-${KEY}`)).not.toBeChecked();
  await expect.poll(async () => {
    await page.goto("/");
    return page.locator("header.gcs-hb").locator(`a[href="/p/${KEY}"]`).count();
  }, { timeout: 20_000 }).toBe(0);
});
