import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, totp, useFreshIp } from "./helpers";

/**
 * Pluginul Tickete suport (`gcs.tickets`): Root Admin îl instalează din ACP (pachet nesemnat: codul 2FA și cheia
 * tastată), un membru deschide un ticket, staff-ul îl preia, lasă o notă internă și răspunde, membrul vede răspunsul
 * (fără notă) și închide ticketul; la final pluginul e dezinstalat cu tot cu date.
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const ZIP = path.join(SDK_DIR, "plugins/tickets/dist/gcs.tickets-1.0.0.zip");
const KEY = "gcs.tickets";

/** Capturile de ecran (doar cu `GCS_E2E_SHOTS=<folder>`), pentru verificarea vizuală. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.GCS_E2E_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.beforeAll(() => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-tickets.ts"], { cwd: SDK_DIR, stdio: "pipe" });
});

test.afterAll(async () => {
  await sql(`UPDATE plugins SET enabled = false WHERE key = $1`, [KEY]).catch(() => {});
});

test("Root Admin instalează Tickete suport din ACP; membrul deschide un ticket, staff-ul răspunde, apoi dezinstalare", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.74.0");
  const id = uid();
  const secret = await enterAcpAsRoot(page, `TkAdm${id}`, `tkadm-${id}@example.com`);

  // 1. Instalarea din ACP (pachet nesemnat: 2FA + cheia tastată).
  await page.goto("/admin/system/applications");
  await page.getByTestId("gcs-plugin-upload").locator('input[type="file"]').setInputFiles(ZIP);
  await page.getByTestId("gcs-plugin-upload").getByRole("button", { name: "Încarcă și verifică" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await expect(page.getByTestId("gcs-plugin-checks").locator('[data-level="error"]')).toHaveCount(0);
  await shot(page, "tickets-1-install");
  const confirm = page.getByTestId("gcs-plugin-confirm");
  await confirm.getByLabel("Codul 2FA (din aplicația de autentificare)").fill(totp(secret));
  await confirm.getByLabel(`Scrie cheia pluginului (${KEY}) ca să confirmi`).fill(KEY);
  await confirm.getByRole("button", { name: "Instalează pluginul" }).click();
  // Instalat („Salvat”); pagina pluginului se deschide direct (redirecționarea formularului nu e subiectul testului).
  // Redirecționarea poate veni înainte ca „Salvat” să fie văzut: oricare dintre ele (starea „Activ” se verifică mai jos).
  await expect(confirm.getByRole("status").filter({ hasText: "Salvat" }).or(page.getByTestId("gcs-plugin-header")).first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`/admin/system/applications/plugins/${KEY}`);
  await expect(page.getByTestId("gcs-plugin-header").getByTestId("gcs-plugin-status")).toHaveText("Activ");

  // 2. Membrul deschide un ticket.
  const memberContext = await browser.newContext();
  await useFreshIp(memberContext, "100.74.1");
  const m = await memberContext.newPage();
  await member(m, `Jucator${id}`, `jucator-${id}@example.com`);
  await m.goto(`/p/${KEY}`);
  await expect(m.getByRole("heading", { name: "Ticketele mele", level: 1 })).toBeVisible();
  await m.getByRole("link", { name: "Deschide un ticket" }).first().click();
  await expect(m).toHaveURL(new RegExp(`/p/${KEY.replace(".", "\\.")}/new$`));
  const form = m.locator("form.gcsp-form");
  await form.getByLabel("Categorie").selectOption("Cerere unban");
  await form.getByLabel("Prioritate").selectOption("high");
  await form.getByLabel("Subiect").fill(`Ban nedrept pe serverul de CS2 ${id}`);
  await form.getByLabel("Mesaj", { exact: true }).fill("Salut,\nam primit ban ieri seară pe RED-LINE #1, fără motiv.\n\nDemo: https://example.com/demo.dem");
  await shot(m, "tickets-2-new");
  await form.getByRole("button", { name: "Trimite ticketul" }).click();
  await expect(m).toHaveURL(new RegExp(`/p/${KEY.replace(".", "\\.")}/t/\\d+\\?done=created$`));
  await expect(m.getByText("Ticketul a fost trimis. Staff-ul îți răspunde aici.")).toBeVisible();
  const ticketUrl = new URL(m.url()).pathname;

  // 3. Staff-ul: coada, preluarea, nota internă și răspunsul.
  await page.goto(`/p/${KEY}`);
  await expect(page.getByRole("heading", { name: "Coada de tickete", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Ban nedrept pe serverul de CS2 ${id}`) })).toBeVisible();
  await shot(page, "tickets-3-queue");
  await page.goto(ticketUrl);
  const manage = page.locator(".gcsp-manage");
  await manage.getByLabel("Responsabil").selectOption("me");
  await manage.getByLabel("Stare").selectOption("in_progress");
  await manage.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Ticketul a fost actualizat.")).toBeVisible();
  await page.getByPlaceholder("Scrie răspunsul…").fill("Verific demo-ul cu echipa.");
  await page.getByText("Notă internă (o vede doar staff-ul)").click();
  await page.getByRole("button", { name: "Trimite", exact: true }).click();
  await expect(page.getByText("Nota internă a fost salvată.")).toBeVisible();
  await page.getByPlaceholder("Scrie răspunsul…").fill("Am verificat demo-ul: banul a fost scos. Joc plăcut!");
  await page.getByRole("button", { name: "Trimite", exact: true }).click();
  await expect(page.getByText("Răspunsul a fost trimis.")).toBeVisible();
  await shot(page, "tickets-4-staff-view");

  // 4. Membrul vede răspunsul (fără nota internă) și închide ticketul.
  await m.goto(`/p/${KEY}`);
  await expect(m.locator(".gcsp-row--unread")).toHaveCount(1);
  await m.goto(ticketUrl);
  await expect(m.getByText("Am verificat demo-ul: banul a fost scos. Joc plăcut!")).toBeVisible();
  await expect(m.getByText("Verific demo-ul cu echipa.")).toHaveCount(0);
  await expect(m.locator(".gcsp-status--answered").first()).toBeVisible();
  await shot(m, "tickets-5-member-view");
  await m.getByRole("button", { name: "Închide ticketul" }).click();
  await expect(m.getByText("Ticketul a fost închis.")).toBeVisible();
  await memberContext.close();

  // 5. Statisticile din ACP.
  await page.goto(`/admin/plugins/${KEY}`);
  await expect(page.getByText("Tickete în total")).toBeVisible();
  await shot(page, "tickets-6-acp");

  // 6. Dezinstalat complet, cu datele lui.
  await page.goto(`/admin/system/applications/plugins/${KEY}#manage`);
  await page.getByRole("tab", { name: "Actualizare și dezinstalare" }).click();
  const box = page.getByTestId("gcs-plugin-manage");
  await box.getByRole("switch", { name: "Păstrează datele (pentru o reinstalare)" }).uncheck();
  await box.getByLabel(`Scrie cheia pluginului (${KEY}) ca să confirmi`).fill(KEY);
  page.once("dialog", (d) => void d.accept());
  await box.getByRole("button", { name: "Dezinstalează" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications$/);
  expect(await sql(`SELECT 1 FROM plugins WHERE key = $1`, [KEY])).toEqual([]);
  expect(await sql(`SELECT 1 FROM pg_namespace WHERE nspname = 'plugin_gcs__tickets'`)).toEqual([]);
});
