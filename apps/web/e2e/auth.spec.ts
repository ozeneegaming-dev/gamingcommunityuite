import { expect, test, type Page } from "@playwright/test";

// Fiecare test are propriul IP (antetul X-Forwarded-For), ca limita de 5 login-uri / 15 minute să nu se adune între teste.
let ipCounter = 10;
test.beforeEach(async ({ context }) => {
  ipCounter++;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${ipCounter}` });
});

/** Eroarea afișată în formular (Next.js mai are un `role="alert"` pentru anunțarea rutelor). */
const formAlert = (page: Page) => page.locator("form [role=alert]");

async function register(page: Page, name: string, email: string, password: string) {
  await page.goto("/register");
  await page.getByLabel("Nume de utilizator").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Parolă").fill(password);
  await page.getByRole("button", { name: "Creează cont" }).click();
}

/** Ieșire din cont: așteptăm reîncărcarea paginii, ca navigările următoare să nu se suprapună cu ea. */
async function logout(page: Page) {
  await page.getByRole("button", { name: "Ieșire" }).click();
  await expect(page.getByRole("link", { name: "Autentificare" })).toBeVisible();
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Parolă").fill(password);
  // Așteptăm răspunsul serverului: mesajul de eroare poate fi identic cu cel de la încercarea anterioară.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/sign-in/email")),
    page.getByRole("button", { name: "Intră în cont" }).click(),
  ]);
}

test("înregistrare, logout, login greșit și rate limit", async ({ page }) => {
  await register(page, "Krypt", "krypt@example.com", "parola-sigura-123");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Krypt");

  await logout(page);
  await expect(page.getByRole("link", { name: "Autentificare" })).toBeVisible();

  await page.goto("/login");
  await login(page, "krypt@example.com", "parola-gresita");
  await expect(formAlert(page)).toHaveText("Email sau parolă incorectă");

  // Încă 4 încercări greșite (5 în total), apoi a 6-a e blocată de rate limit.
  for (let i = 0; i < 4; i++) {
    await login(page, "krypt@example.com", "parola-gresita");
    await expect(formAlert(page)).toHaveText("Email sau parolă incorectă");
  }
  await login(page, "krypt@example.com", "parola-sigura-123");
  await expect(formAlert(page)).toHaveText(/Prea multe încercări/);
});

test("login corect după înregistrare", async ({ page }) => {
  await register(page, "Vortex", "vortex@example.com", "parola-sigura-123");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Vortex");
  await logout(page);

  await page.goto("/login");
  await login(page, "VORTEX@example.com", "parola-sigura-123");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Vortex");
});

test("un nume care diferă doar prin diacritice e refuzat pe câmp", async ({ page }) => {
  await register(page, "Ștefan", "stefan1@example.com", "parola-sigura-123");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Ștefan");
  await logout(page);

  await register(page, "ştefan", "stefan2@example.com", "parola-sigura-123");
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
