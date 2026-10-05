import { expect, test } from "@playwright/test";
import { enterAcpAsRoot, register, resetSetting, sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.64.0");
});

test.afterEach(async () => {
  await resetSetting("site.name");
  await resetSetting("system.maintenance");
});

test("schimbarea site.name apare imediat în <title> pe /", async ({ page }) => {
  await enterAcpAsRoot(page, "RootS1", "root-s1@example.com");
  await page.goto("/admin/settings/general");
  await page.getByLabel("Numele site-ului").fill("RED-LINE Test");
  await page.getByRole("button", { name: "Salvează setările" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");

  await page.goto("/");
  await expect(page).toHaveTitle("RED-LINE Test");
});

test("mentenanța: un membru primește 503, adminul vede site-ul normal", async ({ page, browser }) => {
  const memberContext = await browser.newContext();
  await useFreshIp(memberContext, "100.65.0");
  const member = await memberContext.newPage();
  await register(member, "MembruM", "membru-m@example.com");
  await expect(member.getByTestId("gcs-header-user")).toHaveText("MembruM");

  await enterAcpAsRoot(page, "RootS2", "root-s2@example.com");
  await page.goto("/admin/settings/advanced");
  await page.getByRole("switch", { name: "Mod mentenanță" }).check();
  await page.getByRole("button", { name: "Salvează setările" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");

  const memberResponse = await member.goto("/");
  expect(memberResponse?.status()).toBe(503);
  await expect(member.getByRole("heading", { name: "Mentenanță" })).toBeVisible();
  // Login-ul (pentru staff) și health-check-ul rămân disponibile.
  const guest = await (await browser.newContext()).newPage();
  expect((await guest.goto("/login"))?.status()).toBe(200);
  expect((await guest.goto("/"))?.status()).toBe(503);
  expect((await guest.request.get("/api/health")).status()).toBe(200);

  const adminResponse = await page.goto("/");
  expect(adminResponse?.status()).toBe(200);
  await expect(page.getByTestId("gcs-header-user")).toHaveText("RootS2");

  await page.goto("/admin/settings/advanced");
  await page.getByRole("switch", { name: "Mod mentenanță" }).uncheck();
  await page.getByRole("button", { name: "Salvează setările" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");
  expect((await member.goto("/"))?.status()).toBe(200);
});

test("un câmp secret salvat gol își păstrează valoarea veche", async ({ page }) => {
  await enterAcpAsRoot(page, "RootS3", "root-s3@example.com");
  await page.goto("/admin/settings/email");
  await page.getByLabel("Parolă SMTP").fill("parola-smtp-1");
  await page.getByRole("button", { name: "Salvează setările" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");
  const stored = async () => (await sql<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'email.smtp_pass'`))[0]?.value;
  expect(await stored()).toBe("parola-smtp-1");

  await page.reload();
  await expect(page.getByLabel("Parolă SMTP")).toHaveValue("");
  await expect(page.getByText("•••• salvat")).toBeVisible();
  await page.getByLabel("Server SMTP").fill("smtp.example.com");
  await page.getByRole("button", { name: "Salvează setările" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");
  expect(await stored()).toBe("parola-smtp-1");
  // Valoarea secretului nu ajunge niciodată în pagină.
  expect(await page.content()).not.toContain("parola-smtp-1");
});
