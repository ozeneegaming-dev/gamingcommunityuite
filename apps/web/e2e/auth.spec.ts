import { expect, test } from "@playwright/test";
import { formAlert, login, logout, PASSWORD, register, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context);
});

test("înregistrare, logout, login greșit și rate limit", async ({ page }) => {
  await register(page, "Krypt", "krypt@example.com");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Krypt");

  await logout(page);

  await page.goto("/login");
  await login(page, "krypt@example.com", "parola-gresita");
  await expect(formAlert(page)).toHaveText("Email sau parolă incorectă");

  // Încă 4 încercări greșite (5 în total), apoi a 6-a e blocată de rate limit.
  for (let i = 0; i < 4; i++) {
    await login(page, "krypt@example.com", "parola-gresita");
    await expect(formAlert(page)).toHaveText("Email sau parolă incorectă");
  }
  await login(page, "krypt@example.com", PASSWORD);
  await expect(formAlert(page)).toHaveText(/Prea multe încercări/);
});

test("login corect după înregistrare", async ({ page }) => {
  await register(page, "Vortex", "vortex@example.com");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Vortex");
  await logout(page);

  await page.goto("/login");
  await login(page, "VORTEX@example.com");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Vortex");
});

test("un nume care diferă doar prin diacritice e refuzat pe câmp", async ({ page }) => {
  await register(page, "Ștefan", "stefan1@example.com");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Ștefan");
  await logout(page);

  await register(page, "ştefan", "stefan2@example.com");
  await expect(page.getByText("Numele e deja folosit")).toBeVisible();
  await expect(page.getByLabel("Nume de utilizator")).toHaveAttribute("aria-invalid", "true");
});

test("GET /gcs-names.css conține stilurile grupurilor", async ({ request }) => {
  const res = await request.get("/gcs-names.css");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("text/css");
  expect(res.headers()["cache-control"]).toBe("public, max-age=60");
  const css = await res.text();
  expect(css).toContain(".gcs-name--vip_gold");
  expect(css).toContain("prefers-reduced-motion");
});
