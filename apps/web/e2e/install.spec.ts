import { expect, test, type Page } from "@playwright/test";

const CODE = process.env.GCS_E2E_INSTALL_CODE ?? "";

test.skip(!process.env.GCS_E2E_INSTALL_URL || !CODE, "Instanța de instalare rulează doar cu build de producție (e2e/run.mts).");

const next = (page: Page) => page.getByRole("button", { name: "Continuă" }).click();

test("instalarea completă: 9 pași, reluare după refresh, login automat, /install blocat după final", async ({ page }) => {
  await test.step("un site neinstalat duce la /install", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/install\/code$/);
    await expect(page.getByRole("heading", { name: "Cod de instalare", level: 1 })).toBeVisible();
    await expect(page.getByText("Pasul 1 din 9")).toBeVisible();
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
    await expect(checks.getByText("Redis")).toBeVisible();
    await expect(checks.getByText("Folderul de configurare")).toBeVisible();
    await next(page);
    await expect(page).toHaveURL(/\/install\/database$/);
  });

  await test.step("3. baza de date inclusă: testul conexiunii, apoi Continuă", async () => {
    await expect(page.getByRole("radio", { name: /PostgreSQL inclus/ })).toBeChecked();
    await page.getByRole("button", { name: "Testează conexiunea" }).click();
    await expect(page.getByRole("status")).toContainText("Conexiunea funcționează");
    await next(page);
    await expect(page).toHaveURL(/\/install\/site$/);
  });

  await test.step("4–5. site și email", async () => {
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

  await test.step("6. contul Root Admin (parolele trebuie să coincidă)", async () => {
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

  await test.step("7. date demo", async () => {
    await page.getByRole("radio", { name: /Date demo/ }).check();
    await next(page);
    await expect(page).toHaveURL(/\/install\/progress$/);
  });

  await test.step("8–9. instalarea rulează și se termină; login automat în ACP", async () => {
    await page.getByRole("button", { name: "Pornește instalarea" }).click();
    await expect(page.getByRole("status")).toContainText("Instalare finalizată", { timeout: 60_000 });
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByTestId("gcs-install-log")).toContainText("Creez contul Root Admin");
    await page.getByRole("button", { name: "Intră în ACP" }).click();
    await expect(page).toHaveURL(/\/admin\/2fa-setup$/);
    await expect(page.getByRole("heading", { name: "Activează autentificarea în doi pași" })).toBeVisible();
  });

  await test.step("după instalare, /install → 404, iar site-ul are numele ales", async () => {
    expect((await page.goto("/install"))?.status()).toBe(404);
    expect((await page.goto("/install/code"))?.status()).toBe(404);
    await page.goto("/");
    await expect(page).toHaveTitle("Comunitatea E2E");
  });
});
