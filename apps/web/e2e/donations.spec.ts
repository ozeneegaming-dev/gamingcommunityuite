import { e2eKv } from "./kv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { enterAcpAsRoot, register, resetSetting, setSetting, sql, useFreshIp, userId } from "./helpers";

/**
 * Donațiile + „Obiectivul lunii” (VIP clasic): adminul adaugă o donație → bara widget-ului se umple live și apare
 * ultimul donator; un membru trimite „Am donat” → echipa confirmă (dialog în pagină) → notificarea; tab-urile din
 * `/donatii`; widget-ul în GCS Dark și într-o altă temă (Clasic), pe întunecat și pe luminos.
 * Cu `GCS_E2E_SHOTS=<folder>`, salvează capturile.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const CLASSIC = "e2e_donations_classic";
const id = Math.random().toString(36).slice(2, 7);
const ADMIN = { name: `Casier${id}`, email: `casier-${id}@example.com` };
const DONOR = { name: `NovaDev${id}`, email: `novadev-${id}@example.com` };
const MEMBER = { name: `Ana${id}`, email: `ana-don-${id}@example.com` };

test.describe.configure({ mode: "serial" });

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (target) await target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  else await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function flush(patterns: string[]) {
  const redis = await e2eKv();
  try {
    for (const p of patterns) {
      const keys = await redis.keys(p);
      if (keys.length > 0) await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
}

/** Widget-ul de pe pagina principală (în flux: doar copia vizibilă). */
const widget = (page: Page) => page.getByTestId("gcs-widget-donation-goal").filter({ visible: true }).first();

let adminCtx: BrowserContext;
let admin: Page;

