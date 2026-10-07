import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, login, sql, useFreshIp } from "./helpers";

/**
 * Importul din altă platformă (ACP → Sistem → Conversii), pe sursa de test `core-schema` (host `fixture`, activă
 * doar cu `GCS_TEST_ROUTES=1`): conexiunea, rularea de probă, importul din `gcs-worker`, raportul, conținutul importat
 * pe site, redirecturile 301 ale adreselor vechi și autentificarea cu parola veche (rescrisă apoi în Argon2id).
 */
test.describe("importul din altă platformă", () => {
  test.describe.configure({ timeout: 180_000 });

  test("asistentul din ACP importă comunitatea; conținutul e pe site, adresele vechi fac 301, parola veche merge", async ({ page, context, browser }) => {
    await useFreshIp(context);
    const id = uid();
    await enterAcpAsRoot(page, `Import${id}`, `import${id}@test.ro`);

    await page.goto("/admin/system/import");
    await expect(page.getByRole("heading", { level: 1, name: "Import din altă platformă" })).toBeVisible();
    const form = page.getByTestId("gcs-import-form");
    await form.getByLabel("Server (host)").fill("fixture");
    await form.getByLabel("Baza de date").fill("core-schema");
    await form.getByLabel("Utilizator").fill("citire");
    await form.getByLabel("Parolă", { exact: true }).fill("secret-vechi");
    await form.getByLabel("Folder montat pe server").check();
    await form.getByLabel("Calea folderului").fill("/srv/vechi");
    await form.getByLabel("Adresa veche a site-ului").fill("https://vechi.exemplu.ro/forum");
    await form.getByRole("button", { name: "Testează conexiunea" }).click();

    const detected = page.getByTestId("gcs-import-detected");
    await expect(detected).toContainText("Sursă detectată: schemă core_* (versiunea 4.7.18)");
    await expect(detected).toContainText("Versiune suportată");
    // Parola bazei vechi e criptată în baza de date, nu în clar.
    const [job] = await sql<{ id: string; secret: string; config: Record<string, unknown> }>(`SELECT id, secret, config FROM import_jobs ORDER BY "createdAt" DESC LIMIT 1`);
    expect(job!.secret).not.toContain("secret-vechi");
    expect(JSON.stringify(job!.config)).not.toContain("secret-vechi");

    // Rularea de probă: doar numără.
    const options = page.getByTestId("gcs-import-options");
    await options.getByRole("switch", { name: /Rulare de probă/ }).check();
    await options.getByRole("button", { name: "Pornește rularea de probă" }).click();
    const report = page.getByTestId("gcs-import-report");
    await expect(report.getByRole("heading", { name: "Raportul rulării de probă" })).toBeVisible({ timeout: 60_000 });
    await expect(report).toContainText("Conturi care se vor lega după email: 0");
    expect(Number((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM import_map`))[0]!.n)).toBe(0);

    // Importul real, rulat de gcs-worker; progresul vine prin polling.
    await page.getByTestId("gcs-import-start-real").click();
    await expect(page.getByTestId("gcs-import-status")).toHaveText("Terminat", { timeout: 90_000 });
    await expect(report.getByRole("heading", { name: "Raportul importului" })).toBeVisible();
    await expect(report.locator('tr[data-step="posts"] td.is-good')).toHaveText("4");
    await expect(report.locator('tr[data-step="members"] td.is-good')).toHaveText("4");

    // Redirecturile sunt pornite, cu prefixul căii vechi; unealta de verificare arată ținta.
    const redirects = page.getByTestId("gcs-import-redirects");
    await expect(redirects.getByTestId("gcs-import-redirects-state")).toHaveText("Pornite");
    await redirects.getByLabel("Adresă veche").fill("https://vechi.exemplu.ro/forum/topic/10-bun-venit-pe-forum/");
    await redirects.getByRole("button", { name: "Verifică redirecturile" }).click();
    await expect(redirects.getByTestId("gcs-import-redirect-result")).toContainText(/\/topic\/\d+-bun-venit-pe-forum/);

    // Adresele vechi trimit cu 301 la cele noi.
    const topicRedirect = await page.request.get("/forum/topic/10-bun-venit-pe-forum", { maxRedirects: 0 });
    expect(topicRedirect.status()).toBe(301);
    const topicUrl = topicRedirect.headers().location!;
    expect(topicUrl).toMatch(/^\/topic\/\d+-bun-venit-pe-forum$/);
    const memberRedirect = await page.request.get("/forum/profile/2-ana-pop", { maxRedirects: 0 });
    expect(memberRedirect.status()).toBe(301);
    expect(memberRedirect.headers().location).toMatch(/^\/members\/[a-z0-9]+-ana-pop$/);
    const legacyQuery = await page.request.get("/forum/index.php?showtopic=10", { maxRedirects: 0 });
    expect(legacyQuery.status()).toBe(301);
    expect(legacyQuery.headers().location).toBe(topicUrl);

    // Conținutul importat e vizibil pe site, cu citatul legat și imaginea atașată.
    await page.goto(topicUrl);
    await expect(page.getByRole("heading", { level: 1, name: /Bun venit pe forum/ })).toBeVisible();
    await expect(page.locator("blockquote.gcs-quote").first()).toContainText("Vechiul Admin");
    await expect(page.locator("img.gcs-postImage").first()).toBeVisible();
    await expect(page.getByText("Mersi,").first()).toBeVisible();
    await page.goto(memberRedirect.headers().location!);
    await expect(page.getByText("Ana Pop").first()).toBeVisible();

    // Un membru importat intră cu parola veche; hash-ul se rescrie în Argon2id.
    const anaContext = await browser.newContext();
    await useFreshIp(anaContext, "203.0.113");
    const ana = await anaContext.newPage();
    await ana.goto("/login");
    await login(ana, "ana@exemplu.ro", "parola-veche-2");
    await expect(ana.getByTestId("gcs-header-user")).toHaveText("Ana Pop");
    const [account] = await sql<{ password: string }>(
      `SELECT a.password FROM accounts a JOIN users u ON u.id = a."userId" WHERE u.email = 'ana@exemplu.ro' AND a."providerId" = 'credential'`,
    );
    expect(account!.password.startsWith("$argon2id$")).toBe(true);
    await anaContext.close();
  });
});
