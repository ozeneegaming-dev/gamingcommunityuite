import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Asistentul de portare a pluginurilor (ACP → Sistem → Conversii → Portare plugin): Root Admin încarcă add-on-ul de
 * test al motorului (`addon.json` + `_data/` + clasele PHP), vede formatul și numerele detectate, confirmă dreptul de
 * a-l modifica și folosi, convertește, citește raportul, descarcă rezultatul și predă pachetul la ecranul de validare
 * al instalatorului de pluginuri. Pluginul nu se instalează și nu se activează nicăieri.
 */
const MODULES_DIR = path.resolve(__dirname, "../../../packages/modules");
const FIXTURES = path.join(MODULES_DIR, "src/porting/fixtures.ts");
const TMP = mkdtempSync(path.join(os.tmpdir(), "gcs-porting-e2e-"));
const ADDON = path.join(TMP, "demo-tools.zip");
const PLUGIN_XML = path.join(TMP, "shoutbox-lite.xml");

test.beforeAll(() => {
  // Sursele de test ale motorului de portare (aceleași ca în testele lui), scrise ca fișiere de încărcat.
  const script = [
    `import(${JSON.stringify(pathToFileURL(FIXTURES).href)}).then((m) => {`,
    `  const fs = require("node:fs");`,
    `  fs.writeFileSync(${JSON.stringify(ADDON)}, m.addonJsonFixture());`,
    `  fs.writeFileSync(${JSON.stringify(PLUGIN_XML)}, m.pluginXmlFixture());`,
    `});`,
  ].join("\n");
  execFileSync(process.execPath, ["--import", "tsx", "-e", script], { cwd: MODULES_DIR, stdio: "pipe" });
});

test.afterAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  // Dacă testul s-a oprit la jumătate: portările și încărcările predate la instalator nu rămân în urmă.
  await sql(`DELETE FROM plugin_ports WHERE "sourceName" IN ('Demo Tools', 'Shoutbox Lite')`).catch(() => {});
  await sql(`DELETE FROM plugin_uploads WHERE "fileName" LIKE 'acme.demo%'`).catch(() => {});
});

