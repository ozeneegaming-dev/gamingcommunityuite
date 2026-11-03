import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { fixture, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Cardurile de forum în vederea în grilă (macheta „Carduri de forum”): zona de imagine în cele patru stări (imaginea din
 * ACP, prima poză a ultimei postări, previzualizarea generată cu titlul și autorul, gradientul unui forum gol), cardurile
 * de aceeași înălțime pe rând, trei pe rând pe desktop și unul pe telefon fără scroll orizontal, contoarele pe rândul
 * titlului (fără butonul statisticilor), clicul pe zona goală → forumul, pe un subforum → subforumul; din ACP, modul
 * „Imaginea mea” cu o imagine încărcată și decupată apare pe card. Capturile: `GCS_E2E_SHOTS=<folder>`.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
/** Un PNG de 120 × 40 (o culoare), încărcat din ACP ca imagine de previzualizare. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

type Ref = { id: number; slug: string };
type Box = { x: number; y: number; width: number; height: number };
let id = "";
let categoryName = "";
let authorName = "";
let authorEmail = "";
let subName = "";
let acpImage = "";
const forums = {} as Record<"acp" | "photo" | "text" | "empty", Ref>;
let sub: Ref;
let textTitle = "";

test.beforeAll(async ({ request }) => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  id = uid();
  categoryName = `Carduri ${id}`;
  authorName = `Spike${id}`;
  authorEmail = `cards-${id}@example.com`;
  await sql(`INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`, [
    `e2ecards${id}`,
    authorName,
    authorName.toLowerCase(),
    authorEmail,
  ]);
  const category = await fixture<Ref>(request, { action: "forum", parentId: null, type: "CATEGORY", name: categoryName });
  const make = (name: string, color: string, icon: string) => fixture<Ref>(request, { action: "forum", parentId: category.id, type: "FORUM", name, color, icon });
  // În ordinea din categorie: primul rând (trei carduri) și al doilea.
  forums.acp = await make(`Servere ${id}`, "#DF390C", "fa-solid fa-server");
  forums.photo = await make(`Recrutări ${id}`, "#F2B33D", "fa-solid fa-users");
  forums.text = await make(`Off-topic ${id}`, "#4D9BE6", "fa-solid fa-comments");
  forums.empty = await make(`Reclamații ${id}`, "#9B78DC", "fa-solid fa-gavel");
  subName = `Cereri admin ${id}`;
  sub = await fixture<Ref>(request, { action: "forum", parentId: forums.acp.id, type: "FORUM", name: subName });

  // (a) imaginea din ACP are prioritate față de ultima postare; (b) ultima postare cu o poză atașată;
  // (c) ultima postare fără poze: previzualizarea generată; (d) forumul gol.
  await fixture(request, { action: "topic", forumId: forums.acp.id, title: `IP nou pentru MIX2 ${id}`, text: "Serverul are IP nou.", authorEmail, images: 1 });
  acpImage = (await fixture<{ imageId: string }>(request, { action: "forumPreview", forumId: forums.acp.id, mode: "image", image: true, focusX: 30, focusY: 50 })).imageId;
  await fixture(request, { action: "topic", forumId: forums.photo.id, title: `[ARC] recrutează ${id}`, text: "Turneul de vineri.", authorEmail, images: 1 });
  textTitle = `Ce placă video folosiți ${id}?`;
  await fixture(request, { action: "topic", forumId: forums.text.id, title: textTitle, text: "Am trecut de la o 1660 la o 4060.", authorEmail });
});

async function visitor(browser: Browser, opts: { width: number; light?: boolean; ip: string }) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: opts.width, height: opts.width < 400 ? 812 : 900 } });
  await useFreshIp(context, opts.ip);
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.addCookies([
    { name: "gcs-forum-view", value: "grid", domain: url.hostname, path: "/" },
    { name: "gcs-skin", value: opts.light ? "gcs-white" : "gcs-dark", domain: url.hostname, path: "/" },
  ]);
  return { context, page: await context.newPage() };
}

const categoryOf = (page: Page) => page.locator(".gcs-category").filter({ has: page.getByRole("heading", { name: categoryName, exact: true }) });
const cardOf = (page: Page, forum: Ref) => categoryOf(page).locator(`[data-testid="gcs-forum-row"][data-forum-id="${forum.id}"]`);

/** Imaginea s-a încărcat (cardurile își încarcă imaginile leneș, la derulare). */
async function expectLoaded(img: Locator) {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await categoryOf(page).screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test("grila (1440 px, GCS Dark): cele patru stări ale zonei de imagine, trei carduri pe rând de aceeași înălțime, contoarele pe rândul titlului", async ({ browser }) => {
  const { context, page } = await visitor(browser, { width: 1440, ip: "100.93.1" });
  await page.goto("/");
  await expect(page.getByTestId("gcs-forum-index")).toHaveAttribute("data-view", "grid");
  const category = categoryOf(page);
  await category.scrollIntoViewIfNeeded();

  // (a) Imaginea din ACP, cu focalizarea decupajului.
  const acp = cardOf(page, forums.acp).getByTestId("gcs-forum-card-media");
  await expect(acp).toHaveAttribute("data-kind", "image");
  await expect(acp).toHaveAttribute("data-source", "acp");
  const acpImg = acp.locator("img");
  await expect(acpImg).toHaveAttribute("src", `/files/${acpImage}`);
  expect(await acpImg.evaluate((el) => getComputedStyle(el).objectPosition)).toBe("30% 50%");
  expect(await acpImg.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
  await expectLoaded(acpImg);

  // (b) Prima poză din ultima postare (atașamentul ei, vizibil vizitatorului).
  const photo = cardOf(page, forums.photo).getByTestId("gcs-forum-card-media");
  await expect(photo).toHaveAttribute("data-source", "post");
  const photoImg = photo.locator("img");
  await expect(photoImg).toHaveAttribute("src", /^\/files\/[A-Za-z0-9_-]+$/);
  expect(await photoImg.getAttribute("src")).not.toBe(`/files/${acpImage}`);
  await expectLoaded(photoImg);

  // (c) Ultima postare fără poze: titlul topicului, primele rânduri și autorul, peste culoarea forumului.
  const text = cardOf(page, forums.text).getByTestId("gcs-forum-card-media");
  await expect(text).toHaveAttribute("data-kind", "generated");
  const generated = text.getByTestId("gcs-forum-card-generated");
  await expect(generated.locator(".gcs-forumCard__genTitle")).toHaveText(textTitle);
  await expect(generated.locator(".gcs-forumCard__genText")).toContainText("Am trecut de la o 1660 la o 4060.");
  await expect(generated.locator(".gcs-forumCard__genBy")).toContainText(authorName);
  expect(await generated.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");

  // (d) Forumul gol: gradientul cu iconița mare; „Niciun mesaj încă” jos.
  const empty = cardOf(page, forums.empty);
  await expect(empty.getByTestId("gcs-forum-card-media")).toHaveAttribute("data-kind", "empty");
  await expect(empty.getByTestId("gcs-forum-card-empty").locator("svg")).toBeVisible();
  await expect(empty.getByTestId("gcs-forum-card-last")).toHaveText("Niciun mesaj încă");

  // Contoarele pe rândul titlului; în grilă nu mai e butonul pătrat cu bula.
  await expect(cardOf(page, forums.photo).getByTestId("gcs-forum-card-stats")).toHaveText("1 topic / 1 postare");
  await expect(category.getByTestId("gcs-forum-stats-btn")).toHaveCount(0);
  // Ultimul mesaj: titlul topicului și „Ultimul răspuns de <nume>, <când>”, cu numele colorat după grup.
  const last = cardOf(page, forums.text).getByTestId("gcs-forum-card-last");
  await expect(last.getByRole("link", { name: textTitle })).toBeVisible();
  await expect(last).toContainText(`Ultimul răspuns de ${authorName}`);
  await expect(last.locator(`[data-user-id="e2ecards${id}"]`)).toHaveClass(/gcs-name--/);
  // Subforumul fără mesaje noi: dosarul conturat.
  await expect(cardOf(page, forums.acp).getByTestId("gcs-subforums").locator("li").first()).not.toHaveAttribute("data-unread", "");
  await expect(cardOf(page, forums.acp).getByTestId("gcs-subforums").locator("svg").first()).toHaveAttribute("data-icon", "far-folder");

  // Trei pe rând, toate de aceeași înălțime pe rând; al patrulea începe rândul următor.
  const boxes = await Promise.all([forums.acp, forums.photo, forums.text, forums.empty].map(async (f) => (await cardOf(page, f).boundingBox())!));
  const [a, b, c, d] = boxes as [Box, Box, Box, Box];
  for (const box of [b, c]) {
    expect(Math.abs(box.y - a.y)).toBeLessThan(1);
    expect(Math.abs(box.height - a.height)).toBeLessThan(1);
  }
  expect(d.y).toBeGreaterThan(a.y + a.height - 1);
  // Zona de imagine are forma 16 : 7.
  const media = (await acp.boundingBox())!;
  expect(Math.abs(media.width / media.height - 16 / 7)).toBeLessThan(0.05);

  // Hover: chenarul se colorează spre culoarea forumului, fără mărire.
  const card = cardOf(page, forums.photo);
  const before = await card.evaluate((el) => getComputedStyle(el).borderColor);
  await card.hover({ position: { x: 8, y: 8 } });
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(before);
  expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await page.mouse.move(0, 0);
  await shot(page, "forum-cards-dark-1440");
  await context.close();
});

test("clic pe zona goală a cardului (imaginea sau colțul) → forumul; clic pe un subforum → subforumul", async ({ browser }) => {
  const { context, page } = await visitor(browser, { width: 1440, ip: "100.93.2" });
  await page.goto("/");
  const card = cardOf(page, forums.acp);
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
  const forumUrl = new RegExp(`/forum/${forums.acp.id}-${forums.acp.slug}$`);
  // Mijlocul imaginii (decorativă: clicul ajunge la linkul cardului).
  const media = (await card.getByTestId("gcs-forum-card-media").boundingBox())!;
  await page.mouse.click(media.x + media.width / 2, media.y + media.height / 2);
  await expect(page).toHaveURL(forumUrl);
  await page.goBack();
  // Colțul de jos din stânga (nici titlu, nici alt link).
  const box = (await cardOf(page, forums.acp).boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + box.height - 6);
  await expect(page).toHaveURL(forumUrl);
  await page.goBack();
  const link = cardOf(page, forums.acp).getByTestId("gcs-subforums").getByRole("link", { name: subName });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/forum/${sub.id}-${sub.slug}$`));
  await context.close();
});

test("telefon (375 px): un card pe rând, fără scroll orizontal", async ({ browser }) => {
  const { context, page } = await visitor(browser, { width: 375, ip: "100.93.3" });
  await page.goto("/");
  await expect(page.getByTestId("gcs-forum-index")).toHaveAttribute("data-view", "grid");
  await categoryOf(page).scrollIntoViewIfNeeded();
  const xs = await Promise.all([forums.acp, forums.photo, forums.text, forums.empty].map(async (f) => (await cardOf(page, f).boundingBox())!));
  for (const box of xs) {
    expect(Math.abs(box.x - xs[0]!.x)).toBeLessThan(1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  expect(xs[1]!.y).toBeGreaterThan(xs[0]!.y + xs[0]!.height - 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, "forum-cards-dark-375");
  await context.close();
});

test("GCS White (1440 px): aceleași carduri, pe tokenurile temei luminoase", async ({ browser }) => {
  const { context, page } = await visitor(browser, { width: 1440, light: true, ip: "100.93.4" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const card = cardOf(page, forums.text);
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId("gcs-forum-card-media")).toHaveAttribute("data-kind", "generated");
  // Titlul cardului în culoarea titlurilor temei (închisă pe tema luminoasă), nu alb.
  const color = await card.locator(".gcs-forumCard__title").evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("rgb(255, 255, 255)");
  await expectLoaded(cardOf(page, forums.acp).locator("img").first());
  await shot(page, "forum-cards-light-1440");
  await context.close();
});

test("ACP: „Imaginea mea” cu o imagine încărcată și decupată apare pe card; un subforum cu mesaje noi are dosarul plin", async ({ page, context, request }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.93.5");
  const admin = uid();
  await enterAcpAsRoot(page, `CardAdm${admin}`, `cardadm-${admin}@example.com`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "gcs-cards-"));
  const file = path.join(dir, "previzualizare.png");
  writeFileSync(file, PNG);

  await page.goto(`/admin/community/forums/${forums.photo.id}`);
  const field = page.getByTestId("gcs-forum-preview");
  await expect(field.getByTestId("gcs-forum-preview-mode-auto")).toBeChecked();
  await field.getByTestId("gcs-forum-preview-mode-image").check();
  await field.getByTestId("gcs-forum-preview-file").setInputFiles(file);
  await expect(field.getByTestId("gcs-forum-preview-image")).toBeVisible({ timeout: 20_000 });
  // Imaginea (120 × 40) e mai lată decât cardul: chenarul se mută pe orizontală, din săgeți.
  const crop = field.getByTestId("gcs-forum-preview-crop");
  await expect(crop).toHaveAttribute("aria-orientation", "horizontal");
  await crop.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(crop).toHaveAttribute("aria-valuenow", "60");
  await page.getByRole("button", { name: "Salvează forumul" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Salvat");
  const [saved] = await sql<{ previewMode: string; previewImageId: string | null; previewFocusX: number }>(`SELECT "previewMode", "previewImageId", "previewFocusX" FROM forums WHERE id = $1`, [forums.photo.id]);
  expect(saved).toMatchObject({ previewMode: "image", previewFocusX: 60 });
  expect(saved!.previewImageId).toBeTruthy();

  // Un topic nou în subforum, după înregistrarea adminului: pentru el, subforumul are mesaje noi.
  await fixture(request, { action: "topic", forumId: sub.id, title: `Cerere nouă ${id}`, text: "Vreau admin.", authorEmail });

  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.addCookies([{ name: "gcs-forum-view", value: "grid", domain: url.hostname, path: "/" }]);
  await page.goto("/");
  const media = cardOf(page, forums.photo).getByTestId("gcs-forum-card-media");
  await expect(media).toHaveAttribute("data-source", "acp");
  const img = media.locator("img");
  await expect(img).toHaveAttribute("src", `/files/${saved!.previewImageId}`);
  expect(await img.evaluate((el) => getComputedStyle(el).objectPosition)).toBe("60% 50%");
  await expectLoaded(img);
  const subRow = cardOf(page, forums.acp).getByTestId("gcs-subforums").locator("li").first();
  await expect(subRow).toHaveAttribute("data-unread", "");
  await expect(subRow.locator("svg").first()).toHaveAttribute("data-icon", "fas-folder");

  // „Doar culoarea forumului”: gradientul, chiar cu imaginea încărcată.
  await page.goto(`/admin/community/forums/${forums.photo.id}`);
  await page.getByTestId("gcs-forum-preview-mode-color").check();
  await page.getByRole("button", { name: "Salvează forumul" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Salvat");
  await page.goto("/");
  await expect(cardOf(page, forums.photo).getByTestId("gcs-forum-card-media")).toHaveAttribute("data-kind", "empty");
});
