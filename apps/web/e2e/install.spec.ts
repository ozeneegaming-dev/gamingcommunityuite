import { e2eDb } from "./db";
import { e2eKv } from "./kv";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const CODE = process.env.GCS_E2E_INSTALL_CODE ?? "";
const LICENSE_KEY = process.env.GCS_E2E_LICENSE_KEY ?? "";

test.skip(!process.env.GCS_E2E_INSTALL_URL || !CODE || !LICENSE_KEY, "Instanța de instalare rulează doar cu build de producție (e2e/run.mts).");

const next = (page: Page) => page.getByRole("button", { name: "Continuă" }).click();
/**
 * Opțiunile wizard-ului sunt carduri (`.gcs-option`): căsuța nativă e ascunsă, iar un click pe card o comută, ca la un
 * utilizator real. Starea se verifică pe căsuță (`toBeChecked`).
 */
const card = (page: Page, testId: string) => page.locator("label.gcs-option").filter({ has: page.getByTestId(testId) });
/** Captură (cu `GCS_SHOTS_DIR`) pe desktop și la 375 px, unde pagina nu are scroll orizontal. */
async function shots(page: Page, name: string) {
  const dir = process.env.GCS_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}-desktop.png`, fullPage: true });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (dir) await page.screenshot({ path: `${dir}/${name}-375.png`, fullPage: true });
  if (size) await page.setViewportSize(size);
}
async function setApp(page: Page, key: string, on: boolean) {
  const input = page.getByTestId(`gcs-install-check-app-${key}`);
  if ((await input.isChecked()) !== on) await card(page, `gcs-install-check-app-${key}`).click();
  await (on ? expect(input).toBeChecked() : expect(input).not.toBeChecked());
}

/**
 * O licență de test, semnată cu cheia de unică folosință a rulării (de încredere doar pentru instanța de instalare).
 * Formatul e cel din `packages/core/src/install/license.ts` (`GCS1.<payload>.<semnătura>`), semnat aici direct: un import
 * din `@gcs/core` ar încărca nucleul ca CommonJS în procesul Playwright și ar strica importurile ESM ale altor specuri.
 */
function license(over: Record<string, unknown> = {}): string {
  const payload = {
    v: 1,
    kid: "e2e",
    id: "lic-e2e",
    licensee: "Comunitatea E2E SRL",
    domains: ["localhost"],
    package: "standard",
    apps: [],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    ...over,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(`GCS-LICENSE-V1