test("Root Admin portează un add-on: analiza, confirmarea dreptului, raportul, descărcarea și predarea la instalator", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.74.0");
  const id = uid();
  const key = `acme.demo_${id}`;
  await enterAcpAsRoot(page, `Port${id}`, `port-${id}@example.com`);

  // 0. Pagina, din meniul ACP (Sistem → Conversii); o arhivă necunoscută e refuzată fără să se creeze o portare.
  await page.goto("/admin/system/porting");
  await expect(page.getByRole("heading", { level: 1, name: "Portare plugin" })).toBeVisible();
  await expect(page.getByTestId("gcs-porting-steps").locator('[data-step="upload"]')).toHaveAttribute("aria-current", "step");
  const upload = page.getByTestId("gcs-porting-upload");
  await upload.getByTestId("gcs-porting-file").setInputFiles({ name: "notite.txt", mimeType: "text/plain", buffer: Buffer.from("nu e o arhivă") });
  await upload.getByTestId("gcs-porting-submit").click();
  await expect(page.getByTestId("gcs-porting-message")).toContainText("Fișierul nu e o arhivă .zip, .tar sau .tar.gz validă");
  await expect(page).toHaveURL(/\/admin\/system\/porting$/);

  // 1. Încărcarea: doar analiza (formatul, metadatele, licența, numerele pe tipuri); nimic convertit.
  await upload.getByTestId("gcs-porting-file").setInputFiles(ADDON);
  await upload.getByTestId("gcs-porting-submit").click();
  await expect(page).toHaveURL(/\/admin\/system\/porting\?id=[a-z0-9]+$/);
  const portId = new URL(page.url()).searchParams.get("id")!;
  const detected = page.getByTestId("gcs-porting-detected");
  await expect(detected).toContainText("Format detectat: add-on cu addon.json și _data/");
  await expect(detected.getByTestId("gcs-porting-name")).toHaveText("Demo Tools");
  await expect(detected.getByTestId("gcs-porting-version")).toHaveText("1.2.0");
  await expect(detected.getByTestId("gcs-porting-author")).toHaveText("Acme");
  const counts = detected.getByTestId("gcs-porting-counts");
  await expect(counts.locator('[data-count="templates"] .gcs-import__countValue')).toHaveText("3");
  await expect(counts.locator('[data-count="tables"] .gcs-import__countValue')).toHaveText("1");
  await expect(counts.locator('[data-count="tasks"] .gcs-import__countValue')).toHaveText("1");
  await expect(page.getByTestId("gcs-porting-steps").locator('[data-step="rights"]')).toHaveAttribute("aria-current", "step");
  const [analyzed] = await sql<{ report: unknown; source: Buffer | null }>(`SELECT report, source FROM plugin_ports WHERE id = $1`, [portId]);
  expect(analyzed!.report).toBeNull();
  expect(analyzed!.source).not.toBeNull();

  // 2. Confirmarea dreptului: obligatorie (temeiul + bifa); cheia propusă din sursă se poate schimba.
  const rights = page.getByTestId("gcs-porting-rights");
  await expect(rights).toContainText("Pluginurile cumpărate sunt licențiate de autorii lor");
  await expect(rights.getByTestId("gcs-porting-gpl")).toHaveCount(0);
  await expect(rights.getByTestId("gcs-porting-key")).toHaveValue("acme.demo");
  const convert = rights.getByTestId("gcs-porting-convert");
  await expect(convert).toBeDisabled();
  await rights.getByTestId("gcs-porting-basis-author").check();
  await expect(convert).toBeDisabled();
  await rights.getByLabel("Confirm că am dreptul să modific și să folosesc acest plugin").check();
  await rights.getByTestId("gcs-porting-key").fill(key);
  await expect(convert).toBeEnabled();

  // 3. Conversia → 4. rezultatul: procentul automat, tabelul pe tipuri, verificările pachetului, fișierele manuale.
  await convert.click();
  const report = page.getByTestId("gcs-porting-report");
  await expect(report.getByRole("heading", { name: "Rezultatul portării" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gcs-porting-steps").locator('[data-step="result"]')).toHaveAttribute("aria-current", "step");
  await expect(report).toContainText(`Demo Tools → ${key} · versiunea 1.2.0`);
  await expect(report.getByTestId("gcs-porting-rights-confirmed")).toContainText("Sunt autorul pluginului");
  await expect(report.getByTestId("gcs-porting-safe")).toContainText("Nimic nu a fost instalat sau activat");
  const percent = Number(await report.getByTestId("gcs-porting-percent").getAttribute("data-percent"));
  expect(percent).toBeGreaterThan(0);
  expect(percent).toBeLessThan(100);
  const areas = report.getByTestId("gcs-porting-areas");
  await expect(areas.locator('tr[data-area="templates"] td[data-col="auto"]')).toHaveText("3");
  await expect(areas.locator('tr[data-area="schema"] td[data-col="auto"]')).toHaveText("1");
  await expect(areas.locator('tr[data-area="code"] td[data-col="manual"]')).not.toHaveText("0");
  const checks = page.getByTestId("gcs-porting-checks");
  await expect(checks.getByTestId("gcs-porting-valid")).toHaveText("Pachet valid");
  await expect(checks).toContainText("Arhiva e validă");
  await expect(checks.locator('[data-level="error"]')).toHaveCount(0);
  const manual = page.getByTestId("gcs-porting-manual");
  await expect(manual.locator('tr[data-kind="model"]').filter({ hasText: "Entity/Item.php" })).toContainText("tabel în migrație");
  await expect(page.getByTestId("gcs-porting-notes")).toBeVisible();

  // Confirmarea și conversia sunt în jurnalul ACP; arhiva sursă s-a șters după conversie.
  const actions = await sql<{ action: string; after: Record<string, unknown> | null }>(
    `SELECT action, after FROM audit_logs WHERE "targetType" = 'plugin_port' AND "targetId" = $1 ORDER BY "createdAt"`,
    [portId],
  );
  expect(actions.map((a) => a.action)).toEqual(["porting.upload", "porting.convert"]);
  expect(actions[1]!.after).toMatchObject({ rights: "author", confirmed: true, key, gpl: false });
  const [converted] = await sql<{ source: Buffer | null; pluginKey: string }>(`SELECT source, "pluginKey" FROM plugin_ports WHERE id = $1`, [portId]);
  expect(converted!.source).toBeNull();
  expect(converted!.pluginKey).toBe(key);

  // Descărcarea: arhiva rezultatului (folderul pluginului, pachetul, ORIGINAL/, PORTING.md, report.json).
  // Cererea pleacă prin `page.request` (aceleași cookie-uri și același IP de test): descărcările browserului nu primesc
  // antetul `x-forwarded-for` al contextului, iar ACP-ul e legat de IP-ul autentificării.
  const href = await report.getByTestId("gcs-porting-download").getAttribute("href");
  expect(href).toBe(`/admin/porting-result.zip?id=${encodeURIComponent(portId)}`);
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toBe(`attachment; filename="${key}-port.zip"`);
  const zip = await download.body();
  expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
  for (const name of [`${key}/plugin.json`, `${key}/server.mjs`, `${key}-1.2.0.zip`, "ORIGINAL/", "PORTING.md", "report.json"]) {
    expect(zip.includes(Buffer.from(name)), name).toBe(true);
  }
  // Fără drept pe ACP, rezultatul nu există pentru nimeni altcineva.
  const anonymous = await page.context().browser()!.newContext();
  expect((await anonymous.request.get(`/admin/porting-result.zip?id=${portId}`)).status()).toBe(404);
  await anonymous.close();

  // Predarea la instalator: ecranul de validare al instalatorului; nimic nu se instalează de aici.
  await report.getByTestId("gcs-porting-handoff").click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await expect(page.getByTestId("gcs-plugin-checks")).toContainText("Arhiva e validă");
  await expect(page.getByTestId("gcs-plugin-checks").locator('[data-level="error"]')).toHaveCount(0);
  await expect(page.getByTestId("gcs-plugin-unsigned-warning")).toBeVisible();
  await expect(page.getByTestId("gcs-plugin-confirm")).toBeVisible();
  expect(await sql(`SELECT 1 FROM plugins WHERE key = $1`, [key])).toEqual([]);
  const [handoff] = await sql<{ after: Record<string, unknown> }>(`SELECT after FROM audit_logs WHERE action = 'porting.handoff' AND "targetId" = $1`, [portId]);
  expect(handoff!.after).toMatchObject({ key });
  // Adminul renunță: încărcarea dispare, pluginul rămâne neinstalat.
  await page.getByTestId("gcs-plugin-confirm").getByRole("button", { name: "Renunță" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications$/);
  expect(await sql(`SELECT 1 FROM plugins WHERE key = $1`, [key])).toEqual([]);

  // Portarea rămâne deschisă din lista portărilor recente; apoi se șterge, cu arhivele ei.
  await page.goto("/admin/system/porting");
  const recent = page.getByTestId("gcs-porting-recent");
  await expect(recent).toContainText("Demo Tools");
  await recent.locator(`a[href="/admin/system/porting?id=${portId}"]`).click();
  await expect(page.getByTestId("gcs-porting-report")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("gcs-porting-report").getByTestId("gcs-porting-delete").click();
  await expect(page).toHaveURL(/\/admin\/system\/porting$/);
  await expect(page.getByTestId("gcs-porting-upload")).toBeVisible();
  expect(await sql(`SELECT 1 FROM plugin_ports WHERE id = $1`, [portId])).toEqual([]);
  await page.goto(`/admin/system/porting?id=${portId}`);
  await expect(page.getByTestId("gcs-porting-message")).toContainText("Portarea nu există sau a expirat");
});

test("un plugin cu licență GPL arată avertismentul înaintea conversiei", async ({ page, context }) => {
  test.setTimeout(90_000);
  await useFreshIp(context, "100.74.1");
  const id = uid();
  await enterAcpAsRoot(page, `PortGpl${id}`, `port-gpl-${id}@example.com`);

  await page.goto("/admin/system/porting");
  const upload = page.getByTestId("gcs-porting-upload");
  await upload.getByTestId("gcs-porting-file").setInputFiles(PLUGIN_XML);
  await upload.getByTestId("gcs-porting-submit").click();
  await expect(page).toHaveURL(/\/admin\/system\/porting\?id=[a-z0-9]+$/);
  const detected = page.getByTestId("gcs-porting-detected");
  await expect(detected).toContainText("Format detectat: plugin într-un fișier XML");
  await expect(detected.getByTestId("gcs-porting-name")).toHaveText("Shoutbox Lite");
  await expect(detected.getByTestId("gcs-porting-gpl-pill")).toBeVisible();
  const rights = page.getByTestId("gcs-porting-rights");
  await expect(rights.getByTestId("gcs-porting-gpl")).toContainText("codul GPL nu poate intra într-o distribuție GCS închisă");

  // Fără confirmare nu se convertește nimic: butonul rămâne inactiv și raportul nu există.
  await rights.getByTestId("gcs-porting-basis-license").check();
  await expect(rights.getByTestId("gcs-porting-convert")).toBeDisabled();
  const portId = new URL(page.url()).searchParams.get("id")!;
  const [row] = await sql<{ report: unknown }>(`SELECT report FROM plugin_ports WHERE id = $1`, [portId]);
  expect(row!.report).toBeNull();

  page.once("dialog", (d) => void d.accept());
  await detected.getByTestId("gcs-porting-delete").click();
  await expect(page).toHaveURL(/\/admin\/system\/porting$/);
  expect(await sql(`SELECT 1 FROM plugin_ports WHERE id = $1`, [portId])).toEqual([]);
});
