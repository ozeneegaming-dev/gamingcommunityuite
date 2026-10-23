import { e2eKv } from "./kv";
import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/** CSS-ul publicat al temei implicite (ce primesc vizitatorii). */
const publicCss = async (page: Page) => (await page.request.get(`/gcs-theme.css?t=gcs-dark&r=${Date.now()}`)).text();

/** Documentul din iframe-ul previzualizării. */
async function previewFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId("gcs-css-preview").elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("previzualizarea nu are document");
  return frame;
}

const letterSpacing = (frame: Frame) => frame.evaluate(() => getComputedStyle(document.querySelector('[data-testid="gcs-brand"]')!).letterSpacing);

/** Înlocuiește tot textul din editorul CodeMirror (încărcat leneș). */
async function replaceCode(editor: Locator, text: string): Promise<void> {
  await expect(editor).toHaveAttribute("data-ready", "1");
  await editor.locator(".cm-content").click();
  await editor.page().keyboard.press("ControlOrMeta+a");
  await editor.page().keyboard.insertText(text);
}

/** Curățenie: fișierele create de test dispar, iar cache-ul temelor se golește (alte teste văd aspectul implicit). */
async function cleanup(prefix: string): Promise<void> {
  await sql(`DELETE FROM theme_css_files WHERE name LIKE $1`, [`${prefix}%`]);
  await sql(`UPDATE themes SET version = version + 1`);
  const redis = await e2eKv();
  try {
    const keys = await redis.keys("gcs:k:themes*");
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

/**
 * ACP → Aspect → CSS: un fișier nou, CSS-ul nesalvat se vede în previzualizare (nu și pe site), salvarea îl publică
 * (cu raportul a ce s-a scos), o versiune veche se restaurează din istoric, iar la final fișierul e șters.
 */
test("CSS: fișier nou, previzualizare live, salvare, raportul sanitizării și restaurarea unei versiuni", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.72.0");
  const id = uid();
  const fileName = `e2e-${id}.css`;
  page.on("dialog", (d) => void d.accept());
  try {
    await enterAcpAsRoot(page, `Css${id}`, `css-${id}@example.com`);

    // Intrarea din meniu: Aspect → CSS.
    await page.goto("/admin/appearance/themes");
    await page.getByRole("link", { name: "CSS", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/appearance\/css/);
    const workspace = page.getByTestId("gcs-css-editor");
    await expect(workspace).toBeVisible();
    await expect(page.getByTestId("gcs-css-title")).toContainText("custom.css");

    // Un fișier nou.
    await page.getByTestId("gcs-css-new-name").fill(`e2e-${id}`);
    await page.getByTestId("gcs-css-new").click();
    await expect(page).toHaveURL(/file=\d+/);
    await expect(page.getByTestId("gcs-css-title")).toContainText(fileName);

    // Previzualizarea: site-ul în iframe; CSS-ul nesalvat se aplică imediat.
    const frame = await previewFrame(page);
    await expect(frame.getByTestId("gcs-brand")).toBeVisible();
    const editor = page.getByTestId("gcs-css-code");
    await replaceCode(editor, `.gcs-brand { letter-spacing: 7px; }\n@import url("https://evil.example/x.css");`);
    await expect.poll(() => letterSpacing(frame)).toBe("7px");
    expect(await publicCss(page)).not.toContain("letter-spacing: 7px");

    // Salvarea: CSS-ul public îl conține; @import-ul străin e scos, iar raportul spune de ce.
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByTestId("gcs-css-status")).toHaveText("Salvat: vizitatorii văd noul CSS.");
    await expect(page.getByTestId("gcs-css-report")).toContainText("@import e permis doar de la Google Fonts");
    let css = await publicCss(page);
    expect(css).toContain(`/* ${fileName} */`);
    expect(css).toContain("letter-spacing: 7px");
    expect(css).not.toContain("evil.example");

    // Un vizitator vede CSS-ul nou pe site.
    const visitor = await context.browser()!.newPage();
    await visitor.goto("/");
    await expect.poll(() => visitor.evaluate(() => getComputedStyle(document.querySelector('[data-testid="gcs-brand"]')!).letterSpacing)).toBe("7px");
    await visitor.close();

    // A doua versiune, apoi restaurarea primei din istoric.
    await replaceCode(editor, ".gcs-brand { letter-spacing: 9px; }");
    await page.getByTestId("gcs-css-save").click();
    await expect(page.getByTestId("gcs-css-status")).toHaveText("Salvat: vizitatorii văd noul CSS.");
    expect(await publicCss(page)).toContain("letter-spacing: 9px");

    await page.getByTestId("gcs-css-tab-history").click();
    const items = page.getByTestId("gcs-history-item");
    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText("Salvat");
    await expect(items.last()).toContainText("Creat");
    // Diferențele ultimei versiuni față de cea anterioară: 7px → 9px.
    await expect(page.getByTestId("gcs-diff")).toContainText("letter-spacing: 9px");
    await items.nth(1).click();
    await page.getByTestId("gcs-history-restore").click();
    await expect(page.getByTestId("gcs-css-status")).toHaveText("Versiunea a fost restaurată.");
    await expect(items).toHaveCount(4);
    await expect(items.first()).toContainText("Restaurat");
    css = await publicCss(page);
    expect(css).toContain("letter-spacing: 7px");
    expect(css).not.toContain("letter-spacing: 9px");

    // Ștergerea fișierului: CSS-ul lui dispare de pe site.
    await page.getByTestId("gcs-css-delete").click();
    await expect(page.getByTestId("gcs-css-title")).toContainText("custom.css");
    await expect(page.getByTestId("gcs-css-file").filter({ hasText: fileName })).toHaveCount(0);
    expect(await publicCss(page)).not.toContain(fileName);
  } finally {
    await cleanup("e2e-");
  }
});

test("CSS: custom.css nu se poate șterge; un membru fără drept nu vede pagina", async ({ page, context }) => {
  await useFreshIp(context, "100.72.1");
  const id = uid();
  await enterAcpAsRoot(page, `CssB${id}`, `css-b-${id}@example.com`);
  await page.goto("/admin/appearance/css");
  await expect(page.getByTestId("gcs-css-title")).toContainText("custom.css");
  await expect(page.getByTestId("gcs-css-delete")).toHaveCount(0);
  await expect(page.getByTestId("gcs-css-rename")).toHaveCount(0);

  const other = await context.browser()!.newPage();
  const res = await other.goto("/admin/appearance/css");
  expect(res?.status()).toBe(404);
  await other.close();
});
