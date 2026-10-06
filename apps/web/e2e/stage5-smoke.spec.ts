import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { PASSWORD, register, totp, useFreshIp } from "./helpers";

/**
 * Smoke test-ul etapei 5 (specul etapei, §1), pe instanța instalată de `install.spec.ts` cu „Date demo”:
 * header și popup de login, pagina compusă din widget-uri (panoul de statistici), iconițele forumurilor, 6 limbi,
 * „Powered by”, postbit-ul, camerele de chat demo, listele de membri, apoi editorul de temă al adminului.
 */
test.skip(!process.env.GCS_E2E_INSTALL_URL, "Rulează doar pe instanța de instalare (e2e/run.mts, build de producție).");

async function installSql<T extends Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const url = new URL(process.env.GCS_E2E_INSTALL_DB_URL ?? process.env.DATABASE_URL!);
  if (!process.env.GCS_E2E_INSTALL_DB_URL) url.pathname = "/redline_e2e_install";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query<T>(query, params)).rows;
  } finally {
    await client.end();
  }
}

async function newUser(browser: Browser, name: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await register(page, name, `${name.toLowerCase()}@example.com`);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await installSql(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = $2) WHERE name = $1`, [name, group]);
  await installSql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
  await page.goto("/");
  return page;
}

test("etapa 5: header și login în popup → widget-uri și statistici → limbi → postbit → chat → membri → editorul de temă", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await useFreshIp(page.context(), "198.18.90");

  await test.step("vizitatorul: header, popup-ul de login (Escape îl închide), panoul de statistici, iconițele, Powered by", async () => {
    await page.goto("/");
    await page.getByTestId("gcs-header-login").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-widget="core.statsPanel"]')).toBeVisible();
    await expect(page.locator('[data-widget="core.announcement"]')).toBeVisible();
    await expect(page.locator(".gcs-forumRow__icon svg").first()).toBeVisible();
    await expect(page.locator(".gcs-siteFooter")).toContainText("Powered by GamingCommunitySuite");
  });

  await test.step("limbile: engleza din footer schimbă interfața, apoi înapoi în română", async () => {
    await page.locator(".gcs-siteFooter").getByRole("button", { name: "EN" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator(".gcs-siteFooter").getByRole("button", { name: "RO" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  });

  // Nume unice pe rulare: smoke-ul rulează și pe instanțe care păstrează conturile rulărilor anterioare.
  const run = Date.now().toString(36).slice(-5);
  const ana = await newUser(browser, `Ana5${run}`, "198.18.91");

  await test.step("membrul: postbit-ul topicului de bun venit, camerele de chat demo, listele de membri și staff", async () => {
    const [welcome] = await installSql<{ id: number; slug: string }>(`SELECT id, slug FROM topics WHERE title LIKE 'Bun venit pe %' ORDER BY id LIMIT 1`);
    await ana.goto(`/topic/${welcome!.id}-${welcome!.slug}`);
    const postbit = ana.getByTestId("gcs-post").first().getByTestId("gcs-postbit");
    await expect(postbit.getByTestId("gcs-postbit-group")).toBeVisible();
    await expect(postbit.getByTestId("gcs-postbit-xp")).toBeVisible();
    await expect(postbit.getByTestId("gcs-postbit-fields")).toContainText("România");

    // Camerele demo apar doar la o instalare nouă cu „Date demo”; pe o instanță mai veche smoke-ul folosește General.
    const [lfg] = await installSql<{ key: string }>(`SELECT key FROM chat_channels WHERE key = 'lfg'`);
    const room = lfg ? { key: "lfg", name: "Caut echipă" } : { key: "general", name: "General" };
    await ana.goto("/chat");
    const rooms = lfg ? ["General", "Off-topic", "Caut echipă"] : ["General"];
    for (const r of rooms) await expect(ana.getByRole("link", { name: r })).toBeVisible();
    await ana.getByRole("link", { name: room.name }).click();
    await expect(ana).toHaveURL(new RegExp(`c=${room.key}`));
    await expect(ana.getByTestId(`gcs-chat-${room.key}`)).toBeVisible();
    await ana.getByTestId(`gcs-chat-${room.key}`).getByTestId("gcs-chat-input").fill("Caut coechipieri pentru diseară");
    await ana.getByTestId(`gcs-chat-${room.key}`).getByTestId("gcs-chat-input").press("Enter");
    await expect(ana.getByTestId("gcs-chat-msg").filter({ hasText: "Caut coechipieri pentru diseară" })).toBeVisible();

    await ana.goto(`/members?q=ana5${run}`);
    await expect(ana.getByTestId("gcs-member-card")).toHaveCount(1);
    await ana.goto("/staff");
    await expect(ana.locator('[data-testid="gcs-staff-group"][data-group="root_admin"]')).toBeVisible();
  });

  await test.step("adminul: ACP cu 2FA, apoi editorul de temă pe site; vizitatorul vede accentul publicat", async () => {
    const admin = await newUser(browser, `Admin5${run}`, "198.18.92", "root_admin");
    await admin.goto("/admin");
    await expect(admin).toHaveURL(/\/admin\/2fa-setup$/);
    await admin.getByLabel("Parola contului").fill(PASSWORD);
    await admin.getByRole("button", { name: "Continuă" }).click();
    const secret = (await admin.getByTestId("gcs-totp-secret").textContent())?.trim() ?? "";
    await admin.getByLabel("Codul din aplicație").fill(totp(secret));
    await admin.getByRole("button", { name: "Activează 2FA" }).click();
    await expect(admin).toHaveURL(/\/admin\/reauth$/);
    await admin.getByLabel("Parolă").fill(PASSWORD);
    await admin.getByLabel("Cod 2FA").fill(totp(secret));
    await admin.getByRole("button", { name: "Intră în ACP" }).click();
    await expect(admin).toHaveURL(/\/admin$/);

    await admin.goto("/");
    const original = await admin.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gcs-accent").trim().toLowerCase());
    await admin.getByTestId("gcs-edit-theme").click();
    await admin.getByTestId("gcs-theme-color-dark-accent").fill("#3355ee");
    await expect(admin.getByTestId("gcs-theme-status")).toHaveText("Draft salvat. Doar tu vezi modificările până la publicare.");
    await admin.getByTestId("gcs-theme-publish").click();
    await expect(admin.getByTestId("gcs-theme-status")).toHaveText("Tema a fost publicată pentru toți.");

    await page.reload();
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gcs-accent").trim().toUpperCase());
    expect(accent).toBe("#3355EE");

    // Tema revine la culoarea inițială (smoke-ul rulează și pe instanțe reale).
    await admin.getByTestId("gcs-theme-color-dark-accent").fill(original);
    await expect(admin.getByTestId("gcs-theme-status")).toHaveText("Draft salvat. Doar tu vezi modificările până la publicare.");
    await admin.getByTestId("gcs-theme-publish").click();
    await expect(admin.getByTestId("gcs-theme-status")).toHaveText("Tema a fost publicată pentru toți.");
    await admin.getByTestId("gcs-theme-editor-close").click();
  });
});
