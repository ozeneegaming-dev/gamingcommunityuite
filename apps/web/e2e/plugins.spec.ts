import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { forumTree, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, totp, useFreshIp } from "./helpers";

/**
 * Pluginurile (etapa 6 §2): Root Admin instalează pluginul de exemplu `gcs.hello` din ACP (pachet nesemnat: codul 2FA
 * și cheia tastată), îi vede widget-ul, pagina, intrarea din meniu și punctul de extensie din postbit, îl dezactivează
 * și îl dezinstalează, totul fără repornire. La final, pluginul și widget-ul lui nu mai există.
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const ZIP = path.join(SDK_DIR, "examples/hello/dist/gcs.hello-1.0.0.zip");
const KEY = "gcs.hello";
const WIDGET = `[data-widget="plugin.${KEY}.greeting"]`;

test.beforeAll(() => {
  // Arhiva pluginului de exemplu, construită din surse (esbuild + împachetare), ca în `pnpm build:example`.
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-example.ts"], { cwd: SDK_DIR, stdio: "pipe" });
});

test.afterAll(async () => {
  // Dacă testul s-a oprit la jumătate: pluginul dezactivat și widget-ul scos (procesele îl descarcă la reconciliere).
  await sql(`UPDATE plugins SET enabled = false WHERE key = $1`, [KEY]).catch(() => {});
  await sql(`DELETE FROM widget_placements WHERE type LIKE 'plugin.%'`).catch(() => {});
});

async function openPageEditor(page: Page) {
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-page-editor").click();
  await expect(page.getByTestId("gcs-page-editor")).toBeVisible();
}

test("Root Admin instalează pluginul din ACP; widget-ul, pagina și postbit-ul îl arată; dezactivat și dezinstalat dispare", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.73.0");
  const id = uid();
  const secret = await enterAcpAsRoot(page, `PlgAdm${id}`, `plgadm-${id}@example.com`);

  // 1. Încărcarea: raportul verificărilor, capabilitățile și avertismentul pentru pachetul nesemnat.
  await page.goto("/admin/system/applications");
  await expect(page.getByTestId("gcs-app-chat")).toBeVisible();
  await page.getByTestId("gcs-plugin-upload").locator('input[type="file"]').setInputFiles(ZIP);
  await page.getByTestId("gcs-plugin-upload").getByRole("button", { name: "Încarcă și verifică" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await expect(page.getByTestId("gcs-plugin-checks")).toContainText("Arhiva e validă");
  await expect(page.getByTestId("gcs-plugin-checks").locator('[data-level="error"]')).toHaveCount(0);
  await expect(page.getByTestId("gcs-plugin-capabilities")).toContainText("Bază de date proprie");
  await expect(page.getByTestId("gcs-plugin-unsigned-warning")).toBeVisible();

  // 2. Confirmarea: codul 2FA și cheia tastată; pluginul se încarcă imediat.
  const confirm = page.getByTestId("gcs-plugin-confirm");
  await confirm.getByLabel("Codul 2FA (din aplicația de autentificare)").fill(totp(secret));
  await confirm.getByLabel(`Scrie cheia pluginului (${KEY}) ca să confirmi`).fill(KEY);
  await confirm.getByRole("button", { name: "Instalează pluginul" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/system/applications/plugins/${KEY.replace(".", "\\.")}$`));
  await expect(page.getByTestId("gcs-plugin-header").getByTestId("gcs-plugin-status")).toHaveText("Activ");
  // Exportul pachetului (ACP → Aplicații → ⋯): arhiva instalată.
  const exported = await page.request.get(`/api/acp/plugins/${KEY}/package`);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toBe("application/zip");
  expect(exported.headers()["content-disposition"]).toContain(`${KEY}-1.0.0.zip`);

  // 3. Widget-ul, pus din „Editează pagina” în coloana din dreapta a paginii principale.
  await page.goto("/");
  await openPageEditor(page);
  await page.getByTestId("gcs-widget-add-sidebar").click();
  await page.getByTestId("gcs-widget-catalog-sidebar").getByRole("listitem").filter({ hasText: "Hello" }).click();
  await page.getByTestId("gcs-page-editor-save").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a fost salvată.");
  await page.getByTestId("gcs-page-editor-done").click();
  const widget = page.locator(WIDGET).filter({ visible: true });
  await expect(widget).toContainText("Salut din pluginul Hello!");
  await expect(widget).toContainText("Postări noi văzute: 0");

  // 4. Listenerul `post.created` (tabelul propriu) și punctul de extensie din postbit.
  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, `plgadm-${id}@example.com`, `Topic plugin ${id}`, 1);
  // Listenerul rulează în fundal (după răspunsul cererii): pagina se reîncarcă până apare.
  await expect(async () => {
    await page.reload();
    await expect(page.locator(WIDGET).filter({ visible: true })).toContainText("Postări noi văzute: 1", { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.goto(topic.url);
  await expect(page.getByTestId("gcs-postbit").first()).toContainText("Salutat de Hello");

  // 5. Pagina pluginului, din meniul userului; un vizitator nu are permisiunea `view`.
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId(`gcs-menu-plugin-${KEY}.hello`).click();
  await expect(page).toHaveURL(`/p/${KEY}`);
  await expect(page.getByTestId("gcs-plugin-page-title")).toHaveText("Hello");
  await expect(page.getByTestId("gcs-plugin-page")).toContainText(`#${topic.ids[1]}`);
  const guest = await page.context().browser()!.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`/p/${KEY}`);
  await expect(guestPage.getByTestId("gcs-plugin-forbidden")).toBeVisible();
  await guest.close();

  // 6. Oprit din listă (cu confirmarea din pagină): widget-ul și pagina dispar, fără repornire.
  await page.goto("/admin/system/applications");
  const row = page.getByTestId(`gcs-app-${KEY}`);
  await expect(row.getByTestId("gcs-plugin-cert")).toHaveText("Necertificat");
  await page.getByTestId(`gcs-plugin-toggle-${KEY}`).click();
  await page.getByTestId("gcs-app-confirm-ok").click();
  await expect(row.getByTestId("gcs-app-status")).toHaveText("Oprită");
  await page.goto("/");
  await expect(page.locator(WIDGET)).toHaveCount(0);
  expect((await page.goto(`/p/${KEY}`))?.status()).toBe(404);

  // 7. Dezinstalat complet: dispare din listă, cu tabelele și widget-ul lui.
  await page.goto(`/admin/system/applications/plugins/${KEY}#manage`);
  await page.getByRole("tab", { name: "Actualizare și dezinstalare" }).click();
  const manage = page.getByTestId("gcs-plugin-manage");
  await manage.getByRole("switch", { name: "Păstrează datele (pentru o reinstalare)" }).uncheck();
  await manage.getByLabel(`Scrie cheia pluginului (${KEY}) ca să confirmi`).fill(KEY);
  page.once("dialog", (d) => void d.accept());
  await manage.getByRole("button", { name: "Dezinstalează" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications$/);
  await expect(page.getByTestId(`gcs-app-${KEY}`)).toHaveCount(0);
  expect(await sql(`SELECT 1 FROM plugins WHERE key = $1`, [KEY])).toEqual([]);
  expect(await sql(`SELECT 1 FROM widget_placements WHERE type LIKE 'plugin.%'`)).toEqual([]);
  expect(await sql(`SELECT 1 FROM pg_namespace WHERE nspname = 'plugin_gcs__hello'`)).toEqual([]);
});

test("pagina Hook-uri listează evenimentele și punctele de extensie", async ({ page, context }) => {
  test.setTimeout(90_000);
  await useFreshIp(context, "100.73.1");
  const id = uid();
  await enterAcpAsRoot(page, `HookAdm${id}`, `hookadm-${id}@example.com`);
  await page.goto("/admin/system/hooks");
  await expect(page.getByRole("heading", { name: "Hook-uri", level: 1 })).toBeVisible();
  await expect(page.getByTestId("gcs-hook-point-post.created")).toContainText("O postare nouă");
  await expect(page.getByTestId("gcs-hook-point-post.before_save")).toBeVisible();
  await expect(page.getByTestId("gcs-hook-point-postbit.after_fields")).toBeVisible();
});