test.beforeAll(async ({ browser }) => {
  await sql(`DELETE FROM member_donations`);
  await sql(`DELETE FROM donation_goals`);
  await sql(`DELETE FROM widget_placements WHERE type = 'vip.donationGoal'`);
  await setSetting("donations.currency", "RON");
  // „Plata serverelor”: 1.000 lei pe lună, cu reînnoire, pentru toată lumea.
  await sql(
    `INSERT INTO donation_goals (title, target, currency, period, "startsOn", "autoRenew", "groupIds", enabled, position, "updatedAt")
     VALUES ('Plata serverelor', 100000, 'RON', 'MONTHLY', date_trunc('month', now())::date, true, '{}', true, 1, now())`,
  );
  await sql(`INSERT INTO widget_placements (page, zone, position, type, config, groups) VALUES ('index', 'sidebar', 0, 'vip.donationGoal', '{"goal":"","lastDonor":"show","donorCount":"show","icon":""}', '{}')`);
  await sql(
    `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, 'Clasic donații', false, true, '{"preset":"classic"}'::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
    [CLASSIC],
  );
  await flush(["gcs:k:layout*", "gcs:k:themes:all"]);

  adminCtx = await browser.newContext();
  await useFreshIp(adminCtx, "100.92.1");
  admin = await adminCtx.newPage();
  await enterAcpAsRoot(admin, ADMIN.name, ADMIN.email);
});

test.afterAll(async () => {
  await adminCtx?.close();
  await sql(`DELETE FROM widget_placements WHERE type = 'vip.donationGoal'`);
  await sql(`DELETE FROM member_donations`);
  await sql(`DELETE FROM donation_goals`);
  await sql(`DELETE FROM themes WHERE key = $1`, [CLASSIC]);
  await resetSetting("donations.currency");
  await flush(["gcs:k:layout*", "gcs:k:themes:all"]);
});

test("adminul adaugă o donație → bara widget-ului se umple live și apare ultimul donator", async ({ page, context, browser }) => {
  // Donatorul are cont (numele stilizat al grupului lui apare în widget).
  const donorCtx = await browser.newContext();
  await useFreshIp(donorCtx, "100.92.2");
  const donorPage = await donorCtx.newPage();
  await register(donorPage, DONOR.name, DONOR.email);
  await expect(donorPage.getByTestId("gcs-header-user")).toHaveText(DONOR.name);
  await donorCtx.close();

  await useFreshIp(context, "100.92.3");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  const w = widget(page);
  await expect(w).toBeVisible();
  await expect(w.getByTestId("gcs-donation-goal-title")).toHaveText("Plata serverelor");
  await expect(w.getByTestId("gcs-donation-goal-amount")).toHaveText("0 / 1.000 lei");
  await expect(w.getByTestId("gcs-donation-goal-bar")).toHaveAttribute("aria-valuenow", "0");
  await expect(w.getByTestId("gcs-donation-goal-last")).toHaveCount(0);
  // Fără link extern: butonul duce la pagina donațiilor.
  await expect(w.getByTestId("gcs-donation-goal-cta")).toHaveAttribute("href", "/donatii");

  await test.step("ACP › Donații: adăugarea unei donații de 50 lei pentru membru", async () => {
    await admin.goto("/admin/vip/donations");
    await admin.getByTestId("gcs-acp-donation-add").locator("summary").click();
    await admin.getByTestId("gcs-acp-donation-member").fill(DONOR.name);
    await admin.getByTestId("gcs-acp-donation-amount").fill("50");
    await admin.getByTestId("gcs-acp-donation-add").getByRole("button", { name: "Adaugă donația" }).click();
    await expect(admin.getByTestId("gcs-acp-donation")).toHaveCount(1);
    await expect(admin.getByTestId("gcs-acp-donation").first()).toHaveAttribute("data-status", "CONFIRMED");
    await shot(admin, "acp-donations-list");
  });

  // Fără reîncărcare: semnalul live (camera tuturor) → widget-ul își cere din nou progresul.
  await expect(w.getByTestId("gcs-donation-goal-amount")).toHaveText("50 / 1.000 lei", { timeout: 15_000 });
  await expect(w.getByTestId("gcs-donation-goal-bar")).toHaveAttribute("aria-valuenow", "5");
  await expect(w.getByTestId("gcs-donation-goal-last-name")).toHaveText(DONOR.name);
  await expect(w.getByTestId("gcs-donation-goal-last")).toContainText("(50 lei)");
  await expect(w.getByTestId("gcs-donation-goal-donors")).toHaveText("1 donator");
  // Numele trece prin componenta comună (stilul grupului, hover card-ul).
  await expect(w.getByTestId("gcs-donation-goal-last-name")).toHaveClass(/gcs-name--/);
  await shot(page, "widget-live-update", w);
});

test("un membru trimite „Am donat” → echipa confirmă în dialog → membrul primește notificarea", async ({ page, context }) => {
  await useFreshIp(context, "100.92.4");
  await register(page, MEMBER.name, MEMBER.email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(MEMBER.name);

  await page.goto("/donatii");
  const form = page.getByTestId("gcs-donate-form");
  await expect(form).toBeVisible();
  await page.getByTestId("gcs-donate-amount").fill("25");
  await page.getByTestId("gcs-donate-method").fill("Revolut");
  await page.getByTestId("gcs-donate-reference").fill("TX-777");
  await page.getByTestId("gcs-donate-submit").click();
  await expect(page.getByTestId("gcs-donate-status")).toContainText("Mulțumim");
  await expect(page.getByTestId("gcs-donations-mine")).toHaveCount(1);
  await expect(page.getByTestId("gcs-donations-mine").first()).toHaveAttribute("data-status", "PENDING");
  await shot(page, "donations-page-member");

  await test.step("echipa: cererea în așteptare, confirmată din dialogul din pagină", async () => {
    await admin.goto("/admin/vip/donations?status=PENDING");
    const row = admin.getByTestId("gcs-acp-donation").filter({ hasText: "TX-777" });
    await expect(row).toHaveAttribute("data-status", "PENDING");
    await expect(admin.getByTestId("gcs-acp-donations-pending")).toContainText("1");
    await row.getByRole("button", { name: "Confirmă" }).click();
    const dialog = admin.getByTestId("gcs-confirm-dialog");
    await expect(dialog).toBeVisible();
    await shot(admin, "acp-confirm-dialog");
    await dialog.getByTestId("gcs-confirm-ok").click();
    await expect(admin.getByTestId("gcs-acp-donation")).toHaveCount(0);
    await admin.goto("/admin/vip/donations");
    await expect(admin.getByTestId("gcs-acp-donation").filter({ hasText: "TX-777" })).toHaveAttribute("data-status", "CONFIRMED");
  });

  await page.goto("/");
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveText("1", { timeout: 10_000 });
  await page.getByTestId("gcs-header-bell").click();
  await expect(page.getByTestId("gcs-notif-panel").getByRole("link", { name: /Donația ta de 25 RON a fost confirmată/ })).toBeVisible();
  // Progresul obiectivului: 50 + 25 lei, 2 donatori.
  await expect(widget(page).getByTestId("gcs-donation-goal-amount")).toHaveText("75 / 1.000 lei");
  await expect(widget(page).getByTestId("gcs-donation-goal-donors")).toHaveText("2 donatori");
  expect((await sql(`SELECT status FROM member_donations WHERE "userId" = $1`, [await userId(MEMBER.email)]))[0]).toMatchObject({ status: "CONFIRMED" });
});

test("/donatii: „Ultimele donații” / „Top donatori” (lună / an / tot), anonimii, sala susținătorilor și exportul CSV", async ({ page, context }) => {
  await useFreshIp(context, "100.92.5");
  // O donație anonimă mare (a donatorului) și una de anul trecut, confirmate.
  const donor = await userId(DONOR.email);
  await sql(`INSERT INTO member_donations ("userId", amount, currency, anonymous, status, "donatedAt", "updatedAt") VALUES ($1, 90000, 'RON', true, 'CONFIRMED', now(), now())`, [donor]);
  await sql(`INSERT INTO member_donations ("userId", amount, currency, status, "donatedAt", "updatedAt") VALUES ($1, 4000, 'RON', 'CONFIRMED', now() - interval '400 days', now())`, [await userId(MEMBER.email)]);

  await page.goto("/donatii");
  const latest = page.getByTestId("gcs-donations-panel-latest");
  await expect(page.getByTestId("gcs-donations-tab-latest")).toHaveAttribute("aria-current", "page");
  await expect(latest.getByTestId("gcs-donations-row")).toHaveCount(4);
  // Cea mai nouă e anonimă: „Anonim”, fără numele membrului.
  await expect(latest.getByTestId("gcs-donations-row").first()).toContainText("Anonim");
  await expect(latest.getByTestId("gcs-donations-row").first()).not.toContainText(DONOR.name);
  await shot(page, "donations-page-latest");

  await page.getByTestId("gcs-donations-tab-top").click();
  await expect(page).toHaveURL(/tab=top/);
  const top = page.getByTestId("gcs-donations-panel-top");
  await expect(page.getByTestId("gcs-donations-period-month")).toHaveAttribute("aria-current", "page");
  // Luna: donatorul (50) înaintea membrului (25); donația anonimă nu intră în top.
  await expect(top.getByTestId("gcs-donations-top-row")).toHaveCount(2);
  await expect(top.getByTestId("gcs-donations-top-row").first()).toContainText(DONOR.name);
  await expect(top.getByTestId("gcs-donations-top-row").first()).toContainText("50 lei");
  await expect(top.getByTestId("gcs-donations-top-row").first()).toHaveAttribute("data-medal", "gold");
  await shot(page, "donations-page-top-month");

  await page.getByTestId("gcs-donations-period-all").click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.getByTestId("gcs-donations-period-all")).toHaveAttribute("aria-current", "page");
  // Tot timpul: membrul (25 + 40) trece înaintea donatorului (50).
  await expect(top.getByTestId("gcs-donations-top-row").first()).toContainText(MEMBER.name);
  await expect(top.getByTestId("gcs-donations-top-row").first()).toContainText("65 lei");
  await page.getByTestId("gcs-donations-period-year").click();
  await expect(page).toHaveURL(/period=year/);
  await expect(top.getByTestId("gcs-donations-top-row").first()).toContainText(DONOR.name);

  await expect(page.getByTestId("gcs-donations-hall-item")).toHaveCount(2);
  await expect(page.getByTestId("gcs-donations-hall-item").first()).toContainText(MEMBER.name);

  const csv = await admin.request.get("/admin/donations.csv?status=CONFIRMED");
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body.split("\n")[0]).toBe("id,date,member,donor_name,amount,currency,method,status,anonymous,reference,note");
  expect(body).toContain(`${MEMBER.name},,25.00,RON,Revolut,CONFIRMED,no,TX-777`);
  // Fără ACP: 404.
  expect((await page.request.get("/admin/donations.csv")).status()).toBe(404);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/donatii?tab=top");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "donations-page-375");
});

test("widget-ul în GCS Dark și în tema Clasic (întunecat și luminos): bara în culoarea accentului", async ({ page, context }) => {
  await useFreshIp(context, "100.92.6");
  const fill = (w: Locator) =>
    w.locator(".gcs-donGoal__fill").evaluate((el) => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, width: el.getBoundingClientRect().width };
    });

  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/gcs-nova/);
  let w = widget(page);
  await expect(w).toBeVisible();
  await expect(w.getByTestId("gcs-donation-goal-bar")).toHaveAttribute("aria-valuenow", /^[1-9]\d*$/);
  await expect.poll(async () => (await fill(w)).width).toBeGreaterThan(0);
  expect((await fill(w)).image).toMatch(/linear-gradient/);
  await expect(w.getByTestId("gcs-donation-goal-cta")).toBeVisible();
  await shot(page, "widget-gcs-dark", w);

  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  for (const mode of ["dark", "light"] as const) {
    await context.addCookies([
      { name: "gcs-skin", value: CLASSIC, domain: url.hostname, path: "/" },
      { name: "gcs-theme", value: mode, domain: url.hostname, path: "/" },
    ]);
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/gcs-nova/);
    w = widget(page);
    await expect(w).toBeVisible();
    await expect(w.getByTestId("gcs-donation-goal-title")).toHaveText("Plata serverelor");
    await expect.poll(async () => (await fill(w)).width).toBeGreaterThan(0);
    expect((await fill(w)).image).toMatch(/linear-gradient/);
    await expect(w.getByTestId("gcs-donation-goal-cta")).toBeVisible();
    await shot(page, `widget-classic-${mode}`, w);
  }
});
