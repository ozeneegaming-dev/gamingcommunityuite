import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, formAlert, login, logout, PASSWORD, register, resetSetting, setSetting, sql, useFreshIp } from "./helpers";

/**
 * ACP → Setări → Securitate și → Termeni și confidențialitate: blocarea după parole greșite, acceptarea termenilor la
 * înregistrare, pagina `/terms`, banda de cookie-uri și paginile ACP. Capturile: `GCS_SHOTS_DIR=<folder>`.
 */
const SHOTS = process.env.GCS_SHOTS_DIR ?? "";
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const LEGAL_DOC = (text: string) => ({ doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, html: `<p>${text}</p>`, updatedAt: "2026-11-01T10:00:00.000Z" });

test.beforeEach(async ({ context }) => {
  await useFreshIp(context);
});

test("după N parole greșite contul se blochează, chiar și cu parola corectă și de pe alt IP", async ({ page, context }) => {
  const id = uid();
  await setSetting("security.login_max_attempts", 3);
  try {
    await register(page, `Blocat${id}`, `blocat-${id}@example.com`);
    await expect(page.getByTestId("gcs-header-user")).toHaveText(`Blocat${id}`);
    await logout(page);

    await page.goto("/login");
    for (let i = 0; i < 3; i++) {
      await login(page, `blocat-${id}@example.com`, "parola-gresita-1");
      await expect(formAlert(page)).toHaveText("Email sau parolă incorectă");
    }
    await login(page, `blocat-${id}@example.com`, PASSWORD);
    await expect(formAlert(page)).toHaveText(/Contul e blocat temporar după prea multe parole greșite\. Încearcă din nou peste 1[45] min\./);
    await shot(page, "login-locked");

    // Alt IP (rate limit-ul pe IP e altul): contul rămâne blocat.
    await useFreshIp(context);
    await page.goto("/login");
    await login(page, `blocat-${id}@example.com`, PASSWORD);
    await expect(formAlert(page)).toHaveText(/Contul e blocat temporar/);
    const audit = await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.login_locked' AND "targetId" = (SELECT id FROM users WHERE email = $1)`, [`blocat-${id}@example.com`]);
    expect(Number(audit[0]!.n)).toBe(1);
  } finally {
    await resetSetting("security.login_max_attempts");
  }
});

test("cu termeni publicați: /terms se vede, linkul e în subsol, iar înregistrarea cere acceptarea (salvată la membru)", async ({ page }) => {
  const id = uid();
  await setSetting("legal.terms_content", LEGAL_DOC(`Termenii comunității ${id}`));
  await setSetting("legal.terms_mode", "page");
  try {
    const terms = await page.goto("/terms");
    expect(terms?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Termeni de utilizare" })).toBeVisible();
    await expect(page.getByTestId("gcs-legal-page-terms")).toContainText(`Termenii comunității ${id}`);
    await expect(page.getByTestId("gcs-footer-terms")).toHaveAttribute("href", "/terms");
    await shot(page, "terms-page");

    await page.goto("/register");
    await page.getByLabel("Nume de utilizator").fill(`Atent${id}`);
    await page.getByLabel("Email").fill(`atent-${id}@example.com`);
    await page.getByLabel("Parolă").fill(PASSWORD);
    await page.getByRole("button", { name: "Creează cont" }).click();
    const terms_ = page.getByTestId("gcs-register-terms");
    await expect(terms_.getByRole("alert")).toHaveText("Trebuie să accepți termenii ca să-ți creezi contul.");
    await expect(terms_.getByRole("link", { name: "termenii de utilizare" })).toHaveAttribute("href", "/terms");
    await shot(page, "register-terms-required");
    expect(await sql(`SELECT id FROM users WHERE email = $1`, [`atent-${id}@example.com`])).toHaveLength(0);

    await terms_.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Creează cont" }).click();
    await expect(page.getByTestId("gcs-header-user")).toHaveText(`Atent${id}`);
    const rows = await sql<{ termsAcceptedAt: Date | string | null }>(`SELECT "termsAcceptedAt" FROM users WHERE email = $1`, [`atent-${id}@example.com`]);
    expect(rows[0]?.termsAcceptedAt).not.toBeNull();
  } finally {
    await resetSetting("legal.terms_mode");
    await resetSetting("legal.terms_content");
  }
  // Fără termeni: pagina răspunde 404, iar înregistrarea nu mai cere nimic.
  expect((await page.goto("/terms"))?.status()).toBe(404);
});

test("banda de cookie-uri: apare pentru vizitatori (fixată, fără să mute pagina) și, închisă, nu mai revine", async ({ page, context }) => {
  await setSetting("legal.cookie_banner", true);
  try {
    await page.goto("/");
    const banner = page.getByTestId("gcs-cookie-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("aria-label", "Cookie-uri");
    await expect(banner).toContainText("Acest site folosește cookie-uri");
    expect(await banner.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    await shot(page, "cookie-banner");
    await page.setViewportSize({ width: 375, height: 760 });
    await expect(banner).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, "cookie-banner-375");

    await banner.getByRole("button", { name: "Am înțeles" }).click();
    await expect(banner).toHaveCount(0);
    expect((await context.cookies()).some((c) => c.name === "gcs-cookie-ok" && c.value === "1")).toBe(true);
    await page.reload();
    await expect(page.getByTestId("gcs-site-footer")).toBeVisible();
    await expect(page.getByTestId("gcs-cookie-banner")).toHaveCount(0);
  } finally {
    await resetSetting("legal.cookie_banner");
  }
});

test("ACP: Securitate și Termeni și confidențialitate sunt pagini reale; termenii scriși în ACP apar pe /terms", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Legal${id}`, `legal-${id}@example.com`);
  try {
    await page.goto("/admin/settings/2fa");
    await expect(page.getByRole("heading", { name: "Securitate", level: 1 })).toBeVisible();
    await expect(page.getByText("Parole greșite până la blocare")).toBeVisible();
    await expect(page.getByTestId("gcs-acp-mfa-groups")).toBeVisible();
    await expect(page.getByText("Această secțiune vine într-o etapă următoare")).toHaveCount(0);
    await shot(page, "acp-security");

    await page.goto("/admin/settings/terms");
    await expect(page.getByRole("heading", { name: "Termeni și confidențialitate", level: 1 })).toBeVisible();
    await expect(page.getByTestId("gcs-legal-retention")).toContainText("Jurnalul ACP (zile)");
    const editor = page.getByTestId("gcs-legal-terms");
    await editor.getByTestId("gcs-legal-terms-mode-page").check();
    await editor.locator(".gcs-editor__content").click();
    await page.keyboard.type(`Regulile de folosire ${id}`);
    await editor.getByTestId("gcs-legal-terms-save").click();
    await expect(editor.locator(".gcs-notice")).toHaveText("Salvat.");
    await shot(page, "acp-legal");

    await page.goto("/terms");
    await expect(page.getByTestId("gcs-legal-page-terms")).toContainText(`Regulile de folosire ${id}`);
  } finally {
    await resetSetting("legal.terms_mode");
    await resetSetting("legal.terms_content");
  }
});
