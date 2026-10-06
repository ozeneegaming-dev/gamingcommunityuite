import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/** Documentul din iframe-ul previzualizării șablonului. */
async function previewFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId("gcs-template-preview").elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("previzualizarea nu are document");
  return frame;
}

/** Textul din editor (rândurile randate; șabloanele din test sunt scurte, deci toate sunt pe ecran). */
async function codeOf(editor: Locator): Promise<string> {
  return (await editor.locator(".cm-line").allTextContents()).join("\n");
}

/** Înlocuiește tot textul din editorul CodeMirror (încărcat leneș). */
async function replaceCode(editor: Locator, text: string): Promise<void> {
  await expect(editor).toHaveAttribute("data-ready", "1");
  await editor.locator(".cm-content").click();
  await editor.page().keyboard.press("ControlOrMeta+a");
  await editor.page().keyboard.insertText(text);
}

/** Curățenie: suprascrierile create de test dispar și cache-ul șabloanelor se golește (site-ul revine la React). */
async function cleanup(): Promise<void> {
  await sql(`DELETE FROM theme_templates WHERE key IN ('layout.footer', 'forum.row')`);
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    const keys = await redis.keys("gcs:k:templates*");
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

/**
 * ACP → Aspect → Șabloane: subsolul site-ului modificat cu previzualizare (o eroare apare pe rândul ei), salvat și
 * văzut de vizitatori (formularele rămân, scripturile și atributele on* dispar), apoi „Revino la original”.
 */
test("șabloane: editare cu previzualizare, eroare pe rând, vizibil pe site, sigur, revenire la original", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.73.0");
  const id = uid();
  page.on("dialog", (d) => void d.accept());
  try {
    await enterAcpAsRoot(page, `Tpl${id}`, `tpl-${id}@example.com`);

    // Intrarea din meniu: Aspect → Șabloane, apoi „Subsolul site-ului” din arbore (căutarea îl găsește).
    await page.goto("/admin/appearance/themes");
    await page.getByRole("link", { name: "Șabloane", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/appearance\/templates/);
    // Primul din arbore e subsolul; trecem întâi pe alt șablon, ca să verificăm navigarea din arbore.
    await page.locator('[data-key="forum.row"]').click();
    await expect(page).toHaveURL(/template=forum\.row/);
    await expect(page.getByTestId("gcs-template-title")).toContainText("Rândul unui forum");
    await page.getByTestId("gcs-template-search").fill("subsol");
    await expect(page.getByTestId("gcs-template-item")).toHaveCount(1);
    await page.getByTestId("gcs-template-item").click();
    await expect(page).toHaveURL(/template=layout\.footer/);
    await expect(page.getByTestId("gcs-template-title")).toContainText("Subsolul site-ului");

    // Editorul pornește de la șablonul original; previzualizarea îl arată pe date reale.
    const editor = page.getByTestId("gcs-template-code");
    await expect(editor).toHaveAttribute("data-ready", "1");
    expect(await codeOf(editor)).toContain('{% slot "powered" %}');
    const frame = await previewFrame(page);
    await expect(frame.locator(".gcs-siteFooter")).toBeVisible();

    // O greșeală: eroarea apare cu rândul ei, iar salvarea e refuzată.
    await replaceCode(editor, '<footer class="gcs-siteFooter">\n  {% iff x %}\n</footer>');
    await expect(page.getByTestId("gcs-template-error")).toContainText("Rândul 2");
    await expect(page.getByTestId("gcs-template-error")).toContainText("tag necunoscut: iff");

    // Șablonul nou: un marcaj, numele site-ului, sloturile; plus încercări de XSS care trebuie să dispară.
    const marker = `e2e-footer-${id}`;
    await replaceCode(
      editor,
      [
        '<footer class="gcs-siteFooter">',
        '  <div class="gcs-siteFooter__inner">',
        `    <p class="${marker}" data-testid="e2e-footer-mark">Subsol {{ site.name | upcase }} {% icon "fa-solid fa-star" %}</p>`,
        '    <img src="/x.png" alt="" onerror="window.__gcsXss = 1">',
        "    <script>window.__gcsXss = 2</script>",
        '    <a href="javascript:alert(1)" data-testid="e2e-footer-js">js</a>',
        '    <div class="gcs-siteFooter__prefs">{% slot "language" %}</div>',
        "  </div>",
        "</footer>",
      ].join("\n"),
    );
    await expect(page.getByTestId("gcs-template-error")).toHaveCount(0);
    await expect(frame.getByTestId("e2e-footer-mark")).toContainText("Subsol");
    await expect(frame.locator(`.${marker} svg[data-icon]`)).toHaveCount(1);
    // Previzualizarea nu e site-ul: vizitatorii încă văd subsolul original.
    const visitor = await context.browser()!.newPage();
    await visitor.goto("/");
    await expect(visitor.locator(".gcs-siteFooter")).toBeVisible();
    await expect(visitor.getByTestId("e2e-footer-mark")).toHaveCount(0);

    await page.getByTestId("gcs-template-save").click();
    await expect(page.getByTestId("gcs-template-status")).toHaveText("Salvat: site-ul folosește acum șablonul tău.");
    await expect(page.getByTestId("gcs-template-title").getByTestId("gcs-template-badge-modified")).toBeVisible();
    await expect(page.locator('[data-key="layout.footer"]').getByTestId("gcs-template-badge-modified")).toBeVisible();

    // Pe site: marcajul, formularele de limbă (slot) și mențiunea produsului (slot obligatoriu, pus la final).
    await visitor.reload();
    await expect(visitor.getByTestId("e2e-footer-mark")).toContainText("Subsol");
    await expect(visitor.locator(".gcs-siteFooter__prefs form button[name=locale]").first()).toBeVisible();
    await expect(visitor.locator(".gcs-siteFooter__powered")).toContainText("GamingCommunitySuite");
    expect(await visitor.locator(".gcs-siteFooter script").count()).toBe(0);
    expect(await visitor.locator(".gcs-siteFooter img").getAttribute("onerror")).toBeNull();
    expect(await visitor.getByTestId("e2e-footer-js").getAttribute("href")).toBeNull();
    expect(await visitor.evaluate(() => (window as unknown as { __gcsXss?: number }).__gcsXss)).toBeUndefined();

    // Istoricul: versiunea salvată, cu diferențele față de original.
    await page.getByTestId("gcs-template-tab-history").click();
    await expect(page.getByTestId("gcs-history-item")).toHaveCount(1);
    await expect(page.getByTestId("gcs-history-item").first()).toContainText("Salvat");
    await page.getByTestId("gcs-history-compare-original").click();
    await expect(page.getByTestId("gcs-diff")).toContainText(marker);

    // Variabilele: click inserează în editor.
    await page.getByTestId("gcs-template-tab-variables").click();
    await page.locator('[data-testid="gcs-template-var"][data-name="year"]').click();
    expect(await codeOf(editor)).toContain("{{ year }}");

    // „Revino la original”: site-ul revine la componenta React; istoricul păstrează ambele intrări.
    await page.getByTestId("gcs-template-revert").click();
    await expect(page.getByTestId("gcs-template-status")).toHaveText("Șablonul a revenit la original.");
    expect(await codeOf(editor)).toContain('{% slot "powered" %}');
    await expect(page.locator('[data-key="layout.footer"]').getByTestId("gcs-template-badge-modified")).toHaveCount(0);
    await page.getByTestId("gcs-template-tab-history").click();
    await expect(page.getByTestId("gcs-history-item")).toHaveCount(2);
    await expect(page.getByTestId("gcs-history-item").first()).toContainText("Revenit la original");
    await visitor.reload();
    await expect(visitor.getByTestId("e2e-footer-mark")).toHaveCount(0);
    await expect(visitor.locator(".gcs-siteFooter__powered")).toContainText("GamingCommunitySuite");
    await visitor.close();
  } finally {
    await cleanup();
  }
});

test("un membru fără drept ACP nu vede editorul de șabloane", async ({ page, context }) => {
  await useFreshIp(context, "100.73.1");
  const res = await page.goto("/admin/appearance/templates");
  expect(res?.status()).toBe(404);
  const preview = await page.goto("/admin/template-preview");
  expect(preview?.status()).toBe(404);
});