${body}`, "utf8"), createPrivateKey(readFileSync(LICENSE_KEY, "utf8")));
  return `GCS1.${body}.${signature.toString("base64url")}`;
}

test("instalarea completă: licența, aplicațiile, reluare după refresh, login automat, /install blocat după final", async ({ page }) => {
  test.setTimeout(240_000);

  await test.step("un site neinstalat duce la /install", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/install\/code$/);
    await expect(page.getByRole("heading", { name: "Cod de instalare", level: 1 })).toBeVisible();
    await expect(page.getByText("Pasul 1 din 10")).toBeVisible();
    // Brandul GCS (docs/BRAND.md): installer-ul e cromul produsului, cu marca, fundalul navy, accentul și DM Sans.
    const product = page.locator(".gcs-product").first();
    await expect(product).toHaveCSS("background-color", "rgb(11, 15, 23)");
    await expect(product.locator("svg.gcs-mark rect")).toHaveAttribute("fill", "#DF390C");
    await expect(page.locator("[aria-current=step] span").first()).toHaveCSS("background-color", "rgb(205, 52, 11)");
    expect(await page.getByRole("heading", { level: 1 }).evaluate((h) => getComputedStyle(h).fontFamily)).toMatch(/DM[ _]Sans/);
    // Unde găsește proprietarul codul: în Lite nu există Docker, codul e în jurnalul aplicației din panoul gazdei.
    if (process.env.GCS_EDITION === "lite") {
      await expect(page.getByText(/stderr\.log sau passenger\.log/)).toBeVisible();
      await expect(page.getByText(/docker compose/)).toHaveCount(0);
    } else {
      await expect(page.getByText(/docker compose logs web/)).toBeVisible();
    }
  });

  await test.step("1. codul de instalare (unul greșit e refuzat)", async () => {
    await page.getByLabel("Cod de instalare").fill("AAAA-AAAA-AAAA");
    await next(page);
    await expect(page.getByText("Codul nu e corect")).toBeVisible();
    await page.getByLabel("Cod de instalare").fill(CODE);
    await next(page);
    await expect(page).toHaveURL(/\/install\/checks$/);
  });

  await test.step("2. verificarea sistemului", async () => {
    const checks = page.getByTestId("gcs-install-checks");
    // Ediția Lite (shared hosting) nu are Redis: verificarea lui lipsește.
    if (process.env.GCS_EDITION === "lite") await expect(checks.getByText("Redis")).toHaveCount(0);
    else await expect(checks.getByText("Redis")).toBeVisible();
    await expect(checks.getByText("Folderul de configurare")).toBeVisible();
    if (process.env.GCS_EDITION === "lite") await expect(checks.getByText("Versiunea Node.js")).toBeVisible();
    await next(page);
    await expect(page).toHaveURL(/\/install\/license$/);
  });

  await test.step("3. licența: formatul greșit, expirată, alt domeniu și EULA neacceptat blochează", async () => {
    await expect(page.getByRole("heading", { name: "Licența GCS", level: 1 })).toBeVisible();
    await expect(page.getByTestId("gcs-install-eula")).toContainText("Contract de licență");
    const field = page.getByLabel("Cheia de licență");
    for (const [token, message] of [
      ["GCS1.stricat.x", "Cheia nu are formatul corect."],
      [license({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() }), "Licența a expirat."],
      [license({ domains: ["alt-forum.ro"] }), "Licența nu e valabilă pentru domeniul localhost."],
    ] as const) {
      await field.fill(token);
      await next(page);
      await expect(page.getByText(message)).toBeVisible();
    }
    await field.fill(license());
    await next(page);
    await expect(page.getByText("Trebuie să accepți termenii de utilizare.")).toBeVisible();
    await shots(page, "01-licenta");
    await card(page, "gcs-install-check-eula-on").click();
    await expect(page.getByTestId("gcs-install-check-eula-on")).toBeChecked();
    await next(page);
    await expect(page).toHaveURL(/\/install\/apps$/);
  });

  await test.step("4. aplicațiile cu licența standard: premium blocate, Forumul mereu pornit", async () => {
    const premium = page.getByTestId("gcs-install-apps-premium");
    await expect(premium.getByTestId("gcs-install-check-app-servers")).toBeDisabled();
    await expect(premium.getByText("Nu e inclusă în licență").first()).toBeVisible();
    await expect(page.getByTestId("gcs-install-check-app-forums")).toBeDisabled();
    await expect(page.getByTestId("gcs-install-check-app-forums")).toBeChecked();
  });

  await test.step("înapoi la licență: una cu Servere și Chat Pro deblochează aplicațiile premium", async () => {
    await page.getByRole("button", { name: "Înapoi" }).click();
    await expect(page).toHaveURL(/\/install\/license$/);
    await expect(page.getByText("Licență verificată: Comunitatea E2E SRL")).toBeVisible();
    await page.getByLabel("Cheia de licență").fill(license({ apps: ["servers", "chat_pro"] }));
    await next(page);
    await expect(page).toHaveURL(/\/install\/apps$/);
    const premium = page.getByTestId("gcs-install-apps-premium");
    await expect(premium.getByTestId("gcs-install-check-app-servers")).toBeEnabled();
    await expect(premium.getByTestId("gcs-install-check-app-chat_pro")).toBeEnabled();
    await expect(premium.getByTestId("gcs-install-check-app-groups_pro")).toBeDisabled();
    await shots(page, "02-aplicatii");
  });

  await test.step("Chat Pro fără Chat e refuzat; Servere ca aplicație de pornire, Clanurile oprite", async () => {
    await setApp(page, "chat", false);
    await setApp(page, "chat_pro", true);
    await next(page);
    await expect(page.getByText("Chat Pro are nevoie și de aplicațiile de care depinde.")).toBeVisible();
    await setApp(page, "chat", true);
    await setApp(page, "servers", true);
    await setApp(page, "clans", false);
    await page.getByLabel("Aplicația de pornire").selectOption("servers");
    await next(page);
    await expect(page).toHaveURL(/\/install\/database$/);
  });

  await test.step("5. baza de date: testul conexiunii, apoi Continuă", async () => {
    if (process.env.GCS_EDITION === "lite") {
      // Ediția Lite: baza e creată în panoul gazdei; MySQL e varianta implicită, PostgreSQL a doua.
      const url = new URL(process.env.GCS_E2E_INSTALL_DATABASE_URL!);
      const mysql = url.protocol === "mysql:";
      await expect(page.getByRole("radio", { name: /^MySQL \/ MariaDB/ })).toBeChecked();
      await expect(page.getByLabel("Port")).toHaveValue("3306");
      if (!mysql) {
        await page.locator("label.gcs-option").filter({ hasText: "PostgreSQL 14+" }).click();
        await expect(page.getByRole("radio", { name: /^PostgreSQL/ })).toBeChecked();
        await expect(page.getByLabel("Port")).toHaveValue("5432");
      }
      await page.getByLabel("Host").fill(url.hostname);
      await page.getByLabel("Port").fill(url.port);
      await page.getByLabel("Utilizator").fill(decodeURIComponent(url.username));
      await page.getByLabel("Parolă", { exact: true }).fill(decodeURIComponent(url.password));
      await page.getByLabel("Numele bazei de date").fill(url.pathname.slice(1));
    } else {
      await expect(page.getByRole("radio", { name: /PostgreSQL inclus/ })).toBeChecked();
    }
    await page.getByRole("button", { name: "Testează conexiunea" }).click();
    await expect(page.getByRole("status")).toContainText("Conexiunea funcționează");
    await next(page);
    await expect(page).toHaveURL(/\/install\/site$/);
  });

  await test.step("6–7. site și email", async () => {
    await page.getByLabel("Numele site-ului").fill("Comunitatea E2E");
    await next(page);
    await expect(page).toHaveURL(/\/install\/email$/);
    await next(page);
    await expect(page).toHaveURL(/\/install\/admin$/);
  });

  await test.step("un refresh la pasul admin rămâne la admin; numele site-ului e păstrat", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/install\/admin$/);
    await expect(page.getByRole("heading", { name: "Cont Root Admin", level: 1 })).toBeVisible();
    await page.goto("/install");
    await expect(page).toHaveURL(/\/install\/admin$/);
    await page.goto("/install/site");
    await expect(page.getByLabel("Numele site-ului")).toHaveValue("Comunitatea E2E");
    await page.goto("/install/admin");
  });

  await test.step("8. contul Root Admin (parolele trebuie să coincidă)", async () => {
    await page.getByLabel("Nume de utilizator").fill("Fondator");
    await page.getByLabel("Email").fill("fondator@example.com");
    await page.getByLabel("Parolă", { exact: true }).fill("parola-sigura-123");
    await page.getByLabel("Confirmă parola").fill("alta-parola-123");
    await next(page);
    await expect(page.getByText("Parolele nu coincid")).toBeVisible();
    await page.getByLabel("Confirmă parola").fill("parola-sigura-123");
    await next(page);
    await expect(page).toHaveURL(/\/install\/data$/);
  });

  await test.step("9. date demo", async () => {
    await page.locator("label.gcs-option").filter({ hasText: "Date demo" }).click();
    await expect(page.getByRole("radio", { name: /Date demo/ })).toBeChecked();
    await next(page);
    await expect(page).toHaveURL(/\/install\/progress$/);
  });

  await test.step("10. instalarea rulează (cu pasul aplicațiilor) și se termină; login automat în ACP", async () => {
    await page.getByRole("button", { name: "Pornește instalarea" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Instalare finalizată" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByTestId("gcs-install-log")).toContainText("Pornesc aplicațiile alese");
    await expect(page.getByTestId("gcs-install-log")).toContainText("Creez contul Root Admin");
    if (process.env.GCS_EDITION === "lite") {
      // Pasul final al ediției Lite: comanda de cron și verificarea că rulează (aici, o rulare a `/api/cron` cu tokenul).
      const cron = page.getByTestId("gcs-cron-panel");
      await expect(cron.getByTestId("gcs-cron-schedule")).toHaveText("*/5 * * * *");
      await expect(cron.getByTestId("gcs-cron-node")).toContainText("cron.mjs");
      await expect(cron.getByTestId("gcs-cron-curl")).toContainText("/api/cron?token=");
      await cron.getByTestId("gcs-cron-check").click();
      await expect(cron.getByTestId("gcs-cron-status")).toHaveAttribute("data-running", "false");
      const { createHmac } = await import("node:crypto");
      const token = createHmac("sha256", process.env.GCS_SECRET!).update("gcs-cron").digest("hex").slice(0, 40);
      const res = await page.request.post(`${process.env.GCS_E2E_INSTALL_URL}/api/cron`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status(), await res.text()).toBe(200);
      await cron.getByTestId("gcs-cron-check").click();
      await expect(cron.getByTestId("gcs-cron-status")).toHaveAttribute("data-running", "true");
      await expect(cron.getByTestId("gcs-cron-status")).toContainText("Ultima rulare");
    }
    await page.getByRole("button", { name: "Intră în ACP" }).click();
    await expect(page).toHaveURL(/\/admin\/2fa-setup$/);
    await expect(page.getByRole("heading", { name: "Activează autentificarea în doi pași" })).toBeVisible();
  });

  await test.step("după instalare: /install → 404, prima pagină e Serverele, Clanurile sunt oprite, forumul are datele demo", async () => {
    expect((await page.goto("/install"))?.status()).toBe(404);
    expect((await page.goto("/install/code"))?.status()).toBe(404);
    await page.goto("/");
    await expect(page).toHaveTitle(/Comunitatea E2E/);
    await expect(page.getByTestId("gcs-servers-filter").or(page.getByTestId("gcs-servers-empty")).first()).toBeVisible();
    await expect(page.getByTestId("gcs-forum-index")).toHaveCount(0);
    expect((await page.goto("/clans"))?.status()).toBe(404);
    await page.goto("/forum");
    await expect(page.getByRole("link", { name: "Anunțuri", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ajutor tehnic", exact: true })).toBeVisible();
  });

  await test.step("pentru smoke-uri: starea de după seed (premium oprite, restul pornite), Forumul pe /, cache-ul golit", async () => {
    const db = await e2eDb(process.env.GCS_E2E_INSTALL_DATABASE_URL);
    try {
      await db.query(`DELETE FROM settings WHERE key = $1`, ["apps.landing"]);
      // Starea de după seed: aplicațiile premium (Chat Pro, Grupuri Pro) își pun singure un rând „oprită”; restul, fără rând = pornite.
      await db.query(`DELETE FROM apps WHERE key NOT IN ($1, $2)`, ["chat_pro", "groups_pro"]);
      await db.query(`UPDATE apps SET enabled = false WHERE key IN ($1, $2)`, ["chat_pro", "groups_pro"]);
    } finally {
      await db.end();
    }
    const redis = await e2eKv(process.env.GCS_E2E_INSTALL_REDIS_URL, process.env.GCS_E2E_INSTALL_DATABASE_URL);
    try {
      const keys = await redis.keys("gcs:k:*");
      if (keys.length > 0) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
    await expect
      .poll(async () => {
        await page.goto("/");
        return page.getByTestId("gcs-forum-index").count();
      }, { timeout: 30_000 })
      .toBe(1);
    expect((await page.goto("/clans"))?.status()).toBe(200);
  });
});
