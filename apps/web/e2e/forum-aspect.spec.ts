import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { forumTree, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, totp, useFreshIp } from "./helpers";

/**
 * Aspect forumuri (pluginul `gcs.forum_aspect`): Root Admin îl instalează din ACP, apoi în tabul „Aspect” al unui forum
 * încarcă o iconiță (SVG, curățat și recodat în WebP), alege titlul în gradient, eticheta deasupra și fundalul „Doar în
 * dreapta” la 70%, cu previzualizarea live. Indexul arată totul în GCS Dark și în GCS White, voalul se schimbă la hover;
 * oprit, forumul arată implicit, repornit, aspectul revine. La final, banda unui widget primește imaginea și eticheta.
 * Pluginul nu are bază proprie (merge și pe MySQL / Lite).
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const ZIP = path.join(SDK_DIR, "plugins/forum-aspect/dist/gcs.forum_aspect-1.0.0.zip");
const KEY = "gcs.forum_aspect";
const EXT = `plugin.${KEY}`;
const FILES = mkdtempSync(path.join(os.tmpdir(), "gcs-aspect-"));
const ICON = path.join(FILES, "iconita.svg");
const BG = path.join(FILES, "fundal.svg");

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.GCS_E2E_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.beforeAll(() => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-forum-aspect.ts"], { cwd: SDK_DIR, stdio: "pipe" });
  // Imaginile testului: desenate aici (fără imagini ale altora); iconița are și un script, care trebuie să dispară.
  writeFileSync(ICON, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><rect width="24" height="24" rx="5" fill="#FF6A3D"/><circle cx="12" cy="12" r="6" fill="#FFFFFF"/></svg>');
  writeFileSync(BG, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 240"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#1B0F33"/><stop offset="1" stop-color="#FF4DB8"/></linearGradient></defs><rect width="1600" height="240" fill="url(#g)"/></svg>');
});

test.afterAll(async () => {
  await sql(`UPDATE plugins SET enabled = false WHERE key = $1`, [KEY]).catch(() => {});
});

/** Pornește / oprește pluginul din ACP → Aplicații (oprirea cere confirmarea din pagină). */
async function setPlugin(page: Page, on: boolean): Promise<void> {
  await page.goto("/admin/system/applications");
  const toggle = page.getByTestId(`gcs-plugin-toggle-${KEY}`);
  if ((await toggle.isChecked()) === on) return;
  await expect(async () => {
    if (!(await page.getByRole("dialog").isVisible())) await toggle.click();
    if (!on) await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  if (!on) await page.getByRole("dialog").getByRole("button", { name: "Oprește" }).click();
  await expect(toggle).toBeChecked({ checked: on });
  await expect.poll(async () => (await sql<{ enabled: boolean | number }>(`SELECT enabled FROM plugins WHERE key = $1`, [KEY]))[0]?.enabled).toBe(on ? (await isMysqlBool()) : (await isMysqlBool(false)));
}

/** MySQL întoarce booleanele ca 0 / 1. */
async function isMysqlBool(value = true): Promise<boolean | number> {
  const [row] = await sql<{ v: boolean | number }>(`SELECT ${value ? "true" : "false"} AS v`);
  return row!.v;
}

/** Tema văzută de vizitator: GCS Dark (implicită) sau GCS White. */
async function useTheme(context: BrowserContext, theme: "dark" | "white"): Promise<void> {
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.clearCookies({ name: "gcs-skin" });
  await context.addCookies([
    { name: "gcs-theme", value: theme === "white" ? "light" : "dark", domain: url.hostname, path: "/" },
    ...(theme === "white" ? [{ name: "gcs-skin", value: "gcs-white", domain: url.hostname, path: "/" }] : []),
  ]);
}

const styleOf = (l: Locator, prop: string, pseudo: string | null = null) => l.evaluate((el, [p, ps]) => getComputedStyle(el, ps).getPropertyValue(p!), [prop, pseudo] as const);

test("aspectul unui forum din pluginul instalat: tabul cu previzualizare, indexul în GCS Dark și White, hover, oprit / pornit, banda unui widget", async ({ page, context, request }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.94.0");
  const id = uid();
  const secret = await enterAcpAsRoot(page, `AspAdm${id}`, `aspadm-${id}@example.com`);

  // 1. Instalarea din ACP (pachet nesemnat în teste: codul 2FA și cheia tastată).
  await page.goto("/admin/system/applications");
  await page.getByTestId("gcs-plugin-upload").locator('input[type="file"]').setInputFiles(ZIP);
  await page.getByTestId("gcs-plugin-upload").getByRole("button", { name: "Încarcă și verifică" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await expect(page.getByTestId("gcs-plugin-checks").locator('[data-level="error"]')).toHaveCount(0);
  const confirm = page.getByTestId("gcs-plugin-confirm");
  await confirm.getByLabel("Codul 2FA (din aplicația de autentificare)").fill(totp(secret));
  await confirm.getByLabel(`Scrie cheia pluginului (${KEY}) ca să confirmi`).fill(KEY);
  await confirm.getByRole("button", { name: "Instalează pluginul" }).click();
  await expect(confirm.getByRole("status").filter({ hasText: "Salvat" }).or(page.getByTestId("gcs-plugin-header")).first()).toBeVisible({ timeout: 30_000 });

  // 2. Tabul „Aspect” al forumului: iconița, gradientul, eticheta deasupra, fundalul „Doar în dreapta” la 70%.
  const t = await forumTree(request);
  await page.goto(`/admin/community/forums/${t.forum.id}?tab=${encodeURIComponent(`x:${EXT}:aspect`)}`);
  const card = page.getByTestId(`gcs-forum-ext-${EXT}-aspect`);
  await expect(card).toBeVisible();
  await card.getByTestId("gcs-ext-icon-file").setInputFiles(ICON);
  await expect(card.getByTestId("gcs-ext-icon").locator("img")).toBeVisible({ timeout: 20_000 });
  await card.getByTestId("gcs-ext-titleGradient").getByRole("checkbox").uncheck();
  await card.getByTestId("gcs-ext-tag").fill("Recrutăm");
  await card.getByTestId("gcs-ext-tagColor").selectOption("warn");
  await card.getByTestId("gcs-ext-tagPlace").selectOption("above");
  await card.getByTestId("gcs-ext-bg-file").setInputFiles(BG);
  await expect(card.getByTestId("gcs-ext-bg").locator("img")).toBeVisible({ timeout: 20_000 });
  await card.getByTestId("gcs-ext-bgStyle").selectOption("right");
  await card.getByTestId("gcs-ext-veil").fill("70");
  // Previzualizarea live: rândul cu valorile încă nesalvate.
  const preview = page.frameLocator('[data-testid="gcs-aspect-preview-frame"]').getByTestId("gcs-forum-row").first();
  await expect(preview).toHaveClass(/gcs-forumRow--image-right/, { timeout: 20_000 });
  await expect(preview).toHaveClass(/gcs-forumRow--iconImage/);
  await expect(preview.locator(".gcs-slotChip--above")).toHaveText("Recrutăm");
  await shot(page, "aspect-acp-tab");
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();

  // Iconița încărcată e WebP (SVG-ul curățat și recodat), publică.
  const [icon] = await sql<{ mime: string; contentType: string }>(`SELECT mime, "contentType" FROM attachments WHERE "contentId" = $1`, [`forum:${t.forum.id}:icon`]);
  expect(icon).toMatchObject({ mime: "image/webp", contentType: "decor.image" });

  // 3. Indexul, în GCS Dark și în GCS White: iconița-imagine, titlul în gradient, eticheta deasupra, fundalul în dreapta.
  const row = page.locator(`[data-testid="gcs-forum-row"][data-forum-id="${t.forum.id}"]`);
  for (const theme of ["dark", "white"] as const) {
    await useTheme(context, theme);
    await page.goto("/");
    await expect(row).toHaveClass(/gcs-forumRow--iconImage/);
    await expect(row).toHaveClass(/gcs-forumRow--image-right/);
    await expect(row).toHaveAttribute("style", /--gcs-forum-row-veil:\s*70%/);
    await expect(row.locator(".gcs-slotChip--above")).toHaveText("Recrutăm");
    expect(await styleOf(row.locator(".gcs-forumRow__title > a"), "background-image")).toContain("linear-gradient");
    expect(await styleOf(row.locator(".gcs-forumRow__icon"), "background-image")).toMatch(/url\(.*\/files\//);
    await row.scrollIntoViewIfNeeded();
    await shot(page, `aspect-index-${theme}`);
  }

  // 4. Hover: voalul se subțiază (masca de deasupra imaginii se schimbă).
  await useTheme(context, "dark");
  await page.goto("/");
  await page.mouse.move(0, 0);
  const before = await styleOf(row, "mask-image", "::after");
  await row.hover();
  await expect.poll(() => styleOf(row, "mask-image", "::after")).not.toBe(before);

  // 5. Pluginul oprit: forumul arată implicit (valorile rămân); pornit, aspectul revine.
  await setPlugin(page, false);
  await page.goto("/");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveClass(/gcs-forumRow--image/);
  await expect(row.locator(".gcs-slotChip--above")).toHaveCount(0);
  await setPlugin(page, true);
  await page.goto("/");
  await expect(row).toHaveClass(/gcs-forumRow--image-right/);
  await expect(row.locator(".gcs-slotChip--above")).toHaveText("Recrutăm");

  // 6. Un widget: banda de titlu cu imaginea, titlul colorat și eticheta (ACP → Aspect → Widget-uri → Aspect).
  await page.goto("/admin/appearance/widgets");
  // Un widget al indexului desenat cu cardul comun (titlul cu bandă), în ordinea preferinței.
  let widgetType = "";
  for (const type of ["forums.recentTopics", "forums.recentPosts", "core.newMembers", "forums.stats", "profile.recentBadges"]) {
    if ((await page.locator(`ul[data-page="index"] [data-testid="gcs-widget-aspect-link"][data-widget="${type}"]`).count()) > 0) {
      widgetType = type;
      break;
    }
  }
  expect(widgetType, "un widget cu cardul comun pe index").not.toBe("");
  await page.locator(`ul[data-page="index"] [data-testid="gcs-widget-aspect-link"][data-widget="${widgetType}"]`).first().click();
  const wcard = page.getByTestId(`gcs-widget-ext-${EXT}-aspect`);
  await wcard.getByTestId("gcs-ext-bg-file").setInputFiles(BG);
  await expect(wcard.getByTestId("gcs-ext-bg").locator("img")).toBeVisible({ timeout: 20_000 });
  await wcard.getByTestId("gcs-ext-titleColor").fill("#3DDC97");
  await wcard.getByTestId("gcs-ext-tag").fill("Live");
  await wcard.getByRole("button", { name: "Salvează" }).click();
  await expect(wcard.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();
  await page.goto("/");
  const widget = page.locator(`section.gcs-widget[data-widget="${widgetType}"]`).first();
  await expect(widget).toHaveClass(/gcs-widget--image/);
  await expect(widget.locator(".gcs-widgetTitle .gcs-slotChip")).toHaveText("Live");
  expect(await styleOf(widget.locator(".gcs-widgetTitle__text"), "color")).toBe("rgb(61, 220, 151)");
  await widget.scrollIntoViewIfNeeded();
  await shot(page, "aspect-widget");
});
